/* Migrated from lib/graph-layout.test.ts (AUDIT.md §6/§10, tests item): same cases for
   `collapsePairs`, including the pair straddling two log pages (last test), which locks in
   the limitation documented in collapse.ts ("page by page pairing"). */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { collapsePairs, foldStashes } from "./collapse.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

describe("collapsePairs", () => {
  it("merges two branch merges, twinned by the release tip (2nd common parent)", () => {
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    const mid = c("x1", ["y1"], "feat: entre les deux") // the pair isn't necessarily adjacent
    const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'", "tag: refs/tags/v1.2.0")
    const out = collapsePairs([dev, mid, mas])

    assert.equal(out.length, 2, "the pair merges into one capsule")
    const cap = out[0]
    assert.equal(cap.h, "d1", "the develop merge survives")
    assert.deepEqual(cap.p, ["dp", "mp", "rt"], "parents of both merges, release tip included")
    assert.equal(cap.cap?.absorbed, "m1", "the master merge stays resolvable via absorbed")
    assert.equal(cap.cap?.flow, "release")
    assert.equal(cap.cap?.version, "v1.2.0", "the semver tag on the master side gives the version")
    assert.deepEqual(cap.cap?.targets, ["master", "develop"])
    assert.equal(out[1].h, "x1", "the interleaved commit stays in place")
  })

  it("decides release vs hotfix via the master side's branch name", () => {
    const dev = c("d1", ["dp", "ht"], "Merge branch 'hotfix/1.2.1' into develop")
    const mas = c("m1", ["mp", "ht"], "Merge branch 'hotfix/1.2.1' into main")
    const cap = collapsePairs([dev, mas])[0]
    assert.equal(cap.cap?.flow, "hotfix")
    assert.deepEqual(cap.cap?.targets, ["main", "develop"])
  })

  it("pairs a develop merge with a master side landed as a GitHub PR", () => {
    /* parseMerge strips the owner from the PR source, so the twin match (same from,
       same release tip) works when the release reached master through a PR. */
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    const mas = c("m1", ["mp", "rt"], "Merge pull request #26 from ethylon/release/1.2.0")
    const cap = collapsePairs([dev, mas])[0]
    assert.equal(cap.cap?.flow, "release")
    assert.deepEqual(cap.cap?.targets, ["master", "develop"])
  })

  it('recognizes the "Merge tag" pattern (the develop merge\'s 2nd parent IS the master merge)', () => {
    const dev = c("d1", ["dp", "m1"], "Merge tag 'v1.2.0' into develop")
    const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'")
    const out = collapsePairs([dev, mas])

    assert.equal(out.length, 1)
    const cap = out[0]
    assert.deepEqual(cap.p, ["dp", "mp", "rt"])
    assert.equal(cap.cap?.version, "v1.2.0", "with no tag in the refs, the merged tag's name serves as the version")
    assert.equal(cap.cap?.flow, "release")
  })

  it("doesn't merge a feature merge into develop (not a version pattern)", () => {
    const rows = [
      c("d1", ["dp", "ft"], "Merge branch 'feature/x' into develop"),
      c("m1", ["mp", "ft"], "Merge branch 'feature/x'"),
    ]
    assert.deepEqual(collapsePairs(rows), rows)
  })

  it("doesn't merge if the master merge is more recent than the develop merge", () => {
    const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'")
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    assert.deepEqual(collapsePairs([mas, dev]), [mas, dev])
  })

  it("returns an orphan develop merge as-is (the master side is on another page)", () => {
    /* locks in the limitation documented in collapse.ts: pairing happens
       page by page, a pair straddling two log pages stays as 2 rows. */
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    assert.deepEqual(collapsePairs([dev]), [dev])
  })

  it("pairs two releases nested within the same page, each with its twin", () => {
    const dev2 = c("d2", ["d1", "r2"], "Merge branch 'release/1.3.0' into develop")
    const mas2 = c("m2", ["m1", "r2"], "Merge branch 'release/1.3.0'")
    const dev1 = c("d1", ["dp", "r1"], "Merge branch 'release/1.2.0' into develop")
    const mas1 = c("m1", ["mp", "r1"], "Merge branch 'release/1.2.0'")
    const out = collapsePairs([dev2, mas2, dev1, mas1])
    assert.deepEqual(
      out.map((x) => x.h),
      ["d2", "d1"]
    )
    assert.equal(out[0].cap?.absorbed, "m2")
    assert.equal(out[1].cap?.absorbed, "m1")
  })
})

describe("foldStashes", () => {
  it("folds a stash entry into a simple node and removes its plumbing", () => {
    const page = [
      c("ee1", ["a1", "ee2", "ee3"], "On develop: calibrage"),
      c("ee2", ["a1"], "index on develop: a1"),
      c("ee3", [], "untracked files on develop: a1"),
      c("a1", ["a0"], "feat: base"),
    ]
    const stashOf = new Map([["ee1", "stash@{0}"]])
    const plumbing = new Set(["ee2", "ee3"])
    const out = foldStashes(page, stashOf, plumbing)

    assert.deepEqual(
      out.map((c) => c.h),
      ["ee1", "a1"],
      "the plumbing (index, untracked) disappears"
    )
    assert.deepEqual(out[0].p, ["a1"], "only the base parent survives")
    assert.deepEqual(out[0].stash, { name: "stash@{0}", untracked: "ee3" })
  })

  it("returns the page unchanged when no stash is known", () => {
    const page = [c("a1", ["a0"], "feat: base")]
    assert.equal(foldStashes(page, new Map(), new Set()), page)
  })
})
