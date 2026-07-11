import { useEffect, useRef } from "react"

import type { RepoApi } from "@/lib/git"
import { createGraph, type GraphCallbacks, type GraphHandle } from "../controller.ts"

type Props = {
  api: RepoApi
  callbacks: GraphCallbacks
  /** appelé avec le graphe au montage, avec `null` au démontage — un seul canal au lieu de
      `graphRef`+`onReady` (AUDIT.md §7, phase 5, item 6) : à l'appelant d'écrire `graph` dans
      sa propre ref s'il a besoin d'un accès synchrone hors rendu. */
  onReady(graph: GraphHandle | null): void
}

/* Coque React autour du contrôleur impératif (AUDIT.md §1, à préserver) : elle fournit les trois
   nœuds DOM et le cycle de vie, rien d'autre. Les callbacks passent par une ref pour qu'un
   handler qui change d'identité ne remonte jamais le graphe. */
export function CommitGraph({ api, callbacks, onReady }: Props) {
  const board = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)

  const cb = useRef(callbacks)
  cb.current = callbacks
  const ready = useRef(onReady)
  ready.current = onReady

  useEffect(() => {
    const graph = createGraph(board.current!, inner.current!, svg.current!, api, {
      onSelect: (r, a) => cb.current.onSelect(r, a),
      onBranchSelect: (r) => cb.current.onBranchSelect(r),
      onStats: (s) => cb.current.onStats(s),
      onGraphWidth: (px) => cb.current.onGraphWidth(px),
      onBranchWidth: (px) => cb.current.onBranchWidth(px),
      onError: (message) => cb.current.onError(message),
    })
    ready.current(graph)
    return () => {
      graph.destroy()
      ready.current(null)
    }
  }, [api])

  return (
    /* Grille ARIA (AUDIT.md §8) : "listbox" plutôt que "grid" — l'unité de navigation/sélection
       est la ligne entière (pas la cellule), ce que "listbox"/"option" décrit plus fidèlement ;
       l'audit laissait ce choix ouvert. Roving tabindex sur les lignes (interactions/selection.ts),
       flèches/PageUp/Down/Home/End/Enter pilotés par board.ts (posés sur `board`, cf. controller.ts). */
    <div ref={board} role="listbox" aria-label="Commits" aria-multiselectable="true" className="relative overflow-auto">
      <div ref={inner} className="relative">
        {/* décalé de la colonne branche : le métro commence après elle — décoratif, les commits
            se lisent dans les lignes HTML, pas dans ce tracé SVG */}
        <svg
          ref={svg}
          aria-hidden="true"
          className="amont-graph pointer-events-none absolute top-0 z-1"
          style={{ left: "var(--amont-branch, 0px)" }}
          xmlns="http://www.w3.org/2000/svg"
        />
      </div>
    </div>
  )
}
