import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { host, SETTINGS_DEFAULTS, type Settings } from "@/lib/git"
import { queryKeys } from "@/lib/queries"

/* The app-wide settings (shared/settings.ts), renderer side: one shared query + the optimistic
   patch. Every consumer — the toolbar's Fetch/Pull options cards, its live command labels, the
   context menu's pull command — reads the same cache entry, so a change in one card updates all
   of them at once. `patch` writes the cache first (the UI reflects it immediately), then persists
   through host.setSettings, which re-arms the open repos' autofetch timers live; a failed write
   is harmless — the cache reloads from the persisted truth next boot. Registry defaults stand in
   until the first load resolves. */
export function useSettings(): { settings: Settings; patch: (p: Partial<Settings>) => void } {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: queryKeys.settings(), queryFn: () => host.getSettings(), staleTime: Infinity })

  const patch = useCallback(
    (p: Partial<Settings>) => {
      queryClient.setQueryData(queryKeys.settings(), (s: Settings | undefined) => (s ? { ...s, ...p } : s))
      void host.setSettings(p)
    },
    [queryClient]
  )

  return { settings: data ?? SETTINGS_DEFAULTS, patch }
}
