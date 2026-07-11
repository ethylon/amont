/* Requête de la feature diff (AUDIT.md §5/§7) : texte d'un diff, commit↔commit ou source de
   l'arbre de travail — colocalisée avec diff-view.tsx plutôt que dans un lib/queries.ts
   fourre-tout. */

import { useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys, withAbort } from "@/lib/queries"
import type { DiffCtx } from "@/features/diff/diff-view"

const diffText = (api: RepoApi, signal: AbortSignal, ctx: DiffCtx, path: string, oldPath: string | null) =>
  "wt" in ctx
    ? api.wtdiff(path, ctx.wt) // pas de canal d'annulation côté main pour le diff d'arbre de travail
    : withAbort(api, signal, (requestId) => api.diff(ctx.hash, ctx.parent, path, oldPath, requestId))

export function useDiffQuery(api: RepoApi, id: number, ctx: DiffCtx, path: string, oldPath: string | null) {
  return useQuery({
    queryKey: queryKeys.diff(id, ctx, path, oldPath),
    queryFn: ({ signal }) => diffText(api, signal, ctx, path, oldPath),
  })
}
