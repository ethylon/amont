import { useEffect, useRef, type RefObject } from "react"

import type { RepoApi } from "@/lib/git"
import { createGraph, type GraphCallbacks, type GraphHandle } from "@/components/graph-canvas"

type Props = {
  /** rempli au montage, vidé au démontage — RepoView pilote le graphe à travers cette ref */
  graphRef: RefObject<GraphHandle | null>
  api: RepoApi
  callbacks: GraphCallbacks
  onReady(graph: GraphHandle): void
}

/* Coque React autour du canvas impératif : elle fournit les trois nœuds DOM et le cycle de
   vie, rien d'autre. Les callbacks passent par une ref pour qu'un handler qui change
   d'identité ne remonte jamais le graphe. */
export function CommitGraph({ graphRef, api, callbacks, onReady }: Props) {
  const board = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const map = useRef<HTMLCanvasElement>(null)

  const cb = useRef(callbacks)
  cb.current = callbacks
  const ready = useRef(onReady)
  ready.current = onReady

  useEffect(() => {
    const graph = createGraph(board.current!, inner.current!, svg.current!, map.current!, api, {
      onSelect: (r, a) => cb.current.onSelect(r, a),
      onBranchSelect: (r) => cb.current.onBranchSelect(r),
      onHover: (i) => cb.current.onHover(i),
      onStats: (s) => cb.current.onStats(s),
      onGraphWidth: (px) => cb.current.onGraphWidth(px),
      onBranchWidth: (px) => cb.current.onBranchWidth(px),
    })
    graphRef.current = graph
    ready.current(graph)
    return () => {
      graph.destroy()
      graphRef.current = null
    }
  }, [api, graphRef])

  return (
    <div className="flex min-h-0 min-w-0">
      <div ref={board} className="relative min-w-0 flex-1 overflow-auto">
        <div ref={inner} className="relative">
          {/* décalé de la colonne branche : le métro commence après elle */}
          <svg
            ref={svg}
            className="gg-graph pointer-events-none absolute top-0 z-1"
            style={{ left: "var(--gg-branch, 0px)" }}
            xmlns="http://www.w3.org/2000/svg"
          />
        </div>
      </div>
      {/* minimap de flow : le dépôt entier à l'échelle, viewport et bandes release/hotfix */}
      <canvas ref={map} className="w-3.5 shrink-0 cursor-pointer touch-none border-l" />
    </div>
  )
}
