/* Requête de la feature refs (AUDIT.md §5/§7) : branches, distantes et tags — colocalisée avec
   refs-sidebar.tsx plutôt que dans un lib/queries.ts fourre-tout. `placeholderData:
   keepPreviousData` tient le rendu précédent affiché pendant qu'une nouvelle réponse arrive. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useRefsQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.refs(id), queryFn: () => api.refs(), placeholderData: keepPreviousData })
}
