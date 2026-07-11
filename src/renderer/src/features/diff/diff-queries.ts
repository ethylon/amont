/* Diff feature query (AUDIT.md §5/§7): diff text, commit↔commit or working tree
   source — colocated with diff-view.tsx rather than in a catch-all lib/queries.ts. */

import { useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys, withAbort } from "@/lib/queries"
import type { DiffCtx } from "@/features/diff/diff-view"

const diffText = (api: RepoApi, signal: AbortSignal, ctx: DiffCtx, path: string, oldPath: string | null) =>
  "wt" in ctx
    ? api.wtdiff(path, ctx.wt) // no cancellation channel on the main side for the working tree diff
    : withAbort(api, signal, (requestId) => api.diff(ctx.hash, ctx.parent, path, oldPath, requestId))

export function useDiffQuery(api: RepoApi, id: number, ctx: DiffCtx, path: string, oldPath: string | null) {
  return useQuery({
    queryKey: queryKeys.diff(id, ctx, path, oldPath),
    queryFn: ({ signal }) => diffText(api, signal, ctx, path, oldPath),
  })
}
