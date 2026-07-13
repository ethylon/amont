/* Interactive working-tree diff: the body DiffView renders instead of diff2html for a
   staged/unstaged text diff. Same visual grammar as the conflict view's ChunkSide — a header
   row per hunk, action buttons per changed line, shiki on top — but the action is immediate
   (the professional convention for staging): each click builds the minimal sub-patch
   (diff-parse.ts) and applies it, then the worktree and diff caches refresh.

   Unstaged view: + stages (`git apply --cached`) and ↩ discards — the same sub-patch built in
   the "unstage" direction, reverse-applied to the working tree (`repo:discardPatch`); the
   unstaged diff's `+` side IS the working file, exactly what `git apply --reverse` matches.
   Staged view: − unstages (`--cached --reverse`), no discard — the change lives in the index,
   the working file carries nothing to throw away.

   Renders unified or side-by-side (diff-split.ts pairs the lines); untracked files never
   reach here: without an index entry there is nothing to patch — whole-file staging remains
   their only path. */

import { useMemo, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowTurnBackwardIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
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
import { sideBySideRows, type SideCell } from "./diff-split"
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

type Props = {
  api: RepoApi
  repoId: number
  path: string
  source: "staged" | "unstaged"
  parsed: ParsedDiff
  view: DiffViewMode
}

export function WtDiffBody({ api, repoId, path, source, parsed, view }: Props) {
  const dark = useTheme()
  const queryClient = useQueryClient()
  const showOp = useRepoStore((s) => s.showOp)
  const [busy, setBusy] = useState(false)
  const dir: StageDirection = source === "unstaged" ? "stage" : "unstage"
  /* discarding only exists on the unstaged side (cf. header comment) */
  const canDiscard = source === "unstaged"

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
  const tokensAt = (hi: number, li: number): TokenLine | undefined => {
    const ref = refs[hi][li]
    return (ref.doc === "old" ? oldTokens : newTokens)?.[ref.idx]
  }

  /* One in-flight apply at a time: the diff under the buttons is about to be refetched,
     a second click would build its patch against a stale parse. */
  const run = async (patch: string | null, send: (patch: string) => Promise<void>) => {
    if (!patch || busy) return
    setBusy(true)
    try {
      await send(patch)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.diffAll(repoId) }),
      ])
    } catch (e) {
      showOp(describeError(e), "danger")
    } finally {
      setBusy(false)
    }
  }
  const stage = (patch: string | null) => run(patch, (p) => api.applyPatch(p, dir === "unstage"))
  /* built in the "unstage" direction whatever the view: the target is the working file,
     which matches the unstaged diff's `+` side — what `git apply --reverse` checks against */
  const discard = (patch: string | null) => run(patch, (p) => api.discardPatch(p))

  const lineButtons = (hunk: number, line: number) => (
    <>
      {canDiscard && (
        <IconButton
          label={messages.diff.discardLine}
          icon={ArrowTurnBackwardIcon}
          size="icon-xs"
          className={cn(BTN_CLS, "text-destructive hover:text-destructive")}
          disabled={busy}
          onClick={() => discard(buildPatch(parsed, hunk, new Set([line]), "unstage"))}
        />
      )}
      <IconButton
        label={dir === "stage" ? messages.diff.stageLine : messages.diff.unstageLine}
        icon={dir === "stage" ? PlusSignIcon : MinusSignIcon}
        size="icon-xs"
        className={BTN_CLS}
        disabled={busy}
        onClick={() => stage(buildPatch(parsed, hunk, new Set([line]), dir))}
      />
    </>
  )
  /* keeps ctx rows the same height and indent as actioned rows, one blank per button */
  const gutterBlanks = () => (
    <>
      {canDiscard && <span aria-hidden className="my-px ms-0.5 size-4 shrink-0" />}
      <span aria-hidden className="my-px ms-0.5 size-4 shrink-0" />
    </>
  )

  const hunkHeader = (h: Hunk, hi: number) => (
    <div
      className={cn("flex items-center justify-between gap-2 border-b bg-muted/60 px-2 py-0.5", hi > 0 && "border-t")}
    >
      <span className={cn("truncate text-[0.625rem] text-muted-foreground", MONO)}>{h.header}</span>
      <span className="flex shrink-0 items-center gap-1">
        {canDiscard && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 text-[0.625rem] font-medium text-destructive"
            disabled={busy}
            onClick={() => discard(buildHunkPatch(parsed, hi, "unstage"))}
          >
            {messages.diff.discardHunk}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-auto py-0.5 text-[0.625rem] font-medium"
          disabled={busy}
          onClick={() => stage(buildHunkPatch(parsed, hi, dir))}
        >
          {dir === "stage" ? messages.diff.stageHunk : messages.diff.unstageHunk}
        </Button>
      </span>
    </div>
  )

  const unifiedHunk = (h: Hunk, hi: number) => {
    let oldNo = h.oldStart
    let newNo = h.newStart
    return (
      <div className="min-w-0 overflow-x-auto">
        {h.lines.map((l, li) => {
          const no = {
            old: l.kind === "add" ? null : oldNo++,
            new: l.kind === "del" ? null : newNo++,
          }
          return (
            <div key={li} className={cn("flex min-w-max items-start", TINT[l.kind])}>
              {l.kind === "ctx" ? gutterBlanks() : lineButtons(hi, li)}
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

  const sideCell = (hi: number, cell: SideCell | null, actioned: DiffLineKind) => {
    /* blank filler opposite an unpaired line: no number, hatched-quiet background */
    if (!cell)
      return (
        <div className="flex min-w-max items-start bg-muted/30">
          {gutterBlanks()}
          <span className={LINE_NO} />
          <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO)}> </pre>
        </div>
      )
    const { at, line, no } = cell
    return (
      <div className={cn("flex min-w-max items-start", TINT[line.kind])}>
        {line.kind === actioned ? lineButtons(hi, at) : gutterBlanks()}
        <span className={LINE_NO}>{no}</span>
        <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO)}>
          <CodeLine text={line.text} tokens={tokensAt(hi, at)} />
        </pre>
      </div>
    )
  }

  const splitHunk = (h: Hunk, hi: number) => {
    const rows = sideBySideRows(h)
    return (
      <SyncedColumns
        old={
          <div>
            {rows.map((r, i) => (
              <div key={i}>{sideCell(hi, r.old, "del")}</div>
            ))}
          </div>
        }
        neu={
          <div>
            {rows.map((r, i) => (
              <div key={i}>{sideCell(hi, r.new, "add")}</div>
            ))}
          </div>
        }
      />
    )
  }

  return (
    <div className="min-h-0 flex-auto overflow-y-auto rounded-md border" aria-busy={busy}>
      {parsed.hunks.map((h, hi) => (
        <div key={hi}>
          {hunkHeader(h, hi)}
          {view === "sbs" ? splitHunk(h, hi) : unifiedHunk(h, hi)}
        </div>
      ))}
    </div>
  )
}

/* Two half-width panes whose horizontal scrollbars advance together — same policy as
   diff-view's syncSides for the diff2html render; rows stay facing each other because every
   line renders at the same height on both sides. */
function SyncedColumns({ old, neu }: { old: React.ReactNode; neu: React.ReactNode }) {
  const oldRef = useRef<HTMLDivElement>(null)
  const newRef = useRef<HTMLDivElement>(null)
  const echo = useRef(false)
  const onScroll = (ev: React.UIEvent<HTMLDivElement>) => {
    if (echo.current) return
    echo.current = true
    const src = ev.currentTarget
    const other = src === oldRef.current ? newRef.current : oldRef.current
    if (other) other.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => (echo.current = false))
  }
  return (
    <div className="flex">
      <div ref={oldRef} onScroll={onScroll} className="min-w-0 flex-1 overflow-x-auto border-e">
        {old}
      </div>
      <div ref={newRef} onScroll={onScroll} className="min-w-0 flex-1 overflow-x-auto">
        {neu}
      </div>
    </div>
  )
}
