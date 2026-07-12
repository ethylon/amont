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

describe("page-cache — isResident", () => {
  it("is true only when every page spanning the range is loaded", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2)) // page 0: rows 0-1
    cache.appendPage(2, fakeLog(2, 2)) // page 1: rows 2-3
    assert.equal(cache.isResident(0, 3), true, "both pages present")
    assert.equal(cache.isResident(0, 1), true)
  })

  it("is false as soon as one page in the range is missing, and promotes touched pages in the LRU", () => {
    const cache = createPageCache(2)
    cache.appendPage(0, fakeLog(0, 2)) // page 0
    cache.appendPage(2, fakeLog(2, 2)) // page 1
    cache.appendPage(4, fakeLog(4, 2)) // page 2

    // querying rows 0-1 touches page 0, making it the most-recently-used; a later evict must
    // then drop page 1 (now the oldest untouched) rather than page 0.
    assert.equal(cache.isResident(0, 1), true)
    cache.evict([4, 5], [])
    assert.equal(cache.has(0), true, "page 0 survived: it was touched by isResident")
    assert.equal(cache.has(1), false, "page 1 evicted as the least-recently-used")

    // page 1 is gone: a range that needs it is no longer resident
    assert.equal(cache.isResident(2, 3), false)
  })
})

describe("page-cache — pageRowStart / nextPageRowStart", () => {
  it("reports a page's rowStart and its successor's", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    assert.equal(cache.pageRowStart(0), 0)
    assert.equal(cache.pageRowStart(1), 2)
    assert.equal(cache.nextPageRowStart(0), 2, "rowStart of the following page")
    assert.equal(cache.nextPageRowStart(1), undefined, "no page after the last one")
    assert.equal(cache.pageRowStart(9), undefined, "unknown page")
  })
})

describe("page-cache — reset", () => {
  it("clears pages and the page counter", () => {
    const cache = createPageCache(10)
    cache.appendPage(0, fakeLog(0, 2))
    cache.appendPage(2, fakeLog(2, 2))
    assert.equal(cache.pageCount, 2)
    cache.reset()
    assert.equal(cache.size, 0)
    assert.equal(cache.pageCount, 0, "next appendPage starts numbering from 0 again")
    assert.equal(cache.appendPage(0, fakeLog(0, 2)), 0)
  })
})
