/* Repo feature queries (AUDIT.md §5/§7): repo status and a commit message body — colocated
   with repo-view.tsx/repo-store.tsx rather than in a catch-all lib/queries.ts.
   `placeholderData: keepPreviousData` keeps the previous render displayed while
   a new response arrives. */

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
    /* content-addressed: the body of a given hash never changes — no refetch on remount
       (an amend/rebase produces a new hash, i.e. a new key) */
    staleTime: Infinity,
  })
}
