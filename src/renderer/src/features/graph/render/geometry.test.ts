/* Snapshots of `edgePath` (AUDIT.md §6/§10, tests item): the function only produces
   SVG `d=` strings, one case per path shape (pure vertical, adjacent row, standard
   curve, still-pending curve). Untested before the decomposition. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Edge } from "../layout/state.ts"
import { edgePath, X, Y } from "./geometry.ts"

const e = (partial: Partial<Edge> & Pick<Edge, "r1" | "l1" | "travel" | "k">): Edge => partial

describe("edgePath — SVG path snapshots", () => {
  it("pure vertical line: same lane from start to end", () => {
    assert.equal(edgePath(e({ r1: 0, l1: 2, travel: 2, k: 0, r2: 3, l2: 2 })), "M45 14V98")
  })

  it("adjacent rows (r2 - r1 === 1): a single Bezier curve, no vertical segment", () => {
    const path = edgePath(e({ r1: 0, l1: 0, travel: 1, k: 1, r2: 1, l2: 1 }))
    assert.equal(path, "M17 14C17 33.599999999999994 31 22.400000000000002 31 42")
  })

  it("standard curve (fork then convergence) over several rows", () => {
    const path = edgePath(e({ r1: 0, l1: 0, travel: 1, k: 1, r2: 2, l2: 2 }))
    assert.equal(path, "M17 14C17 39.2 31 16.8 31 42V42C31 67.2 45 44.8 45 70")
  })

  it("still-pending edge (r2 absent): extended to `yEnd`, with no final convergence", () => {
    const path = edgePath(e({ r1: 5, l1: 3, travel: 3, k: 0 }), 500)
    assert.equal(path, `M${X(3)} ${Y(5)}V500`)
  })
})
