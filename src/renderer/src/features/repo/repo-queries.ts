/* Requêtes de la feature repo (AUDIT.md §5/§7) : statut du dépôt et corps d'un message de
   commit — colocalisées avec repo-view.tsx/repo-store.tsx plutôt que dans un lib/queries.ts
   fourre-tout. `placeholderData: keepPreviousData` tient le rendu précédent affiché pendant
   qu'une nouvelle réponse arrive. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys, withAbort } from "@/lib/queries"

export function useStatusQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.status(id), queryFn: () => api.status(), placeholderData: keepPreviousData })
}

export function useBodyQuery(api: RepoApi, id: number, hash: string) {
  return useQuery({
    queryKey: queryKeys.body(id, hash),
    queryFn: ({ signal }) => withAbort(api, signal, (requestId) => api.body(hash, requestId)),
    placeholderData: keepPreviousData,
  })
}
