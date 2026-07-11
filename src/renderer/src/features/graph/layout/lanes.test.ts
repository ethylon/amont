/* Allocateur de lanes (AUDIT.md §6/§10, item tests) : continuité first-parent et réutilisation
   d'une lane libérée. Ces deux propriétés n'étaient pas testées avant la décomposition — c'est
   tout l'intérêt d'isoler `layoutChunk` en module pur. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

describe("layoutChunk — allocation et continuité de lanes", () => {
  it("garde la même lane tout le long d'une chaîne first-parent linéaire", () => {
    const data = [c("c3", ["c2"], "trois"), c("c2", ["c1"], "deux"), c("c1", [], "un")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    assert.equal(S.laneOf[0], S.laneOf[1], "continuité entre c3 et c2")
    assert.equal(S.laneOf[1], S.laneOf[2], "continuité entre c2 et c1")
  })

  it("alloue une lane distincte pour le second parent d'un merge", () => {
    const data = [c("m", ["main0", "feat0"], "Merge"), c("feat0", [], "feature"), c("main0", [], "main")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    assert.notEqual(S.laneOf[0], undefined)
    /* le first-parent (main0) continue dans la lane du merge, le second (feat0) en ouvre une autre */
    assert.equal(S.laneOf[0], S.laneOf[2], "le first-parent hérite la lane du merge")
    assert.notEqual(S.laneOf[0], S.laneOf[1], "le second parent obtient sa propre lane")
  })

  it("réutilise la lane libérée par une branche terminée, plutôt que d'en ouvrir une nouvelle", () => {
    /* row0 : merge ouvrant une lane pour "b" (racine immédiate) ; row1 clôt "b" et libère sa
       lane ; row2 est une racine indépendante qui doit reprendre cette lane libre au lieu
       d'en allouer une troisième. */
    const data = [c("m", ["a", "b"], "Merge"), c("b", [], "feature racine"), c("z", [], "racine indépendante, plus tard")]
    const S = createState()
    layoutChunk(S, (r) => data[r], data.length)
    const featureLane = S.laneOf[1]
    assert.equal(S.laneOf[2], featureLane, "la lane libérée par la ligne 1 est réutilisée en ligne 2")
    assert.equal(S.lanes.length, 2, "aucune troisième lane n'a été ouverte")
  })
})
