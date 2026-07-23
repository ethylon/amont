/* Lane allocator (AUDIT.md §6/§10, tests item): first-parent continuity and reuse
   of a freed lane. Neither property was tested before the decomposition — that's
   the whole point of isolating `layoutChunk` as a pure module. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

describe("layoutChunk — lane allocation and continuity", () => {
  it("keeps the same lane all along a linear first-parent chain", () => {
    const data = [c("c3", ["c2"], "trois"), c("c2", ["c1"], "deux"), c("c1", [], "un")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    assert.equal(S.laneOf[0], S.laneOf[1], "continuity between c3 and c2")
    assert.equal(S.laneOf[1], S.laneOf[2], "continuity between c2 and c1")
  })

  it("allocates a distinct lane for a merge's second parent", () => {
    const data = [c("m", ["main0", "feat0"], "Merge"), c("feat0", [], "feature"), c("main0", [], "main")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    assert.notEqual(S.laneOf[0], undefined)
    /* the first-parent (main0) continues in the merge's lane, the second one (feat0) opens another */
    assert.equal(S.laneOf[0], S.laneOf[2], "the first-parent inherits the merge's lane")
    assert.notEqual(S.laneOf[0], S.laneOf[1], "the second parent gets its own lane")
  })

  it("reuses the lane freed by a finished branch, rather than opening a new one", () => {
    /* row0: merge opening a lane for "b" (immediate root); row1 closes "b" and frees its
       lane; row2 is an independent root that must reclaim this free lane instead
       of allocating a third one. */
    const data = [
      c("m", ["a", "b"], "Merge"),
      c("b", [], "feature racine"),
      c("z", [], "racine indépendante, plus tard"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    const featureLane = S.laneOf[1]
    assert.equal(S.laneOf[2], featureLane, "the lane freed by row 1 is reused at row 2")
    assert.equal(S.lanes.length, 2, "no third lane was opened")
  })
})

describe("layoutChunk — pendingGen (dangling-edge overlay gate)", () => {
  it("bumps the generation when pending moves, and leaves it alone on a no-op chunk", () => {
    const data = [c("c2", ["c1"], "deux"), c("c1", [], "un")]
    const S = createState()
    assert.equal(S.pendingGen, 0)
    layoutChunk(S, (r) => data[r], data.length)
    assert.ok(S.pendingGen > 0, "rows with parents pushed into (then resolved out of) pending")
    const g = S.pendingGen
    layoutChunk(S, (r) => data[r], data.length) // end === S.next: nothing new to lay out
    assert.equal(S.pendingGen, g, "a chunk that laid out nothing doesn't invalidate the overlay")
  })
})
