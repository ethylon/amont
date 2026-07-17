/* Conflict resolution view — overlays the graph like DiffView (same slot, cf. graph-column).
   Two aligned panes make the sides unmistakable: A (ours, the checked-out branch, blue) on
   the left, B (theirs, the branch being merged in, green) on the right — labels come from
   MERGE_HEAD (merge-state query), falling back to the file's own conflict markers. Panes AND
   the editable output all go through the same lazy shiki core as the diff view: each side is
   tokenized as one document (context + that side's lines) so the grammar sees real code.

   Selection is click-ordered (cf. conflict-parse.ts Picks): the header checkbox takes a
   whole side across every conflict, the per-chunk checkbox takes one side of one conflict,
   the per-line +/- adds or removes a single line — and the output region of each conflict
   is exactly the picked lines IN THE ORDER THEY WERE CLICKED, no hardcoded A-before-B.
   An unpicked conflict shows as a `<merge conflict>` placeholder in the output, never markers.

   The merged output is a single editable buffer. Picks and hand edits COEXIST: a pick toggle
   splices its conflict's block into the current buffer (applyPickDiff) instead of re-deriving,
   so typed edits elsewhere survive and the pickers never lock. "Mark as resolved" enables once
   no placeholder or marker remains and stages the file — git's own definition of resolved. */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Cancel01Icon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, MergeState, RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import {
  applyPickDiff,
  CONFLICT_PLACEHOLDER,
  isPicked,
  parseConflicts,
  pickPosition,
  renderPicks,
  setSide,
  sideState,
  toggleLine,
  unresolvedCount,
  type ConflictBlock,
  type ConflictSegment,
  type LineRef,
  type Picks,
  type PickSide,
} from "./conflict-parse"
import { useConflictQuery, useMergeStateQuery } from "./conflict-queries"
import { CodeLine, useShikiTokens, type TokenLine } from "@/features/diff/shiki-tokens"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { GitCmd } from "@/components/ui/git-cmd"
import { IconButton } from "@/components/ui/icon-button"

/* A = info (blue), B = success (green) — never the red/green of diffs: neither side is
   "removed", they're two competing additions. */
const SIDE_TINT: Record<PickSide, string> = { ours: "bg-info/8", theirs: "bg-success/8" }
const PICKED_TINT: Record<PickSide, string> = { ours: "bg-info/20", theirs: "bg-success/20" }

const MONO = "font-mono text-xs leading-normal [tab-size:4]"
/* Off-screen rows skip layout and paint entirely (`content-visibility: auto`); the intrinsic
   size keeps scrollbars honest before a row's real size is remembered — 18px is one
   text-xs/leading-normal mono line (same policy as wt-diff-body's diff rows). */
const CV_ROW = "[content-visibility:auto] [contain-intrinsic-size:auto_18px]"

/* How long the output editor waits after the last keystroke before re-tokenizing its whole
   buffer (same order of magnitude as commit-search's query debounce). */
const TOKENIZE_DEBOUNCE = 200

/** A run of context lines (same text both sides), highlighted with its pane's tokens. */
function PaneCell({
  lines,
  tokens,
  start,
  className,
}: {
  lines: string[]
  tokens: TokenLine[] | null
  start: number
  className?: string
}) {
  return (
    <div className={cn("min-w-0 overflow-x-auto px-2 py-px whitespace-pre", MONO, className)}>
      {lines.map((l, i) => (
        <div key={i} className={cn("min-w-max", CV_ROW)}>
          <CodeLine text={l} tokens={tokens?.[start + i]} />
        </div>
      ))}
    </div>
  )
}

/** Editable output with syntax highlighting: a transparent-text textarea over a highlighted,
    scroll-synced <pre>. The placeholder line is styled apart (it isn't code); every other line
    is tokenized by shiki. The tokenize input is debounced ~200ms so a burst of keystrokes pays
    one whole-buffer tokenization, not one per key — the textarea itself stays controlled on the
    live value. Unchanged lines keep their previous tokens (useShikiTokens never clears, so
    there is no flash); an edited line drops to plain text until the next pass catches up —
    CodeLine refuses tokens that no longer spell the live text, since painting stale glyphs
    under the caret would visibly swallow the keystrokes. */
function OutputEditor({
  value,
  onChange,
  path,
  dark,
  ariaLabel,
}: {
  value: string
  onChange(v: string): void
  path: string
  dark: boolean
  ariaLabel: string
}) {
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const [tokenSource, setTokenSource] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setTokenSource(value), TOKENIZE_DEBOUNCE)
    return () => clearTimeout(t)
  }, [value])
  const tokens = useShikiTokens(tokenSource, path, dark)
  const lines = value.split("\n")

  const syncScroll = () => {
    const ta = taRef.current
    const pre = preRef.current
    if (ta && pre) {
      pre.scrollTop = ta.scrollTop
      pre.scrollLeft = ta.scrollLeft
    }
  }

  const PAD = "px-2.5 py-2"
  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
      <pre
        ref={preRef}
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre", MONO, PAD)}
      >
        {lines.map((l, i) =>
          l.trim() === CONFLICT_PLACEHOLDER ? (
            <div key={i} className={cn("min-w-max text-warning italic", CV_ROW)}>
              {l}
            </div>
          ) : (
            <div key={i} className={cn("min-w-max", CV_ROW)}>
              <CodeLine text={l} tokens={tokens?.[i]} />
            </div>
          )
        )}
      </pre>
      <textarea
        ref={taRef}
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        spellCheck={false}
        wrap="off"
        className={cn(
          "absolute inset-0 resize-none overflow-auto bg-transparent whitespace-pre text-transparent caret-foreground outline-none",
          MONO,
          PAD
        )}
      />
    </div>
  )
}

/** Display labels of the two sides: branch names when a merge is in progress, otherwise
    whatever the markers carry ("HEAD", a hash), otherwise the generic ours/theirs. */
function sideLabels(ms: MergeState | undefined, segments: ConflictSegment[]): { a: string; b: string } {
  const block = segments.find((s) => s.kind === "conflict")
  return {
    a: ms?.ours || block?.oursLabel || "HEAD",
    b: ms?.theirs || block?.theirsLabel || "MERGE_HEAD",
  }
}

/** One side of one conflict: the chunk checkbox, then the lines with their +/- and their
    position in the click order. */
function ChunkSide({
  block,
  side,
  picks,
  tokens,
  start,
  onPicks,
  className,
}: {
  block: ConflictBlock
  side: PickSide
  picks: Picks
  tokens: TokenLine[] | null
  start: number
  onPicks(next: Picks): void
  className?: string
}) {
  const lines = block[side]
  const state = sideState(picks, block, side)
  const lineButton = (ref: LineRef, picked: boolean) => (
    <IconButton
      label={picked ? messages.conflict.removeLine : messages.conflict.addLine}
      icon={picked ? MinusSignIcon : PlusSignIcon}
      size="icon-xs"
      className="my-px ms-0.5 size-4 shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100"
      onClick={() => onPicks(toggleLine(picks, block.index, ref))}
    />
  )
  return (
    <div className={cn("flex min-w-0 flex-col", SIDE_TINT[side], className)}>
      <label
        className={cn(
          "flex items-center gap-1.5 px-1.5 py-1 text-[0.625rem] font-medium text-muted-foreground select-none",
          lines.length > 0 && "cursor-pointer"
        )}
      >
        <Checkbox
          aria-label={side === "ours" ? messages.conflict.takeA : messages.conflict.takeB}
          className="size-3.5"
          checked={state === "all"}
          indeterminate={state === "some"}
          disabled={lines.length === 0}
          onCheckedChange={(on) => onPicks(setSide(picks, block, side, on === true))}
        />
        {side === "ours" ? messages.conflict.takeA : messages.conflict.takeB}
        {lines.length === 0 && ` · ${messages.conflict.deletedOnThisSide}`}
      </label>
      <div className="min-w-0 overflow-x-auto">
        {lines.map((l, line) => {
          const ref: LineRef = { side, line }
          const picked = isPicked(picks, block.index, ref)
          const pos = pickPosition(picks, block.index, ref)
          return (
            <div key={line} className={cn("flex min-w-max items-start", CV_ROW, picked && PICKED_TINT[side])}>
              {lineButton(ref, picked)}
              {/* the 1-based click-order position: what makes "output order = click order" legible */}
              <span className="w-4 shrink-0 text-right text-[0.625rem] leading-normal text-muted-foreground tabular-nums">
                {pos}
              </span>
              <pre className={cn("flex-1 px-1.5 whitespace-pre", MONO, !picked && "opacity-55")}>
                <CodeLine text={l} tokens={tokens?.[start + line]} />
              </pre>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type Props = {
  api: RepoApi
  repoId: number
  file: FileChange
  onClose(): void
  onResolve(path: string, content: string): Promise<void>
}

export function ConflictView({ api, repoId, file, onClose, onResolve }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const { data: cf = null, isError: error } = useConflictQuery(api, repoId, file.path)
  const { data: ms } = useMergeStateQuery(api, repoId)
  const dark = useTheme()

  /* The base never moves while the view is open: panes and picks are anchored to the
     conflict indices of THIS parse, whatever the output becomes. */
  const baseSegments = useMemo(() => parseConflicts(cf?.merged ?? ""), [cf])
  const blocks = useMemo(() => baseSegments.filter((s): s is ConflictBlock => s.kind === "conflict"), [baseSegments])

  /* Each pane is one document for the highlighter (context + that side's lines); segments
     remember their line offset into it so rendering can index the token lines. */
  const { aDoc, bDoc, offsets } = useMemo(() => {
    const a: string[] = []
    const b: string[] = []
    const offsets = baseSegments.map((seg) => {
      const at = { a: a.length, b: b.length }
      if (seg.kind === "ctx") {
        a.push(...seg.lines)
        b.push(...seg.lines)
      } else {
        a.push(...seg.ours)
        b.push(...seg.theirs)
      }
      return at
    })
    return { aDoc: a.join("\n"), bDoc: b.join("\n"), offsets }
  }, [baseSegments])
  const aTokens = useShikiTokens(aDoc, file.path, dark)
  const bTokens = useShikiTokens(bDoc, file.path, dark)

  const [picks, setPicks] = useState<Picks>({})
  const [text, setText] = useState("")
  const [saving, setSaving] = useState(false)

  /* Reset when a different file loads (the view is reused across conflicts). */
  useEffect(() => {
    setPicks({})
    setText(renderPicks(baseSegments, {}))
  }, [baseSegments])

  /* A pick change splices into the live buffer (edits elsewhere survive); the picks state and
     the text move together. */
  const applyPicks = (next: Picks) => {
    setText((t) => applyPickDiff(baseSegments, blocks, t, picks, next))
    setPicks(next)
  }

  const derived = useMemo(() => renderPicks(baseSegments, picks), [baseSegments, picks])
  const dirty = text !== derived
  const remaining = useMemo(() => unresolvedCount(text), [text])
  const labels = sideLabels(ms, baseSegments)

  /* Same focus contract as DiffView: the overlay takes the keyboard on open (Escape lives
     in repo-view's shortcut handler) and hands it back on close — only if it still holds
     focus, so switching to another file doesn't yank focus and scroll back to the old row.
     And same file-row carve-out: opened from a row, the row keeps focus so ArrowUp/Down
     keeps walking the file list (cf. file-list.tsx onFileRowKeyDown). */
  useLayoutEffect(() => {
    const el = root.current
    const prev = document.activeElement as HTMLElement | null
    if (!prev?.closest("[data-file-row]")) el?.focus()
    return () => {
      if (el?.contains(document.activeElement)) prev?.focus?.()
    }
  }, [])

  /** Header checkbox of a side: none / some / all across every conflict that has lines. */
  const allState = (side: PickSide): "none" | "some" | "all" => {
    const states = blocks.filter((b) => b[side].length > 0).map((b) => sideState(picks, b, side))
    if (!states.length || states.every((s) => s === "none")) return "none"
    return states.every((s) => s === "all") ? "all" : "some"
  }

  const takeAll = (side: PickSide, on: boolean) =>
    applyPicks(blocks.reduce((acc, b) => setSide(acc, b, side, on), picks))

  const sideHeader = (side: PickSide, label: string, hint: string, deleted: boolean, cls: string) => {
    const state = allState(side)
    return (
      <div className={cn("sticky top-0 z-1 flex items-center gap-2 border-b bg-background px-2 py-1.5", cls)}>
        <Checkbox
          aria-label={side === "ours" ? messages.conflict.takeAllA : messages.conflict.takeAllB}
          title={side === "ours" ? messages.conflict.takeAllA : messages.conflict.takeAllB}
          className="size-3.5"
          checked={state === "all"}
          indeterminate={state === "some"}
          disabled={blocks.every((b) => b[side].length === 0)}
          onCheckedChange={(on) => takeAll(side, on === true)}
        />
        <Badge color={side === "ours" ? "info" : "success"} shape="squared" className="font-semibold">
          {side === "ours" ? messages.conflict.sideA(label) : messages.conflict.sideB(label)}
        </Badge>
        <span className="truncate text-[0.625rem] text-muted-foreground">
          {hint}
          {deleted && ` · ${messages.conflict.deletedOnThisSide}`}
        </span>
      </div>
    )
  }

  return (
    <div ref={root} tabIndex={-1} className="flex min-h-0 flex-1 flex-col px-4.5 py-4 outline-none">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="text-xs break-all text-muted-foreground">{file.path}</span>
          <Badge color="danger" shape="squared" className="shrink-0 tabular-nums">
            {file.st}
          </Badge>
        </span>
        <IconButton label={messages.conflict.close} icon={Cancel01Icon} onClick={onClose} />
      </div>

      {error ? (
        <p className="shrink-0 text-xs text-muted-foreground">{messages.conflict.unavailable}</p>
      ) : !cf ? (
        <AsyncHint className="shrink-0 py-1">{messages.conflict.loading}</AsyncHint>
      ) : (
        <>
          {/* --- The two sides, aligned segment by segment: each pair of cells shares a grid
              row, so a 2-line A block faces a 5-line B block without manual padding --- */}
          <div className="min-h-0 flex-[3] overflow-y-auto rounded-md border">
            <div className="grid grid-cols-2">
              {sideHeader("ours", labels.a, messages.conflict.oursHint, cf.ours === null, "")}
              {sideHeader("theirs", labels.b, messages.conflict.theirsHint, cf.theirs === null, "border-l")}
              {baseSegments.map((seg, i) =>
                seg.kind === "ctx" ? (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid">
                    <PaneCell lines={seg.lines} tokens={aTokens} start={offsets[i].a} />
                    <PaneCell lines={seg.lines} tokens={bTokens} start={offsets[i].b} className="border-l" />
                  </div>
                ) : (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid">
                    <div className="col-span-2 border-y bg-muted/60 px-2 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
                      {messages.conflict.conflictN(seg.index + 1)}
                    </div>
                    <ChunkSide
                      block={seg}
                      side="ours"
                      picks={picks}
                      tokens={aTokens}
                      start={offsets[i].a}
                      onPicks={applyPicks}
                    />
                    <ChunkSide
                      block={seg}
                      side="theirs"
                      picks={picks}
                      tokens={bTokens}
                      start={offsets[i].b}
                      onPicks={applyPicks}
                      className="border-l"
                    />
                  </div>
                )
              )}
            </div>
          </div>

          {/* --- Merged output: the editable, highlighted buffer that "Mark as resolved" writes --- */}
          <div className="mt-3 flex min-h-0 flex-[2] shrink-0 flex-col">
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
              <span className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                {messages.conflict.mergedOutput}
              </span>
              {dirty && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto shrink-0 py-0.5"
                  onClick={() => setText(renderPicks(baseSegments, picks))}
                >
                  {messages.conflict.resetToSelection}
                </Button>
              )}
            </div>
            <OutputEditor
              value={text}
              onChange={setText}
              path={file.path}
              dark={dark}
              ariaLabel={messages.conflict.mergedOutput}
            />
            <div className="mt-2 flex shrink-0 items-center justify-between gap-3">
              <span className={cn("text-xs", remaining ? "text-destructive" : "text-success")}>
                {remaining ? messages.conflict.remaining(remaining) : messages.conflict.noMarkersLeft}
              </span>
              <Button
                className="h-auto flex-col gap-0 px-3 py-1"
                disabled={remaining > 0 || saving}
                aria-busy={saving}
                onClick={async () => {
                  setSaving(true)
                  try {
                    await onResolve(file.path, text)
                  } finally {
                    setSaving(false)
                  }
                }}
              >
                {messages.conflict.markResolved}
                <GitCmd cmd={`git add -- ${file.path}`} running={saving} className="text-primary-foreground/70" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
