/* Page cache (AUDIT.md §6/§10, tests item): LRU, viewport/selection pinning, `pageOfRow`.
   A fake `api.log` provides pages of 2 commits — no need for the layout engine for these
   properties, only the page layout matters. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createPageCache } from "./page-cache.ts"

const commit = (h: string): Commit => ({ h, p: [], d: "2026-01-01", a: "Ada", e: "ada@x.io", r: "", s: h })

/** fake `api.log(skip, count)`: 2 commits per page, hash = its rowStart. */
const fakeLog = (skip: number, count: number): Commit[] =>
  Array.from({ length: count }, (_, i) => commit(`c${skip + i}`))

describe("page-cache — pageOfRow", () => {
  it("finds the rightmost page whose rowStart doesn't exceed the row", () => {
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
  it("resolves a row's commit from the correct page", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    assert.equal(cache.commitAt(0)!.h, "c0")
    assert.equal(cache.commitAt(3)!.h, "c3")
  })

  it("returns undefined for a page never loaded", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    // page 1 (rows 2-3) never registered: pageOfRow(2) falls back to page 0 (rowStart <= 2),
    // whose commits only cover rows 0-1 — out-of-bounds access returns undefined
    assert.equal(cache.commitAt(2), undefined)
  })

  it("refill refills an evicted page without advancing nPages/pageRows", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    const before = cache.pageCount
    assert.equal(cache.refill(0, fakeLog(0, 2)), true)
    assert.equal(cache.pageCount, before, "refill does not add a page")
    assert.equal(cache.refill(5, fakeLog(0, 2)), false, "refill fails on an index never appended")
  })
})

describe("page-cache — LRU eviction with pinning", () => {
  it("evicts the least recently touched pages, outside viewport and selection", () => {
    const cache = createPageCache(2) // resident = 2 pages max
    cache.appendPage(0, fakeLog(0, 2)) // page 0: rows 0-1
    cache.appendPage(2, fakeLog(2, 2)) // page 1: rows 2-3
    cache.appendPage(4, fakeLog(4, 2)) // page 2: rows 4-5
    assert.equal(cache.size, 3, "beyond resident as long as evict() hasn't run")

    // viewport on page 2 (row 4), nothing selected: pages 0 and 1 are eviction candidates,
    // the oldest one (0, untouched since) leaves first.
    cache.evict([4, 5], [])
    assert.equal(cache.size, 2)
    assert.equal(cache.has(0), false, "page 0 evicted (outside viewport, not selected)")
    assert.equal(cache.has(2), true, "page 2 (viewport) stays resident")
  })

  it("pins selection pages even outside the current viewport", () => {
    const cache = createPageCache(2)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    cache.appendPage(4, fakeLog(4, 2))

    // viewport on page 2, but a selection lives on page 0: it must survive eviction
    // at the expense of page 1, neither viewed nor selected.
    cache.evict([4, 5], [0])
    assert.equal(cache.has(0), true, "selection page pinned")
    assert.equal(cache.has(1), false, "page neither viewed nor selected: evicted")
  })

  it("touches nothing as long as the page count stays under resident", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    cache.evict([0, 1], [])
    assert.equal(cache.size, 2)
  })
})
