/* Couche requêtes (AUDIT.md §5) : une clé TanStack Query par dépôt et par domaine, à la place
   des miroirs d'état manuels (`useState` + effet + flag `stale`) qui peuplaient repo-view,
   refs-sidebar, detail-panel, diff-view et commit-search. `placeholderData: keepPreviousData`
   tient le rendu précédent affiché pendant qu'une nouvelle réponse arrive : plus de flash au
   changement de clé, ce que `useAsync` ne savait pas faire (il vidait ses données à chaque fois).

   Annulation : `files`/`body`/`diff`/`search` acceptent un `requestId` optionnel côté bridge
   (canal `repo:cancel`, posé en Phase 2 — AUDIT.md §2 B4). `withAbort` fabrique un id, le passe
   à l'appel, et le résout côté main dès que TanStack Query annule le fetch (changement de clé,
   démontage) via l'`AbortSignal` que sa `queryFn` reçoit. */

import { keepPreviousData, useQuery, type QueryClient } from "@tanstack/react-query"

import type { DiffCtx } from "@/components/diff-view"
import type { FlowPrefixes, RepoApi } from "@/lib/git"

export const queryKeys = {
  status: (id: number) => ["status", id] as const,
  refs: (id: number) => ["refs", id] as const,
  worktree: (id: number) => ["worktree", id] as const,
  stashes: (id: number) => ["stashes", id] as const,
  flow: (id: number) => ["flow", id] as const,
  flowInfo: (id: number, branch: string | null, kind: keyof FlowPrefixes | null) =>
    ["flowInfo", id, branch, kind] as const,
  flowInfoAll: (id: number) => ["flowInfo", id] as const,
  files: (id: number, hash: string, parent: string | null) => ["files", id, hash, parent] as const,
  body: (id: number, hash: string) => ["body", id, hash] as const,
  diff: (id: number, ctx: DiffCtx, path: string, old: string | null) => ["diff", id, ctx, path, old] as const,
  search: (id: number, term: string, content: boolean) => ["search", id, term, content] as const,
}

/** Toutes les clés d'un dépôt qui suivent son statut de près : invalidées ensemble sur
    `onChanged` et à l'issue de toute mutation (checkout, stash, branche, commit, op réseau). */
export function invalidateRepo(client: QueryClient, id: number): void {
  client.invalidateQueries({ queryKey: queryKeys.status(id) })
  client.invalidateQueries({ queryKey: queryKeys.refs(id) })
  client.invalidateQueries({ queryKey: queryKeys.flow(id) })
  client.invalidateQueries({ queryKey: queryKeys.flowInfoAll(id) })
}

let seq = 0

/** Génère un `requestId`, le fournit à `run`, et l'annule côté main si `signal` s'arme avant
    que `run` n'ait fini — TanStack Query pose ce signal à chaque fetch superflu (nouvelle
    clé, démontage). Le retour respecte l'abandon : une réponse qui arrive après coup ne doit
    pas résoudre la promesse que Query a déjà abandonnée. */
function withAbort<T>(api: RepoApi, signal: AbortSignal, run: (requestId: string) => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  const requestId = `q${++seq}`
  const onAbort = () => void api.cancel(requestId)
  signal.addEventListener("abort", onAbort, { once: true })
  return run(requestId).finally(() => signal.removeEventListener("abort", onAbort))
}

export function useStatusQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.status(id), queryFn: () => api.status(), placeholderData: keepPreviousData })
}

export function useRefsQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.refs(id), queryFn: () => api.refs(), placeholderData: keepPreviousData })
}

export function useWorktreeQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.worktree(id), queryFn: () => api.worktree(), placeholderData: keepPreviousData })
}

export function useStashesQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.stashes(id), queryFn: () => api.stashes(), placeholderData: keepPreviousData })
}

export function useFlowQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.flow(id), queryFn: () => api.flow(), placeholderData: keepPreviousData })
}

/** `null` hors flow (tronc, HEAD détachée) : pas de requête, `enabled` la coupe — `isLoading`
    reste `false` pour une requête désactivée, donc elle ne bloque jamais le boot (cf. RepoView). */
export function useFlowInfoQuery(api: RepoApi, id: number, branch: string | null, kind: keyof FlowPrefixes | null) {
  return useQuery({
    queryKey: queryKeys.flowInfo(id, branch, kind),
    queryFn: () => api.flowInfo(branch!, kind!),
    enabled: !!branch && !!kind,
    placeholderData: keepPreviousData,
  })
}

export function useFilesQuery(api: RepoApi, id: number, hash: string, parent: string | null) {
  return useQuery({
    queryKey: queryKeys.files(id, hash, parent),
    queryFn: ({ signal }) => withAbort(api, signal, (requestId) => api.files(hash, parent, requestId)),
    placeholderData: keepPreviousData,
  })
}

export function useBodyQuery(api: RepoApi, id: number, hash: string) {
  return useQuery({
    queryKey: queryKeys.body(id, hash),
    queryFn: ({ signal }) => withAbort(api, signal, (requestId) => api.body(hash, requestId)),
    placeholderData: keepPreviousData,
  })
}

const diffText = (api: RepoApi, signal: AbortSignal, ctx: DiffCtx, path: string, oldPath: string | null) =>
  "wt" in ctx
    ? api.wtdiff(path, ctx.wt) // pas de canal d'annulation côté main pour le diff d'arbre de travail
    : withAbort(api, signal, (requestId) => api.diff(ctx.hash, ctx.parent, path, oldPath, requestId))

export function useDiffQuery(api: RepoApi, id: number, ctx: DiffCtx, path: string, oldPath: string | null) {
  return useQuery({
    queryKey: queryKeys.diff(id, ctx, path, oldPath),
    queryFn: ({ signal }) => diffText(api, signal, ctx, path, oldPath),
  })
}

/** Sous ce seuil, `git log -S` balaierait l'historique entier pour rien — même garde que
    l'ancien CommitSearch. `enabled` la coupe : `data` retombe à `undefined` pour la nouvelle
    clé, ce qui vide les résultats sans flag `stale` à recopier à la main. */
export const SEARCH_MIN = 2

export function useSearchQuery(api: RepoApi, id: number, term: string, content: boolean) {
  return useQuery({
    queryKey: queryKeys.search(id, term, content),
    queryFn: ({ signal }) => withAbort(api, signal, (requestId) => api.search(term, content, requestId)),
    enabled: term.length >= SEARCH_MIN,
    placeholderData: keepPreviousData,
  })
}
