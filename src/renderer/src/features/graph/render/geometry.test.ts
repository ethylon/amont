/* Snapshots de `edgePath` (AUDIT.md §6/§10, item tests) : la fonction ne produit que des
   chaînes `d=` SVG, un cas par forme de tracé (verticale pure, ligne adjacente, courbe standard,
   courbe encore en attente). Pas testée avant la décomposition. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Edge } from "../layout/state.ts"
import { edgePath, X, Y } from "./geometry.ts"

const e = (partial: Partial<Edge> & Pick<Edge, "r1" | "l1" | "travel" | "k">): Edge => partial as Edge

describe("edgePath — snapshots des tracés SVG", () => {
  it("trait vertical pur : même lane du départ à l'arrivée", () => {
    assert.equal(edgePath(e({ r1: 0, l1: 2, travel: 2, k: 0, r2: 3, l2: 2 })), "M45 14V98")
  })

  it("lignes adjacentes (r2 - r1 === 1) : une seule courbe de Bézier, pas de segment vertical", () => {
    const path = edgePath(e({ r1: 0, l1: 0, travel: 1, k: 1, r2: 1, l2: 1 }))
    assert.equal(path, "M17 14C17 33.599999999999994 31 22.400000000000002 31 42")
  })

  it("courbe standard (fork puis convergence) sur plusieurs lignes", () => {
    const path = edgePath(e({ r1: 0, l1: 0, travel: 1, k: 1, r2: 2, l2: 2 }))
    assert.equal(path, "M17 14C17 39.2 31 16.8 31 42V42C31 67.2 45 44.8 45 70")
  })

  it("arête encore en attente (r2 absent) : prolongée jusqu'à `yEnd`, sans convergence finale", () => {
    const path = edgePath(e({ r1: 5, l1: 3, travel: 3, k: 0 }), 500)
    assert.equal(path, `M${X(3)} ${Y(5)}V500`)
  })
})
