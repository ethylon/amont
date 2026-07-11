/* Refs feature query (AUDIT.md §5/§7): branches, remotes and tags — colocated with
   refs-sidebar.tsx rather than in a catch-all lib/queries.ts. `placeholderData:
   keepPreviousData` keeps the previous render displayed while a new response arrives. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useRefsQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.refs(id), queryFn: () => api.refs(), placeholderData: keepPreviousData })
}
