/* Interactive diff body: what DiffView renders instead of diff2html for any single-file text
   diff that parses — working-tree sources AND commit↔commit contexts. Same visual grammar as
   the conflict view's ChunkSide — a header row per hunk, action buttons per changed line,
   shiki on top — but the action is immediate (the professional convention for staging): each
   click builds the minimal sub-patch (diff-parse.ts) and applies it, then the worktree and
   diff caches refresh.

   Unstaged view: + stages (`git apply --cached`) and ↩ discards — the same sub-patch built in
   the "unstage" direction, reverse-applied to the working tree (`repo:discardPatch`); the
   unstaged diff's `+` side IS the working file, exactly what `git apply --reverse` matches.
   Staged view: − unstages (`--cached --reverse`), no discard — the change lives in the index,
   the working file carries nothing to throw away.
   Commit view (a commit's diff, opened from the detail panel or the file-history view): ↩
   reverts the hunk/line — the same "unstage"-direction sub-patch, reverse-applied to the
   working tree. The `+` side is the committed content: on a file unchanged since, the patch
   matches exactly; on one that moved, git tolerates line offsets but refuses a context
   mismatch cleanly (error badge, tree untouched) rather than guessing. The commit itself is
   immutable — only the worktree caches refresh.

   Renders unified or side-by-side (diff-split.ts pairs the lines); untracked files never
   reach here: without an index entry there is nothing to patch — whole-file staging remains
   their only path.

   Hunks render through a `React.memo` component with stable props: a big diff is a 15-20k
   element tree, and the busy flip around every stage/discard click used to reconcile all of
   it twice (audit §4). The in-flight gate lives in a ref (the correctness guard) plus a CSS
   pointer-events rule keyed on the container's aria-busy (the UX guard), so no per-line
   button ever receives a changing `busy` prop. */

import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowTurnBackwardIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { invalidateWtDiffs, queryKeys } from "@/lib/queries"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useRepoStore } from "@/features/repo/repo-store"
import {
  buildHunkPatch,
  buildPatch,
  type DiffLineKind,
  type Hunk,
  type ParsedDiff,
  type StageDirection,
} from "./diff-parse"
import { sideBySideRows, type SideCell, type SideRow } from "./diff-split"
import type { DiffViewMode } from "./diff-view"
import { CodeLine, useShikiTokens, type TokenLine } from "@/features/diff/shiki-tokens"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"

/* Same tints as the raw fallback render (diff-view RAW_CLASS): red/green IS the diff
   vocabulary here, unlike the conflict view where neither side is "removed". */
const TINT: Record<DiffLineKind, string> = { add: "bg-success/16", del: "bg-destructive/16", ctx: "" }

const MONO = "font-mono text-xs leading-normal [tab-size:4]"
const LINE_NO = "w-9 shrink-0 text-right text-[0.625rem] leading-normal text-muted-foreground tabular-nums select-none"
const BTN_CLS = "my-px ms-0.5 size-4 shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100"
/* Off-screen rows skip layout and paint entirely (`content-visibility: auto`); the intrinsic
   size keeps scrollbars honest before a row's real size is remembered — 18px is one
   text-xs/leading-normal mono line (audit §13, the cheap 80% of virtualization). */
const CV_ROW = "[content-visibility:auto] [contain-intrinsic-size:auto_18px]"
/* Wraps the rows of one horizontal scroller: sized to the widest row (`w-max`), never narrower
   than the scrollport (`min-w-full`). Every row then stretches to the full scroll width, so its
   tint follows the horizontal scroll — sized on its own (block width = scrollport width), a
   short row's background would stop at the pane edge and longer lines would scroll past it. */
const SCROLL_ROWS = "w-max min-w-full"

/** What the body acts on: the two index-facing sources, or a commit's immutable diff whose
    only action is the working-tree revert (cf. header comment). */
export type DiffBodySource = "staged" | "unstaged" | "commit"

type Props = {
  api: RepoApi
  repoId: number
  path: string
  source: DiffBodySource
  parsed: ParsedDiff
  view: DiffViewMode
}

export function DiffBody({ api, repoId, path, source, parsed, view }: Props) {
  const dark = useTheme()
  const queryClient = useQueryClient()
  const showOp = useRepoStore((s) => s.showOp)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const dir: StageDirection = source === "unstaged" ? "stage" : "unstage"

  /* Two documents for the highlighter — old side (ctx + del) and new side (ctx + add) — so
     the grammar sees real code on each side; every diff line remembers which document and
     which line index paints it (same policy as the conflict panes). */
  const { oldDoc, newDoc, refs } = useMemo(() => {
    const oldL: string[] = []
    const newL: string[] = []
    const refs = parsed.hunks.map((h) =>
      h.lines.map((l) => {
        if (l.kind === "del") {
          oldL.push(l.text)
          return { doc: "old" as const, idx: oldL.length - 1 }
        }
        if (l.kind === "ctx") oldL.push(l.text)
        newL.push(l.text)
        return { doc: "new" as const, idx: newL.length - 1 }
      })
    )
    return { oldDoc: oldL.join("\n"), newDoc: newL.join("\n"), refs }
  }, [parsed])
  const oldTokens = useShikiTokens(oldDoc, path, dark)
  const newTokens = useShikiTokens(newDoc, path, dark)
  const tokensAt = useCallback(
    (hi: number, li: number): TokenLine | undefined => {
      const ref = refs[hi][li]
      return (ref.doc === "old" ? oldTokens : newTokens)?.[ref.idx]
    },
    [refs, oldTokens, newTokens]
  )

  /* The side-by-side pairing of every hunk, computed once per parse (it used to be recomputed
     on every render of every hunk). Keyed on the parsed diff: the rows only change when it does. */
  const splitRows = useMemo(() => (view === "sbs" ? parsed.hunks.map((h) => sideBySideRows(h)) : null), [parsed, view])

  /* One in-flight apply at a time: the diff under the buttons is about to be refetched,
     a second click would build its patch against a stale parse. The gate is a ref — not the
     `busy` state — so these callbacks stay referentially stable and the memoized hunk
     sections don't re-render on every flip; `busy` only feeds the container's aria-busy. */
  const run = useCallback(
    async (patch: string | null, send: (patch: string) => Promise<void>) => {
      if (!patch || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        await send(patch)
        await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
        /* wt diffs only: staging a hunk moves tree/index content, never a commit↔commit diff */
        invalidateWtDiffs(queryClient, repoId)
      } catch (e) {
        showOp(describeError(e), "danger")
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [queryClient, repoId, showOp]
  )
  const stage = useCallback(
    (patch: string | null) => run(patch, (p) => api.applyPatch(p, dir === "unstage")),
    [run, api, dir]
  )
  /* built in the "unstage" direction whatever the view: the target is the working file, which
     matches the `+` side of both the unstaged diff and a commit's diff (the revert case) —
     what `git apply --reverse` checks against */
  const discard = useCallback((patch: string | null) => run(patch, (p) => api.discardPatch(p)), [run, api])

  return (
    /* While an apply is in flight the buttons go inert via CSS instead of a `disabled` prop:
       flipping `disabled` on thousands of IconButtons is exactly the full-tree reconciliation
       this component structure exists to avoid. Keyboard activation slips past pointer-events,
       but `run`'s ref guard makes a second submission a no-op either way. */
    <div
      className="@container min-h-0 flex-auto overflow-auto rounded-md border [&[aria-busy=true]_button]:pointer-events-none"
      aria-busy={busy}
    >
      {/* Unified: the container scrolls BOTH axes, so the one horizontal scrollbar sits on the
          pane's bottom edge — always in view — instead of at the bottom of each hunk, below the
          fold for anything taller than the pane; all hunks advance together. The SCROLL_ROWS
          wrapper spans every hunk so all rows share the global widest line (per-hunk widths
          would leave a shorter hunk's tints ragged against a longer neighbour's scroll width).
          Side-by-side: the panes clip their own overflow, nothing overflows this wrapper. */}
      <div className={view === "unified" ? SCROLL_ROWS : undefined}>
        {parsed.hunks.map((h, hi) => (
          <HunkSection
            key={hi}
            h={h}
            hi={hi}
            rows={splitRows?.[hi] ?? null}
            view={view}
            source={source}
            parsed={parsed}
            tokensAt={tokensAt}
            onStage={stage}
            onDiscard={discard}
          />
        ))}
      </div>
    </div>
  )
}

type HunkSectionProps = {
  h: Hunk
  hi: number
  /** Pre-paired side-by-side rows for this hunk (null in unified view). */
  rows: SideRow[] | null
  view: DiffViewMode
  source: DiffBodySource
  parsed: ParsedDiff
  tokensAt: (hi: number, li: number) => TokenLine | undefined
  onStage: (patch: string | null) => void
  onDiscard: (patch: string | null) => void
}

/* One hunk — header plus its unified or side-by-side body. `memo` is the point: every prop is
   referentially stable across the busy flips around a stage/discard click (callbacks are
   `useCallback`ed, rows/parsed are memoized), so a click reconciles zero hunk subtrees; only a
   new parse (refetch after the apply) or arriving shiki tokens re-render them. */
const HunkSection = memo(function HunkSection({
  h,
  hi,
  rows,
  view,
  source,
  parsed,
  tokensAt,
  onStage,
  onDiscard,
}: HunkSectionProps) {
  /* memo'd with referentially stable props: the localized button labels would freeze in
     the old language on a switch without a direct locale subscription */
  useLocale()
  const dir: StageDirection = source === "unstaged" ? "stage" : "unstage"
  /* the reverse-apply button: discard on the unstaged side, revert on a commit's diff —
     same sub-patch, same target (the working tree), only the vocabulary differs; the staged
     view has neither (the change lives in the index, the working file carries nothing) */
  const undo = source === "unstaged" ? "discard" : source === "commit" ? "revert" : null
  /* a commit's diff never touches the index: no stage/unstage column */
  const canStage = source !== "commit"
  const lineButtons = (line: number) => (
    <>
      {undo && (
        <IconButton
          label={undo === "revert" ? messages.diff.revertLine : messages.diff.discardLine}
          icon={ArrowTurnBackwardIcon}
          size="icon-xs"
          className={cn(BTN_CLS, "text-destructive hover:text-destructive")}
          onClick={() => onDiscard(buildPatch(parsed, hi, new Set([line]), "unstage"))}
        />
      )}
      {canStage && (
        <IconButton
          label={dir === "stage" ? messages.diff.stageLine : messages.diff.unstageLine}
          icon={dir === "stage" ? PlusSignIcon : MinusSignIcon}
          size="icon-xs"
          className={BTN_CLS}
          onClick={() => onStage(buildPatch(parsed, hi, new Set([line]), dir))}
        />
      )}
    </>
  )
  /* keeps ctx rows the same height and indent as actioned rows, one blank per button */
  const gutterBlanks = () => (
    <>
      {undo && <span aria-hidden className="my-px ms-0.5 size-4 shrink-0" />}
      {canStage && <span aria-hidden className="my-px ms-0.5 size-4 shrink-0" />}
    </>
  )

  /* `sticky left-0 w-[100cqw]`: pinned to the scrollport (100cqw = the @container root's inner
     width) so the header and its actions never leave view while the unified body scrolls
     sideways; inert in side-by-side, where nothing overflows at this level. */
  const header = (
    <div
      className={cn(
        "sticky left-0 flex w-[100cqw] items-center justify-between gap-2 border-b bg-muted/60 px-2 py-0.5",
        hi > 0 && "border-t"
      )}
    >
      <span className={cn("truncate text-[0.625rem] text-muted-foreground", MONO)}>{h.header}</span>
      <span className="flex shrink-0 items-center gap-1">
        {undo && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 text-[0.625rem] font-medium text-destructive"
            onClick={() => onDiscard(buildHunkPatch(parsed, hi, "unstage"))}
          >
            {undo === "revert" ? messages.diff.revertHunk : messages.diff.discardHunk}
          </Button>
        )}
        {canStage && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 text-[0.625rem] font-medium"
            onClick={() => onStage(buildHunkPatch(parsed, hi, dir))}
          >
            {dir === "stage" ? messages.diff.stageHunk : messages.diff.unstageHunk}
          </Button>
        )}
      </span>
    </div>
  )

  /* No scroller of its own: the rows live in the body-wide SCROLL_ROWS wrapper (cf. DiffBody)
     and stretch to it, tints covering the whole scroll width. */
  const unifiedBody = () => {
    let oldNo = h.oldStart
    let newNo = h.newStart
    return (
      <div>
        {h.lines.map((l, li) => {
          const no = {
            old: l.kind === "add" ? null : oldNo++,
            new: l.kind === "del" ? null : newNo++,
          }
          return (
            <div key={li} className={cn("flex items-start", CV_ROW, TINT[l.kind])}>
              {l.kind === "ctx" ? gutterBlanks() : lineButtons(li)}
              <span className={LINE_NO}>{no.old}</span>
              <span className={LINE_NO}>{no.new}</span>
              <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO)}>
                <CodeLine text={l.text} tokens={tokensAt(hi, li)} />
              </pre>
            </div>
          )
        })}
      </div>
    )
  }

  const sideCell = (cell: SideCell | null, actioned: DiffLineKind) => {
    /* blank filler opposite an unpaired line: no number, hatched-quiet background */
    if (!cell)
      return (
        <div className={cn("flex items-start bg-muted/30", CV_ROW)}>
          {gutterBlanks()}
          <span className={LINE_NO} />
          <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO)}> </pre>
        </div>
      )
    const { at, line, no } = cell
    return (
      <div className={cn("flex items-start", CV_ROW, TINT[line.kind])}>
        {line.kind === actioned ? lineButtons(at) : gutterBlanks()}
        <span className={LINE_NO}>{no}</span>
        <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO)}>
          <CodeLine text={line.text} tokens={tokensAt(hi, at)} />
        </pre>
      </div>
    )
  }

  /* SCROLL_ROWS per pane: each side is its own scroller, so its rows only need to agree on
     that pane's widest line for the tints to span its scroll width. */
  const splitBody = (rows: SideRow[]) => (
    <SyncedColumns
      old={
        <div className={SCROLL_ROWS}>
          {rows.map((r, i) => (
            <div key={i}>{sideCell(r.old, "del")}</div>
          ))}
        </div>
      }
      neu={
        <div className={SCROLL_ROWS}>
          {rows.map((r, i) => (
            <div key={i}>{sideCell(r.new, "add")}</div>
          ))}
        </div>
      }
    />
  )

  return (
    <div>
      {header}
      {view === "sbs" && rows ? splitBody(rows) : unifiedBody()}
    </div>
  )
})

/* Two half-width panes whose horizontal scrolling advances together — same policy as
   diff-view's syncSides for the diff2html render; rows stay facing each other because every
   line renders at the same height on both sides.

   The panes' native scrollbars are hidden: they would sit at the bottom of the whole hunk,
   below the fold for anything taller than the pane. One shared bar — `sticky bottom-0`, so it
   pins to the pane's bottom edge while the hunk crosses it — scrolls both panes instead. Its
   spacer is sized so the bar's range equals the widest pane's (100% + range), which keeps the
   plain scrollLeft mirroring exact; `range` is remeasured when a pane or its rows resize
   (window resize, content-visibility rendering rows in, shiki arriving) and the bar only
   exists while something actually overflows. */
function SyncedColumns({ old, neu }: { old: React.ReactNode; neu: React.ReactNode }) {
  const oldRef = useRef<HTMLDivElement>(null)
  const newRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const echo = useRef(false)
  const [range, setRange] = useState(0)
  useLayoutEffect(() => {
    const panes = [oldRef.current, newRef.current].filter((p) => p !== null)
    const measure = () => setRange(Math.max(0, ...panes.map((p) => p.scrollWidth - p.clientWidth)))
    const ro = new ResizeObserver(measure)
    for (const p of panes) {
      ro.observe(p)
      if (p.firstElementChild) ro.observe(p.firstElementChild)
    }
    measure()
    return () => ro.disconnect()
  }, [])
  const onScroll = (ev: React.UIEvent<HTMLDivElement>) => {
    if (echo.current) return
    echo.current = true
    const src = ev.currentTarget
    for (const el of [oldRef.current, newRef.current, barRef.current])
      if (el && el !== src) el.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => (echo.current = false))
  }
  return (
    <div>
      <div className="flex">
        <div
          ref={oldRef}
          onScroll={onScroll}
          className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] border-e"
        >
          {old}
        </div>
        <div ref={newRef} onScroll={onScroll} className="min-w-0 flex-1 overflow-x-auto [scrollbar-width:none]">
          {neu}
        </div>
      </div>
      {range > 0 && (
        <div ref={barRef} onScroll={onScroll} className="sticky bottom-0 z-10 overflow-x-auto bg-background">
          {/* 1px tall, not 0: Chromium leaves a zero-height box out of the scrollable
              overflow, which would zero the bar's range */}
          <div aria-hidden className="h-px" style={{ width: `calc(100% + ${range}px)` }} />
        </div>
      )}
    </div>
  )
}
