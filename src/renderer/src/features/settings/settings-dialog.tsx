import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { host, SETTINGS, type Settings } from "@/lib/git"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/* App-wide settings (shared/settings.ts): fetch behavior, applied to every repository. Opened from
   the toolbar's fetch button-group (the cog). Each control writes through host.setSettings the
   moment it changes — the main process persists it and re-arms the open repos' autofetch timers
   live — so there's no Save button, only Close. Every value and choice comes from the SETTINGS
   registry, never hardcoded here.

   State lives in the shared `settings` query (queries.ts), not local: the toolbar reads the same
   cache for its fetch-command label, so toggling prune updates the label in the same frame. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => host.getSettings(),
    staleTime: Infinity,
  })

  /* optimistic: write the query cache at once (the modal and toolbar reflect it), then persist.
     A failed write is harmless — the cache reloads from the persisted truth next open. */
  const patch = useCallback(
    (p: Partial<Settings>) => {
      queryClient.setQueryData(queryKeys.settings(), (s: Settings | undefined) => (s ? { ...s, ...p } : s))
      void host.setSettings(p)
    },
    [queryClient]
  )

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{messages.settings.title}</DialogTitle>
          <DialogDescription>{messages.settings.intro}</DialogDescription>
        </DialogHeader>

        {settings && (
          <div className="grid gap-4">
            {/* Auto-fetch on/off */}
            <label className="flex cursor-pointer items-start gap-2.5 text-xs">
              <Checkbox
                checked={settings.autoFetch}
                onCheckedChange={(v) => patch({ autoFetch: v === true })}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-medium">{messages.settings.autoFetch}</span>
                <span className="block text-[0.625rem] text-muted-foreground">{messages.settings.autoFetchHint}</span>
              </span>
            </label>

            {/* Interval — only meaningful while auto-fetch is on, so it dims and locks with it */}
            <div className={cn("flex items-center justify-between gap-3", !settings.autoFetch && "opacity-50")}>
              <span className="text-xs font-medium">{messages.settings.interval}</span>
              <div className="flex items-center gap-1.5">
                <ToggleGroup
                  spacing={0}
                  variant="outline"
                  size="sm"
                  disabled={!settings.autoFetch}
                  value={[String(settings.autoFetchIntervalMin)]}
                  onValueChange={(v) => {
                    /* single-select: an empty array is a deselect click on the active item — keep
                       the current value (a controlled group, so it never actually clears) */
                    const n = Number(v[0])
                    if (Number.isFinite(n)) patch({ autoFetchIntervalMin: n })
                  }}
                >
                  {SETTINGS.autoFetchIntervalMin.options.map((n) => (
                    <ToggleGroupItem key={n} value={String(n)} className="tabular-nums">
                      {n}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <span className="text-[0.625rem] text-muted-foreground">{messages.settings.minutesUnit}</span>
              </div>
            </div>

            {/* Prune on fetch */}
            <label className="flex cursor-pointer items-start gap-2.5 text-xs">
              <Checkbox
                checked={settings.prune}
                onCheckedChange={(v) => patch({ prune: v === true })}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-medium">{messages.settings.prune}</span>
                <span className="block text-[0.625rem] text-muted-foreground">{messages.settings.pruneHint}</span>
              </span>
            </label>
          </div>
        )}

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}
