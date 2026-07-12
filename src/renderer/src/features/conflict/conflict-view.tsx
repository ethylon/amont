/* Conflict resolution view — overlays the graph like DiffView (same slot, cf. graph-column).
   Two aligned panes make the sides unmistakable: A (ours, the checked-out branch, blue) on
   the left, B (theirs, the branch being merged in, green) on the right — labels come from
   MERGE_HEAD (merge-state query), falling back to the file's own conflict markers. Below,
   the merged output: an editable buffer seeded from the working file, patched by the
   per-conflict "Take A/B/both" actions, and hand-editable — it's the single source of truth,
   the panes re-derive from it on every change. "Mark as resolved" writes that buffer to the
   working file and stages it (`git add`), which is git's own definition of resolved. */

import { useEffect, useMemo, useRef, useState } from "react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import type { FileChange, MergeState, RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { conflictCount, parseConflicts, takeSide, type ConflictSegment, type Side } from "./conflict-parse"
import { useConflictQuery, useMergeStateQuery } from "./conflict-queries"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { GitCmd } from "@/components/ui/git-cmd"
import { IconButton } from "@/components/ui/icon-button"
import { Textarea } from "@/components/ui/textarea"

/* A = info (blue), B = success (green) — never the red/green of diffs: neither side is
   "removed", they're two competing additions. */
const SIDE_A = "bg-info/12"
const SIDE_B = "bg-success/12"

const CELL = "min-w-0 overflow-x-auto px-2 py-px font-mono text-xs leading-normal whitespace-pre [tab-size:4]"

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

  /* `edited` shadows the fetched working file: null = untouched. The buffer survives pane
     re-renders but not a close/reopen — deliberately, the file on disk is the durable copy. */
  const [edited, setEdited] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const text = edited ?? cf?.merged ?? ""

  const segments = useMemo(() => parseConflicts(text), [text])
  const remaining = conflictCount(segments)
  const labels = sideLabels(ms, segments)

  /* Same focus contract as DiffView: the overlay takes the keyboard on open (Escape lives
     in repo-view's shortcut handler) and hands it back on close. */
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    root.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const take = (index: number, side: Side) => setEdited(takeSide(text, index, side))

  const sideHeader = (letter: "A" | "B", label: string, hint: string, deleted: boolean, cls: string) => (
    <div className={cn("sticky top-0 z-1 flex items-baseline gap-2 border-b bg-background px-2 py-1.5", cls)}>
      <Badge color={letter === "A" ? "info" : "success"} shape="squared" className="font-semibold">
        {letter === "A" ? messages.conflict.sideA(label) : messages.conflict.sideB(label)}
      </Badge>
      <span className="truncate text-[0.625rem] text-muted-foreground">
        {hint}
        {deleted && ` · ${messages.conflict.deletedOnThisSide}`}
      </span>
    </div>
  )

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
              {sideHeader("A", labels.a, messages.conflict.oursHint, cf.ours === null, "")}
              {sideHeader("B", labels.b, messages.conflict.theirsHint, cf.theirs === null, "border-l")}
              {segments.map((seg, i) =>
                seg.kind === "ctx" ? (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid">
                    <PaneCell lines={seg.lines} />
                    <PaneCell lines={seg.lines} className="border-l" />
                  </div>
                ) : (
                  <div key={i} className="col-span-2 grid grid-cols-subgrid">
                    <div className="col-span-2 flex items-center gap-1 border-y bg-muted/60 px-2 py-0.5">
                      <span className="text-[0.625rem] font-medium text-muted-foreground">
                        {messages.conflict.conflictN(seg.index + 1)}
                      </span>
                      <span className="ms-auto flex gap-1">
                        <Button variant="ghost" size="sm" className="h-5 text-info" onClick={() => take(seg.index, "ours")}>
                          {messages.conflict.takeA}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 text-success"
                          onClick={() => take(seg.index, "theirs")}
                        >
                          {messages.conflict.takeB}
                        </Button>
                        <Button variant="ghost" size="sm" className="h-5" onClick={() => take(seg.index, "both")}>
                          {messages.conflict.takeBoth}
                        </Button>
                      </span>
                    </div>
                    <PaneCell lines={seg.ours} className={SIDE_A} />
                    <PaneCell lines={seg.theirs} className={cn(SIDE_B, "border-l")} />
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
              {edited !== null && (
                <Button variant="ghost" size="sm" className="h-auto py-0.5" onClick={() => setEdited(null)}>
                  {messages.conflict.restoreFile}
                </Button>
              )}
            </div>
            <Textarea
              aria-label={messages.conflict.mergedOutput}
              value={text}
              onChange={(e) => setEdited(e.target.value)}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none font-mono text-xs leading-normal whitespace-pre [tab-size:4]"
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
