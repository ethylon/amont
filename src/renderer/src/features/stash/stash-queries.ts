/* Requête de la feature stash (AUDIT.md §5/§7) : liste des entrées `git stash list` —
   colocalisée avec stash-section.tsx, le dossier « copie-moi » de référence pour une feature
   verticale (composant + requête + actions au même endroit). `placeholderData:
   keepPreviousData` tient le rendu précédent affiché pendant qu'une nouvelle réponse arrive. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useStashesQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.stashes(id), queryFn: () => api.stashes(), placeholderData: keepPreviousData })
}
