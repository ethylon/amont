/* Markup cache: pure module, no DOM (edgesSvg/nodesSvg build strings only), so it runs under
   the Node test env. The cache is gated on edge/node counts alone, so the case worth pinning
   down is a chunk whose counts are unchanged across a rebuild but whose geometry differs — it
   must not return the stale memoized markup once the cache has been reset. */
import { describe, expect, it } from "vitest"

import { createMarkupCache } from "./svg.ts"
import { createState, type LayoutState } from "../layout/state.ts"

/** Minimal state carrying one chunk 0 with a single node at the given lane (no edges). */
function stateWithNode(lane: number): LayoutState {
  const S = createState()
  S.nodes[0] = [{ row: 0, lane, merge: false }]
  S.edges[0] = []
  return S
}

describe("createMarkupCache reset", () => {
  it("memoizes a sealed chunk between identical calls", () => {
    const cache = createMarkupCache()
    const S = stateWithNode(0)
    expect(cache.chunkMarkup(0, S)).toBe(cache.chunkMarkup(0, S))
  })

  it("returns stale markup when counts coincide across states without a reset", () => {
    const cache = createMarkupCache()
    const a = cache.chunkMarkup(0, stateWithNode(0))
    // same node/edge counts (1 node, 0 edges), different geometry (lane 5): the cache,
    // gated on counts alone, hands back the first render.
    const b = cache.chunkMarkup(0, stateWithNode(5))
    expect(b).toBe(a)
  })

  it("rebuilds against the new state after reset()", () => {
    const cache = createMarkupCache()
    const a = cache.chunkMarkup(0, stateWithNode(0))
    cache.reset()
    const b = cache.chunkMarkup(0, stateWithNode(5))
    expect(b).not.toBe(a)
    expect(b).toBe(createMarkupCache().chunkMarkup(0, stateWithNode(5)))
  })
})
