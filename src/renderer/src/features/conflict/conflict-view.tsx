/* Conflict resolution view — overlays the graph like DiffView (same slot, cf. graph-column).
   Two aligned panes make the sides unmistakable: A (ours, the checked-out branch, blue) on
   the left, B (theirs, the branch being merged in, green) on the right — labels come from
   MERGE_HEAD (merge-state query), falling back to the file's own conflict markers.

   Selection is click-ordered (cf. conflict-parse.ts Picks): the header checkbox takes a
   whole side across every conflict, the per-chunk checkbox takes one side of one conflict,
   the per-line +/- adds or removes a single line — and the output region of each conflict
   is exactly the picked lines IN THE ORDER THEY WERE CLICKED, no hardcoded A-before-B.
   Each picked line wears its 1-based position so that order stays visible.

   Below, the merged output stays hand-editable: typing switches to a manual overlay that
   shadows the derived text (the pickers freeze until "Undo edits", rather than silently
   discarding hand work). "Mark as resolved" enables once no markers remain and stages the
   file — git's own definition of resolved. */

import { useEffect, useMemo, useRef, useState } from "react"
import { Cancel01Icon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, MergeState, RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import {
  conflictCount,
  isPicked,
  parseConflicts,
  pickPosition,
  renderPicks,
  setSide,
  sideState,
  toggleLine,
  type ConflictBlock,
  type ConflictSegment,
  type LineRef,
  type Picks,
  type PickSide,
} from "./conflict-parse"
import { useConflictQuery, useMergeStateQuery } from "./conflict-queries"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { GitCmd } from "@/components/ui/git-cmd"
import { IconButton } from "@/components/ui/icon-button"
import { Textarea } from "@/components/ui/textarea"

/* A = info (blue), B = success (green) — never the red/green of diffs: neither side is
   "removed", they're two competing additions. */
const SIDE_TINT: Record<PickSide, string> = { ours: "bg-info/8", theirs: "bg-success/8" }
const PICKED_TINT: Record<PickSide, string> = { ours: "bg-info/20", theirs: "bg-success/20" }

const MONO = "font-mono text-xs leading-normal whitespace-pre [tab-size:4]"
const CELL = `min-w-0 overflow-x-auto px-2 py-px ${MONO}`

function PaneCell({ lines, className }: { lines: string[]; className?: string }) {
  return <pre className={cn(CELL, className)}>{lines.join("\n")}</pre>
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
  disabled,
  onPicks,
  className,
}: {
  block: ConflictBlock
  side: PickSide
  picks: Picks
  disabled: boolean
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
      disabled={disabled}
      className="my-px ms-0.5 size-4 shrink-0 opacity-50 hover:opacity-100 focus-visible:opacity-100"
      onClick={() => onPicks(toggleLine(picks, block.index, ref))}
    />
  )
  return (
    <div className={cn("flex min-w-0 flex-col", SIDE_TINT[side], className)}>
      <label
        className={cn(
          "flex items-center gap-1.5 px-1.5 py-1 text-[0.625rem] font-medium text-muted-foreground select-none",
          !disabled && lines.length > 0 && "cursor-pointer"
        )}
      >
        <Checkbox
          aria-label={side === "ours" ? messages.conflict.takeA : messages.conflict.takeB}
          className="size-3.5"
          checked={state === "all"}
          indeterminate={state === "some"}
          disabled={disabled || lines.length === 0}
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
            <div key={line} className={cn("flex min-w-max items-start", picked && PICKED_TINT[side])}>
              {lineButton(ref, picked)}
              {/* the 1-based click-order position: what makes "output order = click order" legible */}
              <span className="w-4 shrink-0 text-right text-[0.625rem] leading-normal text-muted-foreground tabular-nums">
                {pos}
              </span>
              <pre className={cn("flex-1 px-1.5", MONO, !picked && "text-muted-foreground/70")}>{l || " "}</pre>
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

  /* The base never moves while the view is open: panes and picks are anchored to the
     conflict indices of THIS parse, whatever the output becomes. */
  const baseSegments = useMemo(() => parseConflicts(cf?.merged ?? ""), [cf])
  const blocks = useMemo(() => baseSegments.filter((s) => s.kind === "conflict"), [baseSegments])

  const [picks, setPicks] = useState<Picks>({})
  /* `edited` shadows the derived output: null = the pickers drive. Typing freezes the
     pickers (disabled, not silently overridden) until "Undo edits" clears the overlay. */
  const [edited, setEdited] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const derived = useMemo(() => renderPicks(baseSegments, picks), [baseSegments, picks])
  const text = edited ?? derived
  const handEdited = edited !== null

  const remaining = conflictCount(useMemo(() => parseConflicts(text), [text]))
  const labels = sideLabels(ms, baseSegments)

  /* Same focus contract as DiffView: the overlay takes the keyboard on open (Escape lives
     in repo-view's shortcut handler) and hands it back on close. */
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    root.current?.focus()
    return () => prev?.focus?.()
  }, [])

  /** Header checkbox of a side: none / some / all across every conflict that has lines. */
  const allState = (side: PickSide): "none" | "some" | "all" => {
    const states = blocks.filter((b) => b[side].length > 0).map((b) => sideState(picks, b, side))
    if (!states.length || states.every((s) => s === "none")) return "none"
    return states.every((s) => s === "all") ? "all" : "some"
  }

  const takeAll = (side: PickSide, on: boolean) =>
    setPicks(blocks.reduce((acc, b) => setSide(acc, b, side, on), picks))

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
          disabled={handEdited || blocks.every((b) => b[side].length === 0)}
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
          <div className={cn("min-h-0 flex-[3] overflow-y-auto rounded-md border", handEdited && "opacity-60")}>
            <div className="grid grid-cols-2">
              {sideHeader("ours", labels.a, messages.conflict.oursHint, cf.ours === null, "")}
              {sideHeader("theirs", labels.b, messages.conflict.theirsHint, cf.theirs === null, "border-l")}
              {baseSegments.map((seg, i) =>
                seg.kind === "ctx" ? (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid">
                    <PaneCell lines={seg.lines} />
                    <PaneCell lines={seg.lines} className="border-l" />
                  </div>
                ) : (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid">
                    <div className="col-span-2 border-y bg-muted/60 px-2 py-0.5 text-[0.625rem] font-medium text-muted-foreground">
                      {messages.conflict.conflictN(seg.index + 1)}
                    </div>
                    <ChunkSide block={seg} side="ours" picks={picks} disabled={handEdited} onPicks={setPicks} />
                    <ChunkSide
                      block={seg}
                      side="theirs"
                      picks={picks}
                      disabled={handEdited}
                      onPicks={setPicks}
                      className="border-l"
                    />
                  </div>
                )
              )}
            </div>
          </div>

          {/* --- Merged output: the editable buffer that "Mark as resolved" will write --- */}
          <div className="mt-3 flex min-h-0 flex-[2] shrink-0 flex-col">
            <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2">
              <span className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
                {messages.conflict.mergedOutput}
              </span>
              {handEdited && (
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-[0.625rem] text-warning">{messages.conflict.handEdited}</span>
                  <Button variant="ghost" size="sm" className="h-auto shrink-0 py-0.5" onClick={() => setEdited(null)}>
                    {messages.conflict.restoreFile}
                  </Button>
                </span>
              )}
            </div>
            <Textarea
              aria-label={messages.conflict.mergedOutput}
              value={text}
              onChange={(e) => setEdited(e.target.value)}
              spellCheck={false}
              className={cn("min-h-0 flex-1 resize-none", MONO)}
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
                <GitCmd cmd={`git add -- ${file.path}`} className="text-primary-foreground/70" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
