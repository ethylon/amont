/* Search feature query (AUDIT.md §5/§7): hashes matching a term, message or
   diff content — colocated with commit-search.tsx rather than in a catch-all lib/queries.ts. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys, withAbort } from "@/lib/queries"

/** Below this threshold, `git log -S` would sweep the entire history for nothing — same guard
    as the old CommitSearch. `enabled` cuts the query off; note that with `placeholderData` the
    disabled query still exposes its previous data, so the consumer gates on the term length to
    clear the UI (cf. commit-search.tsx). */
export const SEARCH_MIN = 2

export function useSearchQuery(api: RepoApi, id: number, term: string, content: boolean) {
  return useQuery({
    queryKey: queryKeys.search(id, term, content),
    queryFn: ({ signal }) => withAbort(api, signal, (requestId) => api.search(term, content, requestId)),
    enabled: term.length >= SEARCH_MIN,
    placeholderData: keepPreviousData,
    /* history is effectively append-only within a session: keep a term's hits cached
       instead of respawning `git log -S/--grep` on every remount of the search bar
       (perf audit, finding 5) */
    staleTime: Infinity,
  })
}
