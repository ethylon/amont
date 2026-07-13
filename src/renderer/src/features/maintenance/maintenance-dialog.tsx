import { useQuery } from "@tanstack/react-query"

import type { MaintKind, RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MaintenanceStatus, type MaintState } from "@/features/maintenance/maintenance-status"

type Props = {
  api: RepoApi
  repoId: number
  maint: MaintState | null
  onRunMaint: (op: MaintKind) => void
  onClose: () => void
}

/* The maintenance hub opened by "Database statistics…": a compact report of the object DB
   (`git count-objects -vH`), plus Verify/Compact as buttons — the same two operations the menu
   also exposes directly (both entry points are wanted). The numbers refresh after a compact
   (`gc` invalidates the count query, see use-repo-menu-tools). */
export function MaintenanceDialog({ api, repoId, maint, onRunMaint, onClose }: Props) {
  const { data, isLoading } = useQuery({ queryKey: queryKeys.countObjects(repoId), queryFn: () => api.countObjects() })
  const running = !!maint?.running

  const rows: [string, string][] = data
    ? [
        [messages.maintenance.looseObjects, String(data.count)],
        [messages.maintenance.looseSize, data.size],
        [messages.maintenance.packedObjects, String(data.inPack)],
        [messages.maintenance.packs, String(data.packs)],
        [messages.maintenance.packedSize, data.sizePack],
        [messages.maintenance.prunable, String(data.prunePackable)],
        [messages.maintenance.garbageFiles, String(data.garbage)],
        [messages.maintenance.garbageSize, data.sizeGarbage],
      ]
    : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{messages.maintenance.title}</DialogTitle>
          <DialogDescription>{messages.maintenance.intro}</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-2 gap-x-4 rounded-md border p-3 text-xs">
          {isLoading && !data ? (
            <p className="col-span-2 text-muted-foreground">{messages.maintenance.loading}</p>
          ) : (
            rows.map(([label, value]) => (
              <div
                key={label}
                className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1 [&:nth-last-child(-n+2)]:border-0"
              >
                <dt className="truncate text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))
          )}
        </dl>

        {maint && <MaintenanceStatus maint={maint} className="px-0.5 text-xs text-muted-foreground" />}

        <DialogFooter className="sm:justify-start">
          <Button variant="outline" onClick={() => onRunMaint("fsck")} disabled={running}>
            {messages.maintenance.verify}
          </Button>
          <Button variant="outline" onClick={() => onRunMaint("gc")} disabled={running}>
            {messages.maintenance.compact}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
