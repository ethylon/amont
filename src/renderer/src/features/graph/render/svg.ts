/* SVG serialization (AUDIT.md §6): a chunk's edges and nodes into markup, with a per-chunk
   cache — a sealed chunk (whose `nodes`/`edges` haven't grown since the last call) returns
   the same string without reserializing, which avoids redoing the work on every remount
   (scroll away then back) once that chunk's history is fully known. */

import { laneColor, R } from "../constants.ts"
import type { Edge, GraphNode, LayoutState } from "../layout/state.ts"
import type { SyncInfo } from "../layout/sync.ts"
import { X, Y, edgePath } from "./geometry.ts"

export const stroke = (e: Edge) => laneColor(e.travel)

/* Sync hue of a row: amber for the segment to push, blue for the one to pull.
   An edge belongs to the segment of its starting commit (r1). */
const syncColor = (row: number, sync?: SyncInfo | null) =>
  sync ? (sync.ahead.has(row) ? "var(--sync-ahead)" : sync.behind.has(row) ? "var(--sync-behind)" : null) : null

export const edgesSvg = (list: Edge[], sync?: SyncInfo | null) =>
  list
    .map((e) => {
      /* Dashes only on the segment to pull: those links don't exist locally yet. The
         segment to push is real local history — sync hue, but solid (same grammar as
         the nodes below). */
      const sc = syncColor(e.r1, sync)
      const dashed = e.dash || (sc !== null && sync!.behind.has(e.r1))
      return `<path d="${edgePath(e)}" fill="none" stroke="${sc ?? stroke(e)}" stroke-width="1.6"${dashed ? ' stroke-dasharray="3 3"' : ""}/>`
    })
    .join("")

export const nodesSvg = (list: GraphNode[], sync?: SyncInfo | null) =>
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
      /* Sync grammar: solid hollow ring = local not pushed yet (a commit that doesn't
         fully exist on the remote), dashed ring = remote not pulled yet — same vocabulary
         as the stash, but in the sync hue rather than the lane's. */
      const sc = syncColor(n.row, sync)
      if (sc) {
        return sync!.ahead.has(n.row)
          ? `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.4}" fill="var(--background)" stroke="${sc}" stroke-width="1.8"/>`
          : `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.4}" fill="var(--background)" stroke="${sc}" stroke-width="1.5" stroke-dasharray="2.4 2.2"/>`
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
    /** `<g>` markup for a chunk: edges + nodes, memoized as long as the chunk hasn't grown.
        `sync` is not part of the key: on a divergence change, the controller calls `reset()`
        then remounts the chunks — same contract as a layout rebuild. */
    chunkMarkup(ci: number, S: LayoutState, sync?: SyncInfo | null): string {
      const edges = S.edges[ci] ?? []
      const nodes = S.nodes[ci] ?? []
      if (lastEdgeLen.get(ci) === edges.length && lastNodeLen.get(ci) === nodes.length) {
        const cached = html.get(ci)
        if (cached !== undefined) return cached
      }
      const markup = edgesSvg(edges, sync) + nodesSvg(nodes, sync)
      lastEdgeLen.set(ci, edges.length)
      lastNodeLen.set(ci, nodes.length)
      html.set(ci, markup)
      return markup
    },
    /** Drops every memoized chunk. The cache is keyed by chunk index and gated only on
        edge/node counts, so it must be cleared when the graph is rebuilt against a fresh
        `LayoutState`: a chunk whose counts happen to coincide across the rebuild would
        otherwise render from the previous, geometrically-different layout. */
    reset() {
      lastEdgeLen.clear()
      lastNodeLen.clear()
      html.clear()
    },
  }
}
