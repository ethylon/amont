/* Edge topology (AUDIT.md §6/§10, tests item): resolution of pending edges
   (`pending`), short bucketing (edges[ci]) vs long (S.long) depending on whether the edge
   crosses a chunk or not, and dangling edges (parent never encountered). Untested before decomposition. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { CHUNK } from "../constants.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

/** processes `commits` in batches of CHUNK, exactly like the controller (`data/loader.ts`). */
function layoutAll(commits: Commit[]) {
  const S = createState()
  const at = (r: number) => commits[r]
  while (S.next < commits.length) layoutChunk(S, at, commits.length)
  return S
}

describe("layoutChunk — edge resolution and bucketing", () => {
  it("routes a short edge (r1/r2 in the same chunk) to edges[ci]", () => {
    const data = [c("m", ["root0", "root1"], "Merge"), c("root0", [], "racine 0"), c("root1", [], "racine 1")]
    const S = layoutAll(data)
    assert.equal(
      S.edges[0]?.some((e) => e.r1 === 0 && e.r2 === 1),
      true,
      "edge to root0 (row 1)"
    )
    assert.equal(
      S.edges[0]?.some((e) => e.r1 === 0 && e.r2 === 2),
      true,
      "edge to root1 (row 2)"
    )
    assert.equal(S.long.length, 0, "no long edge expected here")
  })

  it("routes a cross-chunk edge (r1 and r2 in different chunks) to S.long", () => {
    /* row0: merge whose second parent ("far") only appears after CHUNK filler rows
       — so in the next chunk. The first parent is an immediate root (current chunk). */
    const filler = Array.from({ length: CHUNK }, (_, k) => c(`f${k}`, [], `remplissage ${k}`))
    const data = [
      c("m", ["root0", "far"], "Merge"),
      c("root0", [], "racine"),
      ...filler,
      c("far", [], "racine lointaine"),
    ]
    const S = layoutAll(data)
    const farRow = data.length - 1
    assert.ok(Math.floor(farRow / CHUNK) > 0, "the far row does fall into another chunk")
    assert.equal(
      S.long.some((e) => e.r1 === 0 && e.r2 === farRow),
      true,
      "the edge crosses chunks: S.long"
    )
    assert.equal(
      (S.edges[0] ?? []).some((e) => e.r1 === 0 && e.r2 === farRow),
      false,
      "not in edges[0]"
    )
  })

  it("leaves a dangling edge pending when its parent never appears", () => {
    const data = [c("tip", ["ghost"], "parent hors fenêtre")]
    const S = layoutAll(data)
    assert.equal(S.pending.has("ghost"), true, "the edge to a missing parent stays pending")
    assert.equal(S.pending.get("ghost")![0].r1, 0)
    assert.equal(S.pending.get("ghost")![0].r2, undefined, "never resolved")
  })
})
