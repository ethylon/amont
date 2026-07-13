import { HugeiconsIcon } from "@hugeicons/react"
import { PackageIcon } from "@hugeicons/core-free-icons"

import type { MaintKind } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import type { RepoHealth } from "@/features/maintenance/health"

/** A maintenance run's live state, shared by the footer strip and the maintenance modal. */
export type MaintState = {
  op: MaintKind
  /** determinate percentage (0–100), or `null` for a phase git reports without one */
  percent: number | null
  running: boolean
  /** set once the run settles; `text` is the localized notice or the error message */
  result: { ok: boolean; text: string } | null
}

const RUNNING: Record<MaintKind, () => string> = {
  fsck: () => messages.maintenance.verifying,
  gc: () => messages.maintenance.compacting,
}

type Props = {
  maint: MaintState | null
  /** repo healthcheck (footer only): when it recommends compaction and no run is active, a hint
      with a Compact button appears. Omitted inside the maintenance modal. */
  health?: RepoHealth | null
  onCompact?: () => void
  className?: string
}

/* Long-running Verify/Compact feedback: a determinate bar with the percentage when git emits
   `NN%`, an indeterminate spinner otherwise, then a brief result. When idle, a repo healthcheck
   may instead suggest compacting. Rendered in the footer (background visibility) and — for the
   run feedback only — inside the maintenance modal. */
export function MaintenanceStatus({ maint, health, onCompact, className }: Props) {
  if (maint?.running) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)} aria-live="polite">
        {maint.percent !== null ? (
          <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${maint.percent}%` }}
            />
          </div>
        ) : (
          <Spinner className="size-3 shrink-0" />
        )}
        <span className="truncate">
          {RUNNING[maint.op]()}
          {maint.percent !== null ? ` ${maint.percent}%` : ""}
        </span>
      </div>
    )
  }

  if (maint?.result)
    return (
      <span
        className={cn("truncate", maint.result.ok ? "text-success" : "text-destructive", className)}
        aria-live="polite"
      >
        {maint.result.text}
      </span>
    )

  if (health?.needsCompaction && onCompact)
    return (
      <Badge color="warning" shape="squared" className={cn("min-w-0 shrink gap-2 ps-2 pe-1", className)}>
        <HugeiconsIcon icon={PackageIcon} strokeWidth={2} className="size-2.5 shrink-0" />
        <span className="truncate">{messages.maintenance.compactRecommended}</span>
        <Button variant="ghost" size="xs" onClick={onCompact} className="text-(--badge-fg)">
          {messages.maintenance.compact}
        </Button>
      </Badge>
    )

  return null
}
