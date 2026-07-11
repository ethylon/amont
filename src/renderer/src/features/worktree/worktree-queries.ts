/* Requête de la feature worktree (AUDIT.md §5/§7) : l'arbre de travail (staged/unstaged/
   untracked/conflicts) — colocalisée avec worktree-panel.tsx plutôt que dans un lib/queries.ts
   fourre-tout. `placeholderData: keepPreviousData` tient le rendu précédent affiché pendant
   qu'une nouvelle réponse arrive. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useWorktreeQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.worktree(id), queryFn: () => api.worktree(), placeholderData: keepPreviousData })
}
