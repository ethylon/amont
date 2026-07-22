import { lazy, Suspense, useMemo, useRef, useState } from "react"

import { worktreeCount } from "@/lib/git"
import { useStatusQuery } from "@/features/repo/repo-queries"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { useRepoStore, useRepoStoreApi } from "@/features/repo/repo-store"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ErrorBoundary } from "@/app/error-boundary"
import type { GraphCallbacks } from "@/features/graph/controller"
import { CommitGraph } from "@/features/graph/react/commit-graph"
import { CommitMenu, CreateTagDialog, ResetDialog, type CommitMenuTarget } from "@/features/graph/react/commit-menu"

/* Code-split at the overlay seam (perf audit, finding 6): both views render behind store
   state (ui.diff / ui.conflict), never on first paint, and DiffView alone drags diff2html
   (JS + CSS) into whatever chunk imports it — lazy keeps all of it out of the entry. The
   overlay div below already paints an opaque bg-background panel, and each view brings its
   own loading state once mounted, so a null Suspense fallback just shows the empty panel
   for the frame the chunk takes to load. */
const DiffView = lazy(() => import("@/features/diff/diff-view").then((m) => ({ default: m.DiffView })))
const ConflictView = lazy(() => import("@/features/conflict/conflict-view").then((m) => ({ default: m.ConflictView })))
const FileHistoryView = lazy(() =>
  import("@/features/history/file-history-view").then((m) => ({ default: m.FileHistoryView }))
)

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
  const view = useRepoStore((s) => s.ui.view)
  const diff = useRepoStore((s) => s.ui.diff)
  const diffMode = useRepoStore((s) => s.ui.diffMode)
  const setDiffMode = useRepoStore((s) => s.setDiffMode)
  const closeDiff = useRepoStore((s) => s.closeDiff)
  const conflict = useRepoStore((s) => s.ui.conflict)
  const closeConflict = useRepoStore((s) => s.closeConflict)
  const fileHistory = useRepoStore((s) => s.ui.fileHistory)
  const closeFileHistory = useRepoStore((s) => s.closeFileHistory)
  const resolveConflict = useRepoStore((s) => s.resolveConflict)
  const showWorktree = useRepoStore((s) => s.showWorktree)

  const { data: rawWt } = useWorktreeQuery(api, repoId)
  const worktree = rawWt && worktreeCount(rawWt) ? rawWt : null
  /* current branch for the commit menu's reset entry (label + detached-HEAD disable);
     same query key the toolbar reads — react-query dedupes */
  const currentBranch = useStatusQuery(api, repoId).data?.branch ?? null

  const wrapRef = useRef<HTMLDivElement>(null)
  const [diffNonce, setDiffNonce] = useState(0)

  /* Commit context menu (imperative rows → React menu): the right-clicked row is resolved
     here, before the Base UI trigger opens — a click outside a commit row (empty space, a
     stash entry) swallows the event so no menu opens on nothing. */
  const [menuTarget, setMenuTarget] = useState<CommitMenuTarget | null>(null)
  const [tagAt, setTagAt] = useState<string | null>(null)
  const [resetAt, setResetAt] = useState<string | null>(null)

  /* No selection-syncing effect here: the store is the source of truth AND already pushes
     every `selection.rows` change to the canvas imperatively — all selection writes go
     through `applySelection` (features/repo/store/selection.ts), the single place that
     pairs the state update with `g.setSelection(...)`. Mirroring it through a subscription
     would only re-render this whole column on every commit click to re-apply what the
     canvas already displays. */

  const callbacks = useMemo<GraphCallbacks>(
    () => ({
      onSelect: (row, additive) => storeApi.getState().selectRow(row, additive),
      onBranchSelect: (row) => void storeApi.getState().selectBranch(row),
      onStats: (stats) => storeApi.getState().setStats(stats),
      onGraphWidth: (px) => wrapRef.current?.style.setProperty("--graphw", `${px}px`),
      onBranchWidth: (px) => wrapRef.current?.style.setProperty("--amont-branch", `${px}px`),
      /* `api.log` failures are no longer silent (AUDIT.md §6): the existing status badge
         (git op → refresh → hardReload → showOp) carries this one too */
      onError: (message) => storeApi.getState().showOp(message, "danger"),
      onWorktreeOpen: (path) => void storeApi.getState().openWorktree(path),
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
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <div
              className="relative grid min-h-0"
              onContextMenuCapture={(ev) => {
                const rowEl = (ev.target as HTMLElement).closest<HTMLElement>(".amont-row")
                const row = rowEl ? Number(rowEl.dataset.i) : null
                const c = row !== null ? graphRef.current?.commit(row) : undefined
                /* not a commit row (empty space, overlay, stash entry): the capture-phase stop
                   keeps the event from ever reaching the trigger's own listener — no menu */
                if (!c || c.stash) {
                  ev.preventDefault()
                  ev.stopPropagation()
                  return
                }
                /* the menu acts on the commit the user is looking at: select it like a click */
                storeApi.getState().selectRow(row!, false)
                setMenuTarget({ hash: c.h })
              }}
            />
          }
        >
          <CommitGraph
            api={api}
            callbacks={callbacks}
            onReady={(graph) => {
              graphRef.current = graph
              /* bootstrap load: nothing is open yet, so hard vs soft makes no difference —
                 hard keeps the "fresh graph, commits view" posture explicit */
              if (graph) void storeApi.getState().hardReload()
            }}
          />
          {diff && (
            <div data-amont-keep-focus className="absolute inset-0 z-2 flex flex-col bg-background">
              <ErrorBoundary key={`${diff.file.path}:${diffNonce}`} onReset={() => setDiffNonce((n) => n + 1)}>
                {/* Suspense inside the boundary: a failed chunk load surfaces as the same
                  reset-able error card as a render throw */}
                <Suspense fallback={null}>
                  <DiffView
                    api={api}
                    repoId={repoId}
                    ctx={diff.ctx}
                    file={diff.file}
                    view={diffMode}
                    onViewChange={setDiffMode}
                    onClose={closeDiff}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          {conflict && (
            <div data-amont-keep-focus className="absolute inset-0 z-2 flex flex-col bg-background">
              <ErrorBoundary key={`${conflict.path}:${diffNonce}`} onReset={() => setDiffNonce((n) => n + 1)}>
                <Suspense fallback={null}>
                  <ConflictView
                    api={api}
                    repoId={repoId}
                    file={conflict}
                    onClose={closeConflict}
                    onResolve={resolveConflict}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
          {fileHistory && (
            <div data-amont-keep-focus className="absolute inset-0 z-2 flex bg-background">
              <ErrorBoundary
                key={`${fileHistory.from}:${fileHistory.path}:${diffNonce}`}
                onReset={() => setDiffNonce((n) => n + 1)}
              >
                <Suspense fallback={null}>
                  <FileHistoryView
                    api={api}
                    repoId={repoId}
                    path={fileHistory.path}
                    from={fileHistory.from}
                    view={diffMode}
                    onViewChange={setDiffMode}
                    onClose={closeFileHistory}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </ContextMenuTrigger>
        {menuTarget && (
          <CommitMenu
            target={menuTarget}
            currentBranch={currentBranch}
            onCreateBranch={(hash) => storeApi.getState().openBranchCreate(hash)}
            onCreateWorktree={(hash) => storeApi.getState().openWorktreeCreate(hash)}
            onCreateTag={setTagAt}
            onReset={setResetAt}
          />
        )}
      </ContextMenu>

      {tagAt && <CreateTagDialog at={tagAt} onClose={() => setTagAt(null)} />}
      {resetAt && currentBranch && <ResetDialog branch={currentBranch} to={resetAt} onClose={() => setResetAt(null)} />}
    </div>
  )
}
