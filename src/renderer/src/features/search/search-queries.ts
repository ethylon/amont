/* Requête de la feature search (AUDIT.md §5/§7) : hashes correspondant à un terme, message ou
   contenu de diff — colocalisée avec commit-search.tsx plutôt que dans un lib/queries.ts
   fourre-tout. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys, withAbort } from "@/lib/queries"

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
