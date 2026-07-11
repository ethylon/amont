/* Commit page cache, LRU with pinning (AUDIT.md §6): the "real" virtualization. A
   page = a raw `api.log` page (PAGE commits), anchored in the graph by `rowStart`.
   The Map's insertion order serves as the LRU: `touch` reinserts. Testable without a DOM — it's a
   Map + an array, no dependency on the render engine (cf. page-cache.test.ts). */

import type { Commit } from "../../../../../shared/types.ts"

export type Page = { commits: Commit[]; rowStart: number }

export function createPageCache(resident: number) {
  let pages = new Map<number, Page>()
  /* rowStart of each consumed raw page, increasing (a page emptied by folding duplicates
     the next one's — the lookup takes the rightmost one) */
  let pageRows: number[] = []
  let nPages = 0

  /** page containing the row: the rightmost one whose rowStart doesn't exceed `row` */
  function pageOfRow(row: number): number {
    let lo = 0
    let hi = pageRows.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pageRows[mid] <= row) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** refreshes the LRU position of a resident page */
  function touch(pi: number): void {
    const p = pages.get(pi)
    if (p) {
      pages.delete(pi)
      pages.set(pi, p)
    }
  }

  function commitAt(row: number): Commit | undefined {
    const p = pages.get(pageOfRow(row))
    return p && p.commits[row - p.rowStart]
  }

  /** are all pages covering [r0, r1] resident? Touches them along the way (LRU). */
  function isResident(r0: number, r1: number): boolean {
    for (let pi = pageOfRow(r0), last = pageOfRow(r1); pi <= last; pi++) {
      if (!pages.has(pi)) return false
      touch(pi)
    }
    return true
  }

  /** Registers a brand new page (arriving from `fetchMore`): advances `nPages`/`pageRows`. Returns
      its index. */
  function appendPage(rowStart: number, commits: Commit[]): number {
    const pi = nPages++
    pageRows.push(rowStart)
    pages.set(pi, { commits, rowStart })
    return pi
  }

  /** Refills an already-counted page (refetch of an evicted page, `ensureRows`) — advances neither
      `nPages` nor `pageRows`, already set by `appendPage`. `false` if `pi` never existed. */
  function refill(pi: number, commits: Commit[]): boolean {
    const rowStart = pageRows[pi]
    if (rowStart === undefined) return false
    pages.set(pi, { commits, rowStart })
    return true
  }

  function pageRowStart(pi: number): number | undefined {
    return pageRows[pi]
  }

  /** rowStart of the next page — serves as the expected length of page `pi` before
      `S.next` (the layout) has passed it. */
  function nextPageRowStart(pi: number): number | undefined {
    return pageRows[pi + 1]
  }

  /* A spread-out selection (an entire trunk segment) pins all of its pages — the `resident` bound
     is intentionally allowed to stretch for the duration of the selection, and tightens back up
     once it's cleared. */
  function evict(viewRowRange: readonly [number, number] | null, extraRows: Iterable<number>): void {
    if (pages.size <= resident || !pageRows.length) return
    const pinned = new Set<number>()
    if (viewRowRange) {
      for (let pi = pageOfRow(viewRowRange[0]), end = pageOfRow(viewRowRange[1]); pi <= end; pi++) pinned.add(pi)
    }
    for (const r of extraRows) pinned.add(pageOfRow(r))
    for (const pi of [...pages.keys()]) {
      if (pages.size <= resident) break
      if (!pinned.has(pi)) pages.delete(pi)
    }
  }

  function reset(): void {
    pages = new Map()
    pageRows = []
    nPages = 0
  }

  return {
    pageOfRow, touch, commitAt, isResident, appendPage, refill, pageRowStart, nextPageRowStart, evict, reset,
    has: (pi: number) => pages.has(pi),
    get size() {
      return pages.size
    },
    get pageCount() {
      return nPages
    },
  }
}

export type PageCache = ReturnType<typeof createPageCache>
