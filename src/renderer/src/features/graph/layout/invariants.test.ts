/* Invariants test on a real fixture (AUDIT.md §6/§10, tests item — "this is the one that locks
   in B1"). `fixtures/repo-log.json` is THIS repo's actual history (147 commits, all refs),
   captured once via `git log` with the same format as `main/git/queries.ts` `logPage`, parsed
   by the real `parseLogPage` — not a made-up fixture. Replays the full layout and checks:
   `rowOf` is bijective (locks in B1 — two distinct SHAs can never again claim the
   same row, unlike the old `hkey` truncated to 32 bits), every edge is resolved or
   pending, and no lane is shared by two edges at the same time. */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { collapsePairs } from "./collapse.ts"
import { layoutChunk } from "./lanes.ts"
import { createState, type Edge } from "./state.ts"

const fixturePath = fileURLToPath(new URL("./fixtures/repo-log.json", import.meta.url))
const raw: Commit[] = JSON.parse(readFileSync(fixturePath, "utf8"))
const commits = collapsePairs(raw)

const S = createState()
layoutChunk(S, (r) => commits[r], commits.length)
const allEdges: Edge[] = [...S.long, ...S.edges.flatMap((es) => es ?? [])]

describe("layout invariants — real fixture (147 commits, all refs)", () => {
  it("loads a non-trivial history correctly (guard rail for the fixture itself)", () => {
    assert.ok(commits.length > 50, "the fixture must cover a substantial history")
    assert.equal(S.next, commits.length, "all rows of the fixture are laid out")
  })

  it("rowOf is bijective: two distinct SHAs never claim the same row (locks in B1)", () => {
    const seen = new Set<number>()
    for (const [, row] of S.rowOf) {
      assert.equal(seen.has(row), false, `row ${row} claimed by more than one hash`)
      seen.add(row)
    }
  })

  it("every row round-trips to itself via ids.ts (internId/hashOf/rowOf consistent)", () => {
    for (let row = 0; row < S.next; row++) {
      const id = S.hashOf[row]
      assert.notEqual(id, undefined, `row ${row} has no hash id`)
      assert.equal(S.rowOf.get(id), row, `rowOf(hashOf(${row})) must return to ${row}`)
    }
  })

  it("every edge is resolved or stays explicitly pending — none is lost", () => {
    // by construction, an edge only enters edges[]/long once resolved (e.r2 set,
    // cf. layoutChunk): this assertion documents the invariant, not a mere tautology —
    // it prevents a regression that would push an unresolved edge into these arrays.
    for (const e of allEdges) assert.notEqual(e.r2, undefined, "unresolved edge in edges[]/long")
    // the full history (git log --all, no --shallow) leaves no parent out of reach
    assert.equal(S.pending.size, 0, "no edge should remain pending on a complete history")
  })

  it("no lane is occupied by two independent edges at the same time (no doubled-up lane)", () => {
    /* Two edges can legitimately share a lane over overlapping rows IF
       they converge on the same node (shared endpoint) — a fork where several children hold
       their first-parentage from the same commit, or a merge's second parent that cuts through
       the lane of an already-running chain to reach its target node (cf. `edgePath`, an adjacent
       edge's curve only truly "occupies" the lane at its arrival point, not along its whole run).
       An overlap that shares NEITHER the start NOR the end would, on the other hand, be a genuine
       double reservation of the same lane by two independent chains. */
    const byLane = new Map<number, [number, number][]>()
    for (const e of allEdges) {
      const list = byLane.get(e.travel) ?? []
      list.push([e.r1, e.r2!])
      byLane.set(e.travel, list)
    }
    for (const [lane, intervals] of byLane) {
      intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      for (let i = 1; i < intervals.length; i++) {
        const prev = intervals[i - 1]
        const cur = intervals[i]
        const overlaps = cur[0] < prev[1]
        const sharesEndpoint = cur[1] === prev[1] || cur[0] === prev[0]
        assert.ok(
          !overlaps || sharesEndpoint,
          `lane ${lane}: overlap with no shared node between [${prev}] and [${cur}]`
        )
      }
    }
  })
})
