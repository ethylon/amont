/* Sérialisation SVG (AUDIT.md §6) : arêtes et nœuds d'un chunk en markup, avec un cache par
   chunk — un chunk scellé (dont `nodes`/`edges` n'ont plus grandi depuis le dernier appel) rend
   la même chaîne sans re-sérialiser, ce qui évite de refaire le travail à chaque remontage
   (scroll loin puis retour) une fois l'historique de ce chunk connu en entier. */

import { laneColor, R } from "../constants.ts"
import type { Edge, GraphNode, LayoutState } from "../layout/state.ts"
import { X, Y, edgePath } from "./geometry.ts"

export const stroke = (e: Edge) => laneColor(e.travel)

export const edgesSvg = (list: Edge[]) =>
  list
    .map((e) =>
      `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"${e.dash ? ' stroke-dasharray="3 3"' : ""}/>`)
    .join("")

export const nodesSvg = (list: GraphNode[]) =>
  list
    .map((n) => {
      const c = laneColor(n.lane)
      if (n.stash) {
        /* Anneau pointillé, même grammaire que le point d'arbre de travail : un état
           suspendu, pas un commit d'historique. */
        return `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.4}" fill="var(--background)" stroke="${c}" stroke-width="1.5" stroke-dasharray="2.4 2.2"/>`
      }
      if (n.cap) {
        /* Losange du jalon : la release/hotfix atterrit ici, teinte du flow, pas de la lane. */
        const col = n.cap === "hotfix" ? "var(--destructive)" : "var(--release)"
        const x = X(n.lane), y = Y(n.row), r = R + 1.5
        return `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="${col}" stroke="var(--background)" stroke-width="1.5"/>`
      }
      return n.merge
        ? `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.8}" fill="var(--background)" stroke="${c}" stroke-width="1.8"/>`
        : `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R}" fill="${c}" stroke="var(--background)" stroke-width="1.5"/>`
    })
    .join("")

/** Cache de markup par chunk (AUDIT.md §6, item décomposition « svg avec cache de markup par
    chunk »). Un chunk ne grandit qu'en fin de flux (append-only) : tant que ses tableaux
    `edges`/`nodes` n'ont pas changé de longueur depuis le dernier rendu, la chaîne précédente
    reste valide — inutile de refaire `.map().join()` sur des centaines d'entrées à chaque
    remontage d'un chunk déjà scellé (scroll loin puis retour). */
export function createMarkupCache() {
  const lastEdgeLen = new Map<number, number>()
  const lastNodeLen = new Map<number, number>()
  const html = new Map<number, string>()

  return {
    /** markup `<g>` d'un chunk : édges + nœuds, mémoïsé tant que le chunk n'a pas grandi. */
    chunkMarkup(ci: number, S: LayoutState): string {
      const edges = S.edges[ci] ?? []
      const nodes = S.nodes[ci] ?? []
      if (lastEdgeLen.get(ci) === edges.length && lastNodeLen.get(ci) === nodes.length) {
        const cached = html.get(ci)
        if (cached !== undefined) return cached
      }
      const markup = edgesSvg(edges) + nodesSvg(nodes)
      lastEdgeLen.set(ci, edges.length)
      lastNodeLen.set(ci, nodes.length)
      html.set(ci, markup)
      return markup
    },
  }
}
