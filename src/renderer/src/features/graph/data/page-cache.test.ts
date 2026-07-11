/* Cache de pages (AUDIT.md §6/§10, item tests) : LRU, épinglage viewport/sélection, `pageOfRow`.
   Un faux `api.log` fournit des pages de 2 commits — pas besoin du moteur de layout pour ces
   propriétés, seul l'agencement des pages compte. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createPageCache } from "./page-cache.ts"

const commit = (h: string): Commit => ({ h, p: [], d: "2026-01-01", a: "Ada", e: "ada@x.io", r: "", s: h })

/** faux `api.log(skip, count)` : 2 commits par page, hash = son rowStart. */
const fakeLog = (skip: number, count: number): Commit[] =>
  Array.from({ length: count }, (_, i) => commit(`c${skip + i}`))

describe("page-cache — pageOfRow", () => {
  it("trouve la page la plus à droite dont le rowStart ne dépasse pas la ligne", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    cache.appendPage(4, fakeLog(4, 2))
    assert.equal(cache.pageOfRow(0), 0)
    assert.equal(cache.pageOfRow(1), 0)
    assert.equal(cache.pageOfRow(2), 1)
    assert.equal(cache.pageOfRow(5), 2)
  })
})

describe("page-cache — commitAt / appendPage / refill", () => {
  it("résout le commit d'une ligne depuis la bonne page", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    assert.equal(cache.commitAt(0)!.h, "c0")
    assert.equal(cache.commitAt(3)!.h, "c3")
  })

  it("rend undefined pour une page jamais chargée", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    // page 1 (lignes 2-3) jamais enregistrée : pageOfRow(2) retombe sur la page 0 (rowStart <= 2),
    // dont les commits ne couvrent que les lignes 0-1 — l'accès hors bornes rend undefined
    assert.equal(cache.commitAt(2), undefined)
  })

  it("refill regarnit une page évincée sans avancer nPages/pageRows", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    const before = cache.pageCount
    assert.equal(cache.refill(0, fakeLog(0, 2)), true)
    assert.equal(cache.pageCount, before, "refill n'ajoute pas de page")
    assert.equal(cache.refill(5, fakeLog(0, 2)), false, "refill échoue sur un index jamais append")
  })
})

describe("page-cache — évinction LRU avec épinglage", () => {
  it("évince les pages les moins récemment touchées, hors viewport et sélection", () => {
    const cache = createPageCache(2) // résident = 2 pages max
    cache.appendPage(0, fakeLog(0, 2)) // page 0 : lignes 0-1
    cache.appendPage(2, fakeLog(2, 2)) // page 1 : lignes 2-3
    cache.appendPage(4, fakeLog(4, 2)) // page 2 : lignes 4-5
    assert.equal(cache.size, 3, "au-delà du résident tant qu'evict() n'a pas tourné")

    // viewport sur la page 2 (ligne 4), rien en sélection : page 0 et 1 sont candidates à l'éviction,
    // la plus ancienne (0, jamais touchée depuis) part en premier.
    cache.evict([4, 5], [])
    assert.equal(cache.size, 2)
    assert.equal(cache.has(0), false, "page 0 évincée (hors viewport, non sélectionnée)")
    assert.equal(cache.has(2), true, "page 2 (viewport) reste résidente")
  })

  it("épingle les pages de la sélection même hors du viewport courant", () => {
    const cache = createPageCache(2)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    cache.appendPage(4, fakeLog(4, 2))

    // viewport sur la page 2, mais une sélection vit en page 0 : elle doit survivre à l'éviction
    // au détriment de la page 1, ni vue ni sélectionnée.
    cache.evict([4, 5], [0])
    assert.equal(cache.has(0), true, "page de la sélection épinglée")
    assert.equal(cache.has(1), false, "page ni vue ni sélectionnée : évincée")
  })

  it("ne touche à rien tant que le nombre de pages reste sous le résident", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    cache.evict([0, 1], [])
    assert.equal(cache.size, 2)
  })
})
