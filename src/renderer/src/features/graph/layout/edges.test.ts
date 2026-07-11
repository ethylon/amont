/* Topologie d'arêtes (AUDIT.md §6/§10, item tests) : résolution des arêtes en attente
   (`pending`), bucketing court (edges[ci]) vs long (S.long) selon que l'arête traverse un chunk
   ou non, et arêtes dangling (parent jamais rencontré). Non testé avant la décomposition. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { CHUNK } from "../constants.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

/** traite `commits` par lots de CHUNK, exactement comme le contrôleur (`data/loader.ts`). */
function layoutAll(commits: Commit[]) {
  const S = createState()
  const at = (r: number) => commits[r]
  while (S.next < commits.length) layoutChunk(S, at, commits.length)
  return S
}

describe("layoutChunk — résolution et bucketing des arêtes", () => {
  it("route une arête courte (r1/r2 dans le même chunk) vers edges[ci]", () => {
    const data = [c("m", ["root0", "root1"], "Merge"), c("root0", [], "racine 0"), c("root1", [], "racine 1")]
    const S = layoutAll(data)
    assert.equal(S.edges[0]?.some((e) => e.r1 === 0 && e.r2 === 1), true, "arête vers root0 (ligne 1)")
    assert.equal(S.edges[0]?.some((e) => e.r1 === 0 && e.r2 === 2), true, "arête vers root1 (ligne 2)")
    assert.equal(S.long.length, 0, "aucune arête longue attendue ici")
  })

  it("route une arête inter-chunks (r1 et r2 dans des chunks différents) vers S.long", () => {
    /* row0 : merge dont le second parent ("far") n'apparaît qu'après CHUNK lignes de remplissage
       — donc dans le chunk suivant. Le premier parent est une racine immédiate (chunk courant). */
    const filler = Array.from({ length: CHUNK }, (_, k) => c(`f${k}`, [], `remplissage ${k}`))
    const data = [c("m", ["root0", "far"], "Merge"), c("root0", [], "racine"), ...filler, c("far", [], "racine lointaine")]
    const S = layoutAll(data)
    const farRow = data.length - 1
    assert.ok(Math.floor(farRow / CHUNK) > 0, "la ligne lointaine tombe bien dans un autre chunk")
    assert.equal(S.long.some((e) => e.r1 === 0 && e.r2 === farRow), true, "l'arête traverse les chunks : S.long")
    assert.equal((S.edges[0] ?? []).some((e) => e.r1 === 0 && e.r2 === farRow), false, "pas dans edges[0]")
  })

  it("laisse une arête dangling en attente quand son parent n'apparaît jamais", () => {
    const data = [c("tip", ["ghost"], "parent hors fenêtre")]
    const S = layoutAll(data)
    assert.equal(S.pending.has("ghost"), true, "l'arête vers un parent absent reste en pending")
    assert.equal(S.pending.get("ghost")![0].r1, 0)
    assert.equal(S.pending.get("ghost")![0].r2, undefined, "jamais résolue")
  })
})
