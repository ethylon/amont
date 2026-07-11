/* Migré depuis lib/graph-layout.test.ts (AUDIT.md §6/§10, item tests) : mêmes cas pour
   `branchSegment`/`chainTip`, plus `chainInfo` sous sa forme structurée (item 3 — les strings
   françaises sortent du module d'algorithme, React les compose désormais). */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"
import { branchSegment, chainInfo, chainTip } from "./chains.ts"

/* fonction déclarée, pas fléchée : suivie d'un bloc nu, `=> ({…})` fait trébucher tsc */
function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

describe("branchSegment / chainTip — frontières de segment", () => {
  it("arrête un segment posé sur le tip de develop sans descendre dans le tronc", () => {
    /* une branche posée sur le tip de develop (aucun commit develop depuis le fork) : le
       segment s'arrête à develop, il ne descend pas dans le tronc (cas allix4,
       feature/business-refactor) — hash factices en hex, internés en id par layoutChunk. */
    const data = [
      c("f2", ["f1"], "wip", "HEAD -> refs/heads/feature/x"),
      c("f1", ["de"], "refactor: étape 1"),
      c("de", ["c1"], "fix filters", "refs/heads/develop, refs/remotes/origin/develop"),
      c("c1", ["c2"], "chore: bump"),
      c("c2", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.deepEqual(branchSegment(S, 0), [0, 1], "le segment s'arrête au tip de develop")
    assert.deepEqual(branchSegment(S, 2), [2, 3, 4], "le segment de develop descend le tronc")
    assert.equal(branchSegment(S, 2)[0], 2, "on ne grimpe pas au-dessus du tip de develop")
    assert.equal(chainTip(S, 3), 2, "le survol du tronc remonte à develop, pas à la feature")
  })

  it("ne coupe pas sur une distante en retard de la même branche, mais coupe sur une autre", () => {
    const data = [
      c("f2", ["f1"], "wip", "HEAD -> refs/heads/feature/x"),
      c("f1", ["de"], "refactor: étape 1", "refs/remotes/origin/feature/x"),
      c("de", ["c1"], "fix filters", "refs/remotes/origin/develop"),
      c("c1", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.deepEqual(branchSegment(S, 0), [0, 1], "origin/feature/x en retard reste dans le segment")
  })
})

describe("stash — nœud et arête pointillés, transparent pour les chaînes de branche", () => {
  it("marque le nœud et l'arête de stash, sans couper le segment de branche", () => {
    const data = [
      c("f1", ["de"], "wip", "HEAD -> refs/heads/feature/x"),
      { ...c("5a", ["de"], "WIP on develop: aaaa fix filters"), stash: { name: "stash@{0}", untracked: null } },
      c("de", ["c1"], "fix filters", "refs/heads/develop"),
      c("c1", [], "init"),
    ]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.equal(S.nodes[0][1].stash, true, "la ligne de stash porte son marqueur de nœud")
    assert.equal(S.fpEdge[1].dash, true, "l'arête du stash vers sa base est pointillée")
    assert.equal(S.fpEdge[0].dash, undefined, "les arêtes ordinaires restent pleines")
    assert.deepEqual(S.fpChildren.get(2), [0], "le stash n'est pas un enfant first-parent") // dv = ligne 2
    assert.deepEqual(branchSegment(S, 2), [2, 3], "le stash ne coupe pas le segment de develop")
  })
})

describe("chainInfo — données structurées (AUDIT.md §6, item 3)", () => {
  it("rend merged:false avec les refs du tip pour un segment non fusionné", () => {
    const data = [c("f1", ["f0"], "wip", "HEAD -> refs/heads/feature/x"), c("f0", [], "init")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)

    assert.deepEqual(chainInfo(S, [0, 1]), { refs: "feature/x", merged: false })
  })

  it("rend merged:false et refs:null sans aucune ref", () => {
    const data = [c("f1", [], "wip")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    assert.deepEqual(chainInfo(S, [0]), { refs: null, merged: false })
  })

  it("rend merged:true avec la cible et le hash complet du merge, sans le formater en texte", () => {
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
