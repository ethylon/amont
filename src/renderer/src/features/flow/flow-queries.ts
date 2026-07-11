/* Requêtes de la feature flow (AUDIT.md §5/§7) : préfixes git-flow du dépôt et contexte de la
   branche de flow courante — colocalisées avec flow-context.tsx plutôt que dans un
   lib/queries.ts fourre-tout. Consommées aussi par features/repo (bannière/carte) et
   features/refs (menu « finish ») : une requête partagée entre features s'importe depuis la
   feature qui la possède, comme n'importe quel autre export. */

import { keepPreviousData, useQuery } from "@tanstack/react-query"

import type { FlowPrefixes, RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

export function useFlowQuery(api: RepoApi, id: number) {
  return useQuery({ queryKey: queryKeys.flow(id), queryFn: () => api.flow(), placeholderData: keepPreviousData })
}

/** `null` hors flow (tronc, HEAD détachée) : pas de requête, `enabled` la coupe — `isLoading`
    reste `false` pour une requête désactivée, donc elle ne bloque jamais le boot (cf. RepoView). */
export function useFlowInfoQuery(api: RepoApi, id: number, branch: string | null, kind: keyof FlowPrefixes | null) {
  return useQuery({
    queryKey: queryKeys.flowInfo(id, branch, kind),
    queryFn: () => api.flowInfo(branch!, kind!),
    enabled: !!branch && !!kind,
    placeholderData: keepPreviousData,
  })
}
