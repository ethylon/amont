/* Worktree feature query (AUDIT.md §5/§7): the working tree (staged/unstaged/
   untracked/conflicts) — colocated with worktree-panel.tsx rather than in a catch-all
   lib/queries.ts. `placeholderData: keepPreviousData` keeps the previous render displayed while
   a new response arrives. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useWorktreeQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.worktree(id), queryFn: () => api.worktree(), placeholderData: keepPreviousData })
}
