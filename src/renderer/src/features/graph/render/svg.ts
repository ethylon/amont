/* SVG serialization (AUDIT.md §6): a chunk's edges and nodes into markup, with a per-chunk
   cache — a sealed chunk (whose `nodes`/`edges` haven't grown since the last call) returns
   the same string without reserializing, which avoids redoing the work on every remount
   (scroll away then back) once that chunk's history is fully known. */

import { laneColor, R } from "../constants.ts"
import type { Edge, GraphNode, LayoutState } from "../layout/state.ts"
import { X, Y, edgePath } from "./geometry.ts"

export const stroke = (e: Edge) => laneColor(e.travel)

export const edgesSvg = (list: Edge[]) =>
  list
    .map(
      (e) =>
        `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"${e.dash ? ' stroke-dasharray="3 3"' : ""}/>`
    )
    .join("")

export const nodesSvg = (list: GraphNode[]) =>
  list
    .map((n) => {
      const c = laneColor(n.lane)
      if (n.stash) {
        /* Dashed ring, same grammar as the working-tree dot: a suspended
           state, not a history commit. */
        return `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.4}" fill="var(--background)" stroke="${c}" stroke-width="1.5" stroke-dasharray="2.4 2.2"/>`
      }
      if (n.cap) {
        /* Milestone diamond: the release/hotfix lands here, flow hue, not lane hue. */
        const col = n.cap === "hotfix" ? "var(--destructive)" : "var(--release)"
        const x = X(n.lane),
          y = Y(n.row),
          r = R + 1.5
        return `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="${col}" stroke="var(--background)" stroke-width="1.5"/>`
      }
      return n.merge
        ? `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.8}" fill="var(--background)" stroke="${c}" stroke-width="1.8"/>`
        : `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R}" fill="${c}" stroke="var(--background)" stroke-width="1.5"/>`
    })
    .join("")

/** Per-chunk markup cache (AUDIT.md §6, decomposition item "svg with per-chunk markup
    cache"). A chunk only grows at the end of the stream (append-only): as long as its
    `edges`/`nodes` arrays haven't changed length since the last render, the previous string
    stays valid — no need to redo `.map().join()` over hundreds of entries on every
    remount of an already-sealed chunk (scroll away then back). */
export function createMarkupCache() {
  const lastEdgeLen = new Map<number, number>()
  const lastNodeLen = new Map<number, number>()
  const html = new Map<number, string>()

  return {
    /** `<g>` markup for a chunk: edges + nodes, memoized as long as the chunk hasn't grown. */
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
