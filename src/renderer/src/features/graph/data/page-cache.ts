/* Cache de pages de commits, LRU avec épinglage (AUDIT.md §6) : la « vraie » virtualisation. Une
   page = une page brute de `api.log` (PAGE commits), ancrée dans le graphe par `rowStart`.
   L'ordre d'insertion de la Map sert de LRU : `touch` réinsère. Testable sans DOM — c'est un
   Map + un tableau, aucune dépendance au moteur de rendu (cf. page-cache.test.ts). */

import type { Commit } from "../../../../../shared/types.ts"

export type Page = { commits: Commit[]; rowStart: number }

export function createPageCache(resident: number) {
  let pages = new Map<number, Page>()
  /* rowStart de chaque page brute consommée, croissant (une page vidée par le repli duplique
     celui de la suivante — la recherche prend la plus à droite) */
  let pageRows: number[] = []
  let nPages = 0

  /** page contenant la ligne : la plus à droite dont le rowStart ne dépasse pas `row` */
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

  /** rafraîchit la position LRU d'une page résidente */
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

  /** toutes les pages couvrant [r0, r1] sont-elles résidentes ? Les touche au passage (LRU). */
  function isResident(r0: number, r1: number): boolean {
    for (let pi = pageOfRow(r0), last = pageOfRow(r1); pi <= last; pi++) {
      if (!pages.has(pi)) return false
      touch(pi)
    }
    return true
  }

  /** Enregistre une page toute neuve (arrivée de `fetchMore`) : avance `nPages`/`pageRows`. Rend
      son index. */
  function appendPage(rowStart: number, commits: Commit[]): number {
    const pi = nPages++
    pageRows.push(rowStart)
    pages.set(pi, { commits, rowStart })
    return pi
  }

  /** Regarnit une page déjà comptée (refetch d'une page évincée, `ensureRows`) — n'avance ni
      `nPages` ni `pageRows`, déjà posés par `appendPage`. `false` si `pi` n'a jamais existé. */
  function refill(pi: number, commits: Commit[]): boolean {
    const rowStart = pageRows[pi]
    if (rowStart === undefined) return false
    pages.set(pi, { commits, rowStart })
    return true
  }

  function pageRowStart(pi: number): number | undefined {
    return pageRows[pi]
  }

  /** rowStart de la page suivante — sert de longueur attendue à la page `pi` avant que
      `S.next` (le layout) ne l'ait dépassée. */
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
