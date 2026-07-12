/* Conflict feature queries: the merge-in-progress labels (A/B) and the per-file conflict
   content. `mergeState` tracks the repo closely — it's part of `invalidateRepo` (any mutation
   or external change can start/end a merge). The `conflict` key is NOT invalidated globally:
   the view seeds an editable buffer from it, and a background refetch clobbering in-progress
   edits would be worse than a stale base — resolveConflict invalidates it explicitly. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useMergeStateQuery(api: RepoApi, id: number) {
  return useQuery({
    queryKey: queryKeys.mergeState(id),
    queryFn: () => api.mergeState(),
    placeholderData: keepPreviousData,
  })
}

export function useConflictQuery(api: RepoApi, id: number, path: string) {
  return useQuery({
    queryKey: queryKeys.conflict(id, path),
    queryFn: () => api.conflict(path),
  })
}
