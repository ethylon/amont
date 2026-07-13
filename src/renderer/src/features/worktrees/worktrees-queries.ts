/* Linked-worktrees feature query (`git worktree list`) — colocated with
   worktrees-section.tsx, same vertical-feature shape as features/stash. Not to be confused
   with features/worktree (the working-tree file status panel). */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useWorktreesQuery(api: RepoApi, id: number) {
  return useQuery({
    queryKey: queryKeys.worktrees(id),
    queryFn: () => api.worktrees(),
    placeholderData: keepPreviousData,
  })
}
