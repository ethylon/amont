import { useEffect, useRef, type RefObject } from "react"

import { createGraph, type GraphCallbacks, type GraphHandle } from "@/components/graph-canvas"

type Props = {
  /** rempli au montage, vidé au démontage — App pilote le graphe à travers cette ref */
  graphRef: RefObject<GraphHandle | null>
  callbacks: GraphCallbacks
  onReady(graph: GraphHandle): void
}

/* Coque React autour du canvas impératif : elle fournit les trois nœuds DOM et le cycle de
   vie, rien d'autre. Les callbacks passent par une ref pour qu'un handler qui change
   d'identité ne remonte jamais le graphe. */
export function CommitGraph({ graphRef, callbacks, onReady }: Props) {
  const board = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)

  const cb = useRef(callbacks)
  cb.current = callbacks
  const ready = useRef(onReady)
  ready.current = onReady

  useEffect(() => {
    const graph = createGraph(board.current!, inner.current!, svg.current!, {
      onSelect: (r, a) => cb.current.onSelect(r, a),
      onBranchSelect: (r) => cb.current.onBranchSelect(r),
      onHover: (i) => cb.current.onHover(i),
      onStats: (s) => cb.current.onStats(s),
      onGraphWidth: (px) => cb.current.onGraphWidth(px),
    })
    graphRef.current = graph
    ready.current(graph)
    return () => {
      graph.destroy()
      graphRef.current = null
    }
  }, [graphRef])

  return (
    <div ref={board} className="relative overflow-auto">
      <div ref={inner} className="relative">
        <svg ref={svg} className="gg-graph pointer-events-none absolute top-0 left-0 z-1" xmlns="http://www.w3.org/2000/svg" />
      </div>
    </div>
  )
}
