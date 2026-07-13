/* Migrated from lib/graph-layout.test.ts (AUDIT.md §6/§10, tests item): same cases for
   `branchSegment`/`chainTip`, plus `chainInfo` in its structured form (item 3 — the French
   strings move out of the algorithm module, React now composes them). */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"
import { branchSegment, chainInfo, chainTip } from "./chains.ts"

/* declared function, not an arrow one: followed by a bare block, `=> ({…})` trips up tsc */
function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

describe("branchSegment / chainTip — segment boundaries", () => {
  it("stops a segment at develop's tip without descending into the trunk", () => {
    /* a branch sitting on develop's tip (no develop commit since the fork): the
       segment stops at develop, it doesn't descend into the trunk (allix4 case,
       feature/business-refactor) — fake hex hashes, interned into ids by layoutChunk. */
    const data = [
      c("f2", ["f1"], "wip", "HEAD -> refs/heads/feature/x"),
      c("f1", ["de"], "refactor: étape 1"),
      c("de", ["c1"], "fix filters", "refs/heads/develop, refs/remotes/origin/develop"),
      c("c1", ["c2"], "chore: bump"),
      c("c2", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.deepEqual(branchSegment(S, 0), [0, 1], "the segment stops at develop's tip")
    assert.deepEqual(branchSegment(S, 2), [2, 3, 4], "develop's segment descends the trunk")
    assert.equal(branchSegment(S, 2)[0], 2, "we don't climb past develop's tip")
    assert.equal(chainTip(S, 3), 2, "hovering the trunk climbs back to develop, not to the feature")
  })

  it("doesn't cut on a lagging remote of the same branch, but cuts on another one", () => {
    const data = [
      c("f2", ["f1"], "wip", "HEAD -> refs/heads/feature/x"),
      c("f1", ["de"], "refactor: étape 1", "refs/remotes/origin/feature/x"),
      c("de", ["c1"], "fix filters", "refs/remotes/origin/develop"),
      c("c1", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.deepEqual(branchSegment(S, 0), [0, 1], "lagging origin/feature/x stays in the segment")
  })
})

describe("chainTip — per-row memoization (append-only layout)", () => {
  it("memoizes the tip for the queried row and every row crossed on the climb", () => {
    const data = [
      c("f3", ["f2"], "wip 3", "HEAD -> refs/heads/feature/x"),
      c("f2", ["f1"], "wip 2"),
      c("f1", ["f0"], "wip 1"),
      c("f0", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.equal(chainTip(S, 3), 0)
    assert.equal(S.tipOf.get(3), 0, "the queried row is memoized")
    assert.equal(S.tipOf.get(2), 0, "so is every intermediate row of the climb")
    assert.equal(S.tipOf.get(1), 0)
    assert.equal(chainTip(S, 1), 0, "a memo hit returns the same tip")
  })

  it("rides a memoized prefix for rows laid out after the first climb", () => {
    const data = [
      c("f4", ["f3"], "wip 4", "HEAD -> refs/heads/feature/x"),
      c("f3", ["f2"], "wip 3"),
      c("f2", ["f1"], "wip 2"),
      c("f1", ["f0"], "wip 1"),
      c("f0", [], "init"),
    ]
    const S = createState()
    /* two-phase layout, like pagination: entries memoized against the first window must
       stay valid once more rows land (that's what "append-only" buys us) */
    layoutChunk(S, (r) => data[r], 3)
    assert.equal(chainTip(S, 2), 0)
    layoutChunk(S, (r) => data[r], data.length)
    assert.equal(chainTip(S, 4), 0, "the new row's climb short-circuits on the memoized prefix")
    assert.equal(chainTip(S, 3), 0)
  })
})

describe("stash — dashed node and edge, transparent to branch chains", () => {
  it("marks the stash node and edge, without cutting the branch segment", () => {
    const data = [
      c("f1", ["de"], "wip", "HEAD -> refs/heads/feature/x"),
      { ...c("5a", ["de"], "WIP on develop: aaaa fix filters"), stash: { name: "stash@{0}", untracked: null } },
      c("de", ["c1"], "fix filters", "refs/heads/develop"),
      c("c1", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.equal(S.nodes[0][1].stash, true, "the stash row carries its node marker")
    assert.equal(S.fpEdge[1].dash, true, "the stash's edge to its base is dashed")
    assert.equal(S.fpEdge[0].dash, undefined, "ordinary edges stay solid")
    assert.deepEqual(S.fpChildren.get(2), [0], "the stash is not a first-parent child") // dv = row 2
    assert.deepEqual(branchSegment(S, 2), [2, 3], "the stash doesn't cut develop's segment")
  })
})

describe("chainInfo — structured data (AUDIT.md §6, item 3)", () => {
  it("returns merged:false with the tip's refs for an unmerged segment", () => {
    const data = [c("f1", ["f0"], "wip", "HEAD -> refs/heads/feature/x"), c("f0", [], "init")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.deepEqual(chainInfo(S, [0, 1]), { refs: "feature/x", merged: false })
  })

  it("returns merged:false and refs:null with no ref at all", () => {
    const data = [c("f1", [], "wip")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    assert.deepEqual(chainInfo(S, [0]), { refs: null, merged: false })
  })

  it("returns merged:true with the target and the merge's full hash, without formatting it as text", () => {
    const data = [
      c("m", ["main0", "f1"], "Merge branch 'feature/x' into develop", ""),
      c("f1", ["f0"], "wip", "refs/heads/feature/x"),
      c("f0", [], "init"),
      c("main0", [], "main"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    const info = chainInfo(S, [1, 2])
    assert.deepEqual(info, { refs: "feature/x", merged: true, mergedInto: "develop", mergeHash: "m" })
  })
})
