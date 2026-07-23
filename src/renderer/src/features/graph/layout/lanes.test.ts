/* Lane allocator (AUDIT.md §6/§10, tests item): first-parent continuity and reuse
   of a freed lane. Neither property was tested before the decomposition — that's
   the whole point of isolating `layoutChunk` as a pure module. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { chainFlow } from "./chains.ts"
import { collapsePairs } from "./collapse.ts"
import { createState } from "./state.ts"
import { layoutChunk, reserveTrunks } from "./lanes.ts"

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

describe("layoutChunk — lanes tronc réservées (reserveTrunks)", () => {
  it("master prend la lane 0 même quand une branche plus récente occupe le haut du graphe", () => {
    const data = [
      c("f1", ["m1"], "wip d'une branche sans ref"),
      c("m1", ["m0"], "tip de master", "refs/heads/master"),
      c("m0", [], "racine"),
    ]
    const S = createState()
    reserveTrunks(S, ["master"])
    layoutChunk(S, (r) => data[r], data.length)
    assert.equal(S.laneOf[1], 0, "master réclame sa lane réservée")
    assert.equal(S.laneOf[2], 0, "et la garde par continuité premier-parent")
    assert.notEqual(S.laneOf[0], 0, "la branche du dessus n'a jamais pu prendre la lane 0")
  })

  it("le parent master d'une capsule rouvre la lane réservée au lieu d'une lane quelconque", () => {
    const data = collapsePairs([
      c("dmerge", ["devprev", "tip"], "Merge branch 'hotfix/x' into develop", "refs/heads/develop"),
      c("mmerge", ["masterprev", "tip"], "Merge branch 'hotfix/x'", "refs/heads/master"),
      c("devprev", ["base"], "travail sur develop"),
      c("tip", ["masterprev"], "commit du hotfix"),
      c("masterprev", ["base"], "ancien master"),
      c("base", [], "racine commune"),
    ])
    assert.equal(data.length, 5, "la paire release/hotfix a bien été capsulée")
    const S = createState()
    reserveTrunks(S, ["master", "develop"])
    layoutChunk(S, (r) => data[r], data.length)
    assert.equal(S.laneOf[0], 1, "la capsule vit côté develop, lane réservée 1")
    assert.equal(S.laneOf[3], 0, "master repart sur sa lane 0 sous la capsule")
    assert.equal(S.laneOf[4], 0, "la racine commune reste sur la lane master")
    assert.ok(S.laneOf[2] >= S.reserved, "le hotfix n'empiète pas sur les lanes réservées")
    assert.equal(chainFlow(S, 2).flow, "hotfix", "la branche absorbée se classe hotfix via son merge")
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
