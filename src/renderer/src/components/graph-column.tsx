import { useEffect, useMemo, useRef, useState } from "react"

import { worktreeCount } from "@/lib/git"
import { useWorktreeQuery } from "@/lib/queries"
import { useRepoStore, useRepoStoreApi } from "@/lib/repo-store"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CommitGraph } from "@/components/commit-graph"
import { DiffView } from "@/components/diff-view"
import { ErrorBoundary } from "@/components/error-boundary"
import type { GraphCallbacks } from "@/components/graph-canvas"

const WT_COUNTERS = [
  { key: "conflicts", color: "danger" },
  { key: "staged", color: "success" },
  { key: "unstaged", color: "warning" },
  { key: "untracked", color: "neutral" },
] as const

/* Le moteur du graphe (createGraph, phase 4) n'a pas bougé : ce composant reste la coque React
   qui lui fournit ses trois nœuds DOM et ses callbacks. Les mesures (graphW/branchW) ne
   repassent plus par du state React — `onGraphWidth`/`onBranchWidth` écrivent directement les
   propriétés CSS sur le conteneur, lu par `.gg-wtrow`/`graph-canvas` via `var()` (cf. app.css). */
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

  /* --- Sélection : la source de vérité est le store, le canvas ne fait qu'appliquer les classes --- */
  useEffect(() => {
    graphRef.current?.setSelection(rows)
  }, [rows, graphRef])

  const callbacks = useMemo<GraphCallbacks>(
    () => ({
      onSelect: (row, additive) => storeApi.getState().selectRow(row, additive),
      onBranchSelect: (row) => void storeApi.getState().selectBranch(row),
      onStats: (stats) => storeApi.getState().setStats(stats),
      onGraphWidth: (px) => wrapRef.current?.style.setProperty("--graphw", `${px}px`),
      onBranchWidth: (px) => wrapRef.current?.style.setProperty("--gg-branch", `${px}px`),
    }),
    [storeApi]
  )

  return (
    <div ref={wrapRef} className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
      {worktree && (
        <div
          onClick={showWorktree}
          className={cn(
            "gg-wtrow gg-drop relative flex h-8.5 min-w-0 cursor-pointer items-center gap-2.5 border-b border-l-2 border-dashed border-l-transparent pr-4.5 text-xs text-muted-foreground hover:bg-muted/60",
            view === "wt" && "border-l-primary bg-primary/10 text-foreground"
          )}
        >
          <span className="truncate font-medium">Modifications non validées</span>
          <span className="ms-auto flex gap-1">
            {WT_COUNTERS.map(({ key, color }) =>
              worktree[key].length ? (
                <Badge key={key} color={color} shape="squared" className="tabular-nums">
                  {worktree[key].length}
                </Badge>
              ) : null
            )}
          </span>
        </div>
      )}

      {/* le diff recouvre le graphe au lieu de le démonter : scroll, sélection et mise en
          page du canvas survivent à la fermeture */}
      <div className="relative grid min-h-0">
        <CommitGraph
          graphRef={graphRef}
          api={api}
          onReady={() => void storeApi.getState().resetAndLoad()}
          callbacks={callbacks}
        />
        {diff && (
          <div data-gg-keep-focus className="absolute inset-0 z-2 flex flex-col bg-background">
            <ErrorBoundary key={`${diff.file.path}:${diffNonce}`} onReset={() => setDiffNonce((n) => n + 1)}>
              <DiffView api={api} repoId={repoId} ctx={diff.ctx} file={diff.file} view={diffMode} onViewChange={setDiffMode} onClose={closeDiff} />
            </ErrorBoundary>
          </div>
        )}
      </div>
    </div>
  )
}
