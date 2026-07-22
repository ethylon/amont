/* File-history feature query (same colocation policy as diff-queries.ts): the commits that
   touched one file, walked from a fixed commit (`repo:fileLog`). */

import { useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys, withAbort } from "@/lib/queries"

export function useFileLogQuery(api: RepoApi, id: number, from: string, path: string) {
  /* Content-addressed like a commit↔commit diff: the walk is anchored on `from` (a fixed
     hash), so what git returns for the key can never change — no refetch for the session,
     kept around a while for back-and-forth between files. */
  return useQuery({
    queryKey: queryKeys.fileLog(id, from, path),
    queryFn: ({ signal }) => withAbort(api, signal, (requestId) => api.fileLog(from, path, requestId)),
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  })
}
