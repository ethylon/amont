/* Couche requêtes (AUDIT.md §5) : une clé TanStack Query par dépôt et par domaine, à la place
   des miroirs d'état manuels (`useState` + effet + flag `stale`) qui peuplaient repo-view,
   refs-sidebar, detail-panel, diff-view et commit-search. `placeholderData: keepPreviousData`
   tient le rendu précédent affiché pendant qu'une nouvelle réponse arrive : plus de flash au
   changement de clé, ce que `useAsync` ne savait pas faire (il vidait ses données à chaque fois).

   Ce module ne garde que ce qui est réellement partagé entre features (AUDIT.md §7, phase 5) :
   les clés de cache (single source of truth, `invalidateRepo` en dépend), l'invalidation groupée,
   et `withAbort`. Les hooks `use...Query` eux-mêmes sont colocalisés dans la feature qui les
   consomme (un fichier `xxx-queries.ts` par dossier `features`) — chaque feature possède ses
   requêtes comme ses actions.

   Annulation : `body`/`diff`/`search` acceptent un `requestId` optionnel côté bridge
   (canal `repo:cancel`, posé en Phase 2 — AUDIT.md §2 B4). `withAbort` fabrique un id, le passe
   à l'appel, et le résout côté main dès que TanStack Query annule le fetch (changement de clé,
   démontage) via l'`AbortSignal` que sa `queryFn` reçoit. */

import type { QueryClient } from "@tanstack/react-query"

import type { DiffCtx } from "@/features/diff/diff-view"
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
export function withAbort<T>(api: RepoApi, signal: AbortSignal, run: (requestId: string) => Promise<T>): Promise<T> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  const requestId = `q${++seq}`
  const onAbort = () => void api.cancel(requestId)
  signal.addEventListener("abort", onAbort, { once: true })
  return run(requestId).finally(() => signal.removeEventListener("abort", onAbort))
}
