/* Ingestion pipeline (AUDIT.md §6): a single entry point, `ingest`, shared by `fetchMore` (next
   page), `ensureRows` (refill evicted pages) and `growUntil` (batch jumps)
   — before this module, `fetchMore`/`ensureRows` duplicated the same folding logic
   (`collapsePairs`/`foldStashes`), validation, and page insertion. Owns the layout state (`S`) and
   the page cache: the controller (render/interactions) reads them, never mutates them
   directly — eviction itself stays driven from the controller (`evict`), the only one to
   know the current viewport and selection.

   Errors: an `api.log` failure is no longer silent (perf/errors item) — `onError` is surfaced once
   per failure episode, not on every retry (scroll/sync keeps relaunching as long as nothing
   arrives). `jumpTo`/`rowsOf`/`nextMatch` load in concurrent, cancellable batches (token) instead
   of waiting for one page at a time: on a long-distance jump (old ref), IPC round-trips
   overlap instead of chaining. */

import type { Commit, Stash } from "../../../../../shared/types.ts"
import type { RepoApi } from "@/lib/git"
import { collapsePairs, foldStashes } from "../layout/collapse.ts"
import { layoutChunk } from "../layout/lanes.ts"
import { createState, type LayoutState } from "../layout/state.ts"
import { idOf } from "../ids.ts"
import { createPageCache, type PageCache } from "./page-cache.ts"

/** concurrent pages per batch during a long-distance jump (jumpTo/nextMatch) — beyond this,
    concurrency stops helping (practical limit on the number of in-flight IPC/git processes) */
const JUMP_BATCH = 4

export interface LoaderOptions {
  api: RepoApi
  pageSize: number
  resident: number
  /** a new (or refilled) page was just placed — the controller scans it for column
      widths and triggers its own `refresh()`/`sync()` */
  onPageLoaded?(commits: Commit[]): void
  /** an `api.log` call failed — surfaced once per failure episode, never silently */
  onError?(err: unknown): void
}

export function createLoader(opts: LoaderOptions) {
  const { api, pageSize, resident } = opts
  const pageCache: PageCache = createPageCache(resident)
  let S: LayoutState = createState()
  let TOTAL = 0
  let exhausted = false
  let fetching: Promise<Commit[] | null> | null = null
  const refetching = new Map<number, Promise<boolean>>()
  let gen = 0 // invalidates in-flight fetches after a reset/destroy
  let stashOf = new Map<string, string>()
  let plumbing = new Set<string>()
  let errorReported = false

  function reportError(err: unknown) {
    if (errorReported) return
    errorReported = true
    opts.onError?.(err)
  }

  function applyPage(rowStart: number, commits: Commit[]): void {
    const end = rowStart + commits.length
    while (S.next < end) layoutChunk(S, (r) => commits[r - rowStart], end)
  }

  /** Single entry point: places a RAW page already received from `api.log`, either new
      (`isNew`, advances the cache) or refilling an evicted page (revalidated against the existing
      layout state — a repo that moved under the page won't mount anything wrong). Never
      decides eviction on its own: that depends on the viewport and selection, which only the
      controller knows — it calls `evict()` back afterward. */
  function ingest(pi: number, raw: Commit[], isNew: boolean): Commit[] | null {
    const commits = collapsePairs(foldStashes(raw, stashOf, plumbing))
    if (isNew) {
      const rowStart = S.next
      pageCache.appendPage(rowStart, commits)
      applyPage(rowStart, commits)
      if (raw.length < pageSize) exhausted = true
      /* the server total ignores collapse folds (two merges → one row): once
         history is exhausted, the actual row count is authoritative */
      if (exhausted) TOTAL = S.next
      errorReported = false // a page arriving closes the previous failure episode
      return commits
    }
    const rowStart = pageCache.pageRowStart(pi)
    const len = (pageCache.nextPageRowStart(pi) ?? S.next) - (rowStart ?? 0)
    if (rowStart === undefined || commits.length < len || idOf(S.ids, commits[0].h) !== S.hashOf[rowStart]) return null
    pageCache.refill(pi, commits)
    errorReported = false
    return commits
  }

  /** Never rejects: a `git log` that fails (timeout, gc lock) leaves the cache
      as-is and frees `fetching` so the next trigger can retry. */
  function fetchMore(): Promise<Commit[] | null> {
    if (exhausted) return Promise.resolve(null)
    if (!fetching) {
      const g = gen
      const pi = pageCache.pageCount
      fetching = api.log(pi * pageSize, pageSize).then(
        (raw) => {
          fetching = null
          if (g !== gen) return null // reset happened in the meantime: stale page
          const commits = ingest(pi, raw, true)
          if (commits) opts.onPageLoaded?.(commits)
          return commits
        },
        (err) => {
          fetching = null
          if (g === gen) reportError(err)
          return null
        }
      )
    }
    return fetching
  }

  /** `fetchMore` with failure detection: `false` if nothing arrived (page failed). */
  async function fetchProgress(): Promise<boolean> {
    const before = S.next
    await fetchMore()
    return exhausted || S.next > before
  }

  /** Reloads evicted pages covering [r0, r1]. Folding and collapsing are deterministic
      per raw page: the page comes back identical, we only refill the texts. */
  async function ensureRows(r0: number, r1: number): Promise<boolean> {
    let ok = true
    /* sequential: a `pin` over a spread-out segment must not launch dozens of git processes in parallel */
    for (let pi = pageCache.pageOfRow(r0), last = pageCache.pageOfRow(r1); pi <= last; pi++) {
      pageCache.touch(pi)
      if (pageCache.has(pi)) continue
      let p = refetching.get(pi)
      if (!p) {
        const g = gen
        p = api.log(pi * pageSize, pageSize).then(
          (raw) => {
            refetching.delete(pi)
            if (g !== gen) return false
            return !!ingest(pi, raw, false)
          },
          (err) => {
            refetching.delete(pi)
            if (g === gen) reportError(err)
            return false
          }
        )
        refetching.set(pi, p)
      }
      ok = (await p) && ok
    }
    return ok
  }

  /** Loads in concurrent batches until `done()` becomes true, history is exhausted, or
      a reset/destroy invalidates this call (`token`). Replaces the sequential
      page-by-page loop (one IPC round-trip at a time) with batches of `JUMP_BATCH` pages in
      flight — their application to the layout stays in request order, never the order of
      network resolution (lane allocation is a state machine, it doesn't tolerate out-of-order). */
  async function growUntil(done: () => boolean, token: number): Promise<void> {
    while (!done() && !exhausted && token === gen) {
      const from = pageCache.pageCount
      const pis = Array.from({ length: JUMP_BATCH }, (_, k) => from + k)
      const raws = await Promise.allSettled(pis.map((pi) => api.log(pi * pageSize, pageSize)))
      if (token !== gen) return
      let progressed = false
      for (let k = 0; k < raws.length; k++) {
        const r = raws[k]
        if (r.status === "rejected") {
          reportError(r.reason)
          break // a failure in the batch: we no longer know which page comes next, stop the batch
        }
        const commits = ingest(pis[k], r.value, true)
        if (!commits) break // invalid page (repo moved under our feet): the reset will handle it
        opts.onPageLoaded?.(commits)
        progressed = true
        if (r.value.length < pageSize) {
          exhausted = true
          break
        }
      }
      if (!progressed) return // no progress: don't loop indefinitely on a failure
    }
  }

  return {
    get state(): LayoutState {
      return S
    },
    get total(): number {
      return TOTAL
    },
    get exhausted(): boolean {
      return exhausted
    },
    get token(): number {
      return gen
    },
    commitAt: (row: number) => pageCache.commitAt(row),
    isResident: (r0: number, r1: number) => pageCache.isResident(r0, r1),
    touch: (pi: number) => pageCache.touch(pi),
    pageOfRow: (row: number) => pageCache.pageOfRow(row),
    evict: (viewRowRange: readonly [number, number] | null, extraRows: Iterable<number>) => pageCache.evict(viewRowRange, extraRows),

    fetchMore,
    fetchProgress,
    ensureRows,
    growUntil,

    /** Resets the layout state and cache for a (re)loaded repo. Returns the raw stashes
        (the controller reads their names there for column measurement) — doesn't touch any
        DOM, that stays the controller's business (`remount`/`scrollTop`). */
    async reset(): Promise<{ stashes: Stash[] }> {
      ++gen // invalidates in-flight fetches
      const [total, stashes] = await Promise.all([api.total(), api.stashes().catch((): Stash[] => [])])
      /* Re-init in one shot, AFTER the await, under a re-bumped gen: a scroll during
         the await can relaunch fetchMore — started against the old state, it must be discarded
         on arrival, not seed a page into the fresh state. The controller compares `token` before/after
         its own sequence of calls (remount, initial fetchMore) to detect a concurrent reset. */
      ++gen
      pageCache.reset()
      fetching = null
      refetching.clear()
      TOTAL = total
      stashOf = new Map(stashes.map((s) => [s.h, s.name]))
      plumbing = new Set(stashes.flatMap((s) => s.p.slice(1)))
      exhausted = TOTAL === 0
      S = createState()
      errorReported = false
      return { stashes }
    },

    /** invalidates everything in flight, without touching the DOM (controller's business) */
    destroy(): void {
      gen++
    },
  }
}

export type GraphLoader = ReturnType<typeof createLoader>
