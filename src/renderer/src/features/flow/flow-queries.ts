/* Flow feature queries (AUDIT.md §5/§7): repo's git-flow prefixes and the current flow
   branch's context — colocated with flow-context.tsx rather than in a
   catch-all lib/queries.ts. Also consumed by features/repo (banner/card) and
   features/refs ("finish" menu): a query shared between features is imported from the
   feature that owns it, like any other export. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { FlowPrefixes, RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useFlowQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.flow(id), queryFn: () => api.flow(), placeholderData: keepPreviousData })
}

/** `null` outside of flow (trunk, detached HEAD): no query, `enabled` disables it — `isLoading`
    stays `false` for a disabled query, so it never blocks boot (see RepoView). */
export function useFlowInfoQuery(api: RepoApi, id: number, branch: string | null, kind: keyof FlowPrefixes | null) {
  return useQuery({
    queryKey: queryKeys.flowInfo(id, branch, kind),
    queryFn: () => api.flowInfo(branch!, kind!),
    enabled: !!branch && !!kind,
    placeholderData: keepPreviousData,
  })
}
