/* Stash feature query (AUDIT.md §5/§7): list of `git stash list` entries —
   colocated with stash-section.tsx, the reference "copy-me" folder for a vertical
   feature (component + query + actions in the same place). `placeholderData:
   keepPreviousData` keeps the previous render displayed while a new response is in flight. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useStashesQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.stashes(id), queryFn: () => api.stashes(), placeholderData: keepPreviousData })
}
