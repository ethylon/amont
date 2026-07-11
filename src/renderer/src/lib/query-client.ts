/* Instance unique de QueryClient (AUDIT.md §5, chantier « état renderer »). L'état serveur —
   status, refs, worktree, flow, fichiers, corps de message, diff — passe entièrement par
   TanStack Query : les clés sont scopées par dépôt (cf. `queryKeys` dans lib/queries.ts), les
   mutations et les événements git (`onChanged`/`onOp`) invalident ces clés au lieu de recopier
   l'état à la main. `placeholderData: keepPreviousData` (posé par requête, pas ici) tient le
   rendu précédent affiché pendant qu'une nouvelle réponse arrive — plus de flash `useAsync`. */

import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /* git ne notifie rien par lui-même : c'est `onChanged`/`onOp` qui invalident, pas un
         polling ni un refetch sur focus fenêtre — un focus déclenche déjà `refreshWorktree`
         via son propre effet (cf. repo-view.tsx). */
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
})
