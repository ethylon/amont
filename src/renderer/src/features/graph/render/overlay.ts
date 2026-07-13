/* Overlay of long + dangling edges (AUDIT.md §6, perf item): before this module,
   `overlay.innerHTML = edgesSvg(S.long) + dangling` rebuilt the ENTIRE serialization of
   every known long edge on every page received — never virtualized, cumulative cost
   O(n²/PAGE) on a large repo. Here:
   - long edges are distributed into coarse buckets by row range as soon as they're
     resolved (`assignNew`), added incrementally (`insertAdjacentHTML`) to the bucket already
     mounted rather than reserializing everything;
   - `sync()` only mounts the buckets that intersect the viewport, like the short SVG chunks —
     the overlay grows with the history but its DOM footprint stays bounded to the viewport.
   Dangling edges (`S.pending`) are few (bounded by the number of open lanes, not by the
   size of the history) but `sync()` runs on every scroll event and RO tick: their group is
   fully rebuilt only when `S.pendingGen` (bumped by layoutChunk when `pending` actually
   mutates) or the graph height (the extension of the dashes to the bottom) moved —
   i.e. once per ingested page, never per scroll tick. */

import { OVERLAY_BUCKET } from "../constants.ts"
import type { Edge, LayoutState } from "../layout/state.ts"
import { edgePath } from "./geometry.ts"
import { stroke } from "./svg.ts"

const SVG_NS = "http://www.w3.org/2000/svg"

/** Coarse buckets touched by a long edge: bounded even for an edge that spans the entire
    history, since `OVERLAY_BUCKET` is a much coarser multiple of CHUNK. */
function bucketsOf(e: Edge): number[] {
  // always resolved: S.long only receives an edge after `e.r2 = row` (cf. layoutChunk)
  const lo = Math.floor(Math.min(e.r1, e.r2!) / OVERLAY_BUCKET)
  const hi = Math.floor(Math.max(e.r1, e.r2!) / OVERLAY_BUCKET)
  const out: number[] = []
  for (let b = lo; b <= hi; b++) out.push(b)
  return out
}

const edgeMarkup = (e: Edge) =>
  `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"${e.dash ? ' stroke-dasharray="3 3"' : ""}/>`

export function createOverlay() {
  /** mounted once and for all by the controller, before the short SVG chunks */
  const root = document.createElementNS(SVG_NS, "g")
  /** always mounted, last child of `root` — dangling edges draw in front of long ones */
  const dangling = document.createElementNS(SVG_NS, "g")
  root.appendChild(dangling)

  const buckets = new Map<number, Edge[]>()
  const mounted = new Map<number, SVGGElement>()
  /** how many of `S.long` have already been distributed into buckets — S.long only ever grows */
  let assignedLen = 0
  /* last (pendingGen, height) the dangling group was serialized against — `-1` forces the
     first rebuild (pendingGen starts at 0) */
  let danglingGen = -1
  let danglingHeight = -1

  function assignNew(S: LayoutState) {
    for (; assignedLen < S.long.length; assignedLen++) {
      const e = S.long[assignedLen]
      for (const b of bucketsOf(e)) {
        if (!buckets.has(b)) buckets.set(b, [])
        buckets.get(b)!.push(e)
        const g = mounted.get(b)
        if (g) g.insertAdjacentHTML("beforeend", edgeMarkup(e)) // bucket already visible: append, no rebuild
      }
    }
  }

  /** `viewRows`: range of rows the viewport currently intersects (same bounds as the
      short SVG chunks, cf. controller.ts); `height`: total height of the graph, to extend
      still-pending edges all the way down. */
  function sync(S: LayoutState, viewRows: readonly [number, number], height: number) {
    assignNew(S)
    const b0 = Math.floor(viewRows[0] / OVERLAY_BUCKET)
    const b1 = Math.floor(viewRows[1] / OVERLAY_BUCKET)

    mounted.forEach((g, b) => {
      if (b < b0 || b > b1) {
        g.remove()
        mounted.delete(b)
      }
    })
    for (let b = b0; b <= b1; b++) {
      if (mounted.has(b)) continue
      const g = document.createElementNS(SVG_NS, "g")
      g.innerHTML = (buckets.get(b) ?? []).map(edgeMarkup).join("")
      root.insertBefore(g, dangling)
      mounted.set(b, g)
    }

    /* gated rebuild (cf. header): `height` participates because a still-pending edge is
       drawn all the way down to the current bottom — a taller graph must re-extend the
       dashes even if `pending` itself hasn't moved */
    if (S.pendingGen === danglingGen && height === danglingHeight) return
    danglingGen = S.pendingGen
    danglingHeight = height
    let html = ""
    S.pending.forEach((list) =>
      list.forEach((e) => {
        html += `<path d="${edgePath(e, height)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6" stroke-dasharray="2 4" opacity="0.45"/>`
      })
    )
    dangling.innerHTML = html
  }

  /** Drops every bucketed edge and unmounts them. `assignedLen`, `buckets` and `mounted` are
      closure state that outlives a `LayoutState`: on a rebuild `S.long` restarts from zero
      while `assignedLen` is monotone, so without this `assignNew` would skip the first
      `assignedLen` edges of the new state and the stale buckets (old row positions) would keep
      mounting. Called in the same synchronous block as the remount, so the next `sync()`
      rebuilds against the fresh state. */
  function reset() {
    mounted.forEach((g) => g.remove())
    mounted.clear()
    buckets.clear()
    assignedLen = 0
    dangling.innerHTML = ""
    /* same monotony trap as `assignedLen`: the fresh state's pendingGen restarts at 0,
       which could collide with the stale fingerprint and skip the first rebuild */
    danglingGen = -1
    danglingHeight = -1
  }

  return { root, sync, reset }
}
