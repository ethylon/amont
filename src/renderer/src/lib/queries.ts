/* Query layer (AUDIT.md §5): one TanStack Query key per repo and per domain, replacing
   the manual state mirrors (`useState` + effect + `stale` flag) that used to populate repo-view,
   refs-sidebar, detail-panel, diff-view and commit-search. `placeholderData: keepPreviousData`
   keeps the previous render displayed while a new response comes in: no more flash on a
   key change, something `useAsync` couldn't do (it cleared its data every time).

   This module only keeps what's genuinely shared between features (AUDIT.md §7, phase 5):
   the cache keys (single source of truth, `invalidateRepo` depends on it), grouped invalidation,
   and `withAbort`. The `use...Query` hooks themselves are colocated in the feature that
   consumes them (one `xxx-queries.ts` file per `features` folder) — each feature owns its
   own queries just like its actions.

   Cancellation: `body`/`diff`/`search` accept an optional `requestId` on the bridge side
   (`repo:cancel` channel, added in Phase 2 — AUDIT.md §2 B4). `withAbort` builds an id, passes
   it to the call, and resolves it on the main side as soon as TanStack Query aborts the fetch
   (key change, unmount) via the `AbortSignal` its `queryFn` receives. */

import type { QueryClient } from "@tanstack/react-query"

import type { DiffCtx } from "@/features/diff/diff-view"
import type { FlowPrefixes, RepoApi } from "@/lib/git"

export const queryKeys = {
  /** app-wide settings (shared/settings.ts) — not per-repo, so no id; shared by the toolbar's
      Fetch/Pull options cards and every live command label so a change updates all of them at
      once (cf. lib/use-settings.ts) */
  settings: () => ["settings"] as const,
  status: (id: number) => ["status", id] as const,
  refs: (id: number) => ["refs", id] as const,
  worktree: (id: number) => ["worktree", id] as const,
  mergeState: (id: number) => ["mergeState", id] as const,
  conflict: (id: number, path: string) => ["conflict", id, path] as const,
  conflictAll: (id: number) => ["conflict", id] as const,
  stashes: (id: number) => ["stashes", id] as const,
  worktrees: (id: number) => ["worktrees", id] as const,
  flow: (id: number) => ["flow", id] as const,
  flowInfo: (id: number, branch: string | null, kind: keyof FlowPrefixes | null) =>
    ["flowInfo", id, branch, kind] as const,
  flowInfoAll: (id: number) => ["flowInfo", id] as const,
  countObjects: (id: number) => ["countObjects", id] as const,
  files: (id: number, hash: string, parent: string | null) => ["files", id, hash, parent] as const,
  /** file-history walk, anchored on a fixed commit: content-addressed like `files`/`diff` */
  fileLog: (id: number, from: string, path: string) => ["fileLog", id, from, path] as const,
  body: (id: number, hash: string) => ["body", id, hash] as const,
  diff: (id: number, ctx: DiffCtx, path: string, old: string | null) => ["diff", id, ctx, path, old] as const,
  diffAll: (id: number) => ["diff", id] as const,
  imageDiff: (id: number, ctx: DiffCtx, path: string, old: string | null) => ["imageDiff", id, ctx, path, old] as const,
  search: (id: number, term: string, content: boolean) => ["search", id, term, content] as const,
  searchAll: (id: number) => ["search", id] as const,
}

/** A native text selection anchored in nodes about to be replaced by a refetch cycle
    (detail-panel body, diff text, console output) is a Blink re-entrancy crash ingredient
    (Sentry AMONT-2, cf. commit-graph.tsx): the post-layout selection commit relayouts a
    document whose lifecycle forbids tree mutations → renderer CHECK crash. The content is
    changing anyway, so the selection is stale — drop it before the DOM moves under it. */
function dropNativeSelection(): void {
  const sel = typeof window === "undefined" ? null : window.getSelection()
  if (sel && !sel.isCollapsed) sel.removeAllRanges()
}

/** All keys of a repo that closely track its status: invalidated together on
    `onChanged` and at the end of any mutation (checkout, stash, branch, commit, network op). */
export function invalidateRepo(client: QueryClient, id: number): void {
  dropNativeSelection()
  void client.invalidateQueries({ queryKey: queryKeys.status(id) })
  void client.invalidateQueries({ queryKey: queryKeys.mergeState(id) })
  void client.invalidateQueries({ queryKey: queryKeys.refs(id) })
  void client.invalidateQueries({ queryKey: queryKeys.stashes(id) })
  void client.invalidateQueries({ queryKey: queryKeys.worktrees(id) })
  void client.invalidateQueries({ queryKey: queryKeys.flow(id) })
  void client.invalidateQueries({ queryKey: queryKeys.flowInfoAll(id) })
  /* search results are NOT content-addressed: commits get created, amended and rebased by
     this very app, so cached hits (staleTime: Infinity, cf. search-queries.ts) are marked
     stale here — an active search refetches, idle ones refetch on next use */
  void client.invalidateQueries({ queryKey: queryKeys.searchAll(id) })
}

/** Working-tree diffs only (`ctx` carries `wt`): refreshed when the tree may have moved under
    an open diff (external change, commit). Commit↔commit diffs are content-addressed — refetching
    them would be pure waste, so they are filtered out rather than sweeping `diffAll`. */
export function invalidateWtDiffs(client: QueryClient, id: number): void {
  dropNativeSelection()
  void client.invalidateQueries({
    predicate: (q) => {
      const [domain, qid, ctx] = q.queryKey
      return (
        (domain === "diff" || domain === "imageDiff") &&
        qid === id &&
        typeof ctx === "object" &&
        ctx !== null &&
        "wt" in ctx
      )
    },
  })
}

let seq = 0

/** Generates a `requestId`, provides it to `run`, and cancels it on the main side if `signal`
    fires before `run` has finished — TanStack Query sets this signal on every superseded fetch
    (key change, unmount). The return respects the abandonment: a response that arrives late
    must not resolve the promise that Query has already abandoned. */
export function withAbort<T>(api: RepoApi, signal: AbortSignal, run: (requestId: string) => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  const requestId = `q${++seq}`
  const onAbort = () => void api.cancel(requestId)
  signal.addEventListener("abort", onAbort, { once: true })
  return run(requestId).finally(() => signal.removeEventListener("abort", onAbort))
}
