import { useEffect, useMemo, useRef, useState } from "react"

import { worktreeCount } from "@/lib/git"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { useRepoStore, useRepoStoreApi } from "@/features/repo/repo-store"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { DiffView } from "@/features/diff/diff-view"
import { ErrorBoundary } from "@/app/error-boundary"
import type { GraphCallbacks } from "@/features/graph/controller"
import { CommitGraph } from "@/features/graph/react/commit-graph"

const WT_COUNTERS = [
  { key: "conflicts", color: "danger" },
  { key: "staged", color: "success" },
  { key: "unstaged", color: "warning" },
  { key: "untracked", color: "neutral" },
] as const

/* The graph engine (createGraph, features/graph/controller.ts, decomposed in phase 4): this
   component remains the React shell that provides it its three DOM nodes and callbacks. The
   measurements (graphW/branchW) no longer go through React state — `onGraphWidth`/`onBranchWidth`
   write CSS properties directly on the container, read by `.amont-wtrow`/the engine via
   `var()` (cf. app.css). */
export function GraphColumn() {
  const storeApi = useRepoStoreApi()
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const graphRef = useRepoStore((s) => s.graphRef)
  const rows = useRepoStore((s) => s.selection.rows)
  const view = useRepoStore((s) => s.ui.view)
  const diff = useRepoStore((s) => s.ui.diff)
  const diffMode = useRepoStore((s) => s.ui.diffMode)
  const setDiffMode = useRepoStore((s) => s.setDiffMode)
  const closeDiff = useRepoStore((s) => s.closeDiff)
  const showWorktree = useRepoStore((s) => s.showWorktree)

  const { data: rawWt } = useWorktreeQuery(api, repoId)
  const worktree = rawWt && worktreeCount(rawWt) ? rawWt : null

  const wrapRef = useRef<HTMLDivElement>(null)
  const [diffNonce, setDiffNonce] = useState(0)

  /* --- Selection: the store is the source of truth, the canvas only applies the classes --- */
  useEffect(() => {
    graphRef.current?.setSelection(rows)
  }, [rows, graphRef])

  const callbacks = useMemo<GraphCallbacks>(
    () => ({
      onSelect: (row, additive) => storeApi.getState().selectRow(row, additive),
      onBranchSelect: (row) => void storeApi.getState().selectBranch(row),
      onStats: (stats) => storeApi.getState().setStats(stats),
      onGraphWidth: (px) => wrapRef.current?.style.setProperty("--graphw", `${px}px`),
      onBranchWidth: (px) => wrapRef.current?.style.setProperty("--amont-branch", `${px}px`),
      /* `api.log` failures are no longer silent (AUDIT.md §6): the existing status badge
         (git op → refresh → resetAndLoad → showOp) carries this one too */
      onError: (message) => storeApi.getState().showOp(message, "danger"),
    }),
    [storeApi]
  )

  return (
    <div ref={wrapRef} className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      {worktree && (
        <button
          type="button"
          onClick={showWorktree}
          aria-current={view === "wt" ? "true" : undefined}
          className={cn(
            "amont-wtrow amont-drop relative flex h-8.5 w-full min-w-0 cursor-pointer items-center gap-2.5 border-b border-l-2 border-dashed border-l-transparent pr-4.5 text-left text-xs text-muted-foreground hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            view === "wt" && "border-l-primary bg-primary/10 text-foreground"
          )}
        >
          <span className="truncate font-medium">{messages.worktree.uncommittedChanges}</span>
          <span className="ms-auto flex gap-1">
            {WT_COUNTERS.map(({ key, color }) =>
              worktree[key].length ? (
                <Badge key={key} color={color} shape="squared" className="tabular-nums">
                  {worktree[key].length}
                </Badge>
              ) : null
            )}
          </span>
        </button>
      )}

      {/* the diff overlays the graph instead of unmounting it: scroll, selection and layout
          of the canvas survive its closing */}
      <div className="relative grid min-h-0">
        <CommitGraph
          api={api}
          callbacks={callbacks}
          onReady={(graph) => {
            graphRef.current = graph
            if (graph) void storeApi.getState().resetAndLoad()
          }}
        />
        {diff && (
          <div data-amont-keep-focus className="absolute inset-0 z-2 flex flex-col bg-background">
            <ErrorBoundary key={`${diff.file.path}:${diffNonce}`} onReset={() => setDiffNonce((n) => n + 1)}>
              <DiffView
                api={api}
                repoId={repoId}
                ctx={diff.ctx}
                file={diff.file}
                view={diffMode}
                onViewChange={setDiffMode}
                onClose={closeDiff}
              />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  )
}
