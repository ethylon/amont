import type { MaintKind } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"

/** A maintenance run's live state, shared by the footer feed and the maintenance modal. */
export type MaintState = {
  op: MaintKind
  /** determinate percentage (0–100), or `null` for a phase git reports without one */
  percent: number | null
  running: boolean
  /** set once the run settles; `text` is the localized notice or the error message */
  result: { ok: boolean; text: string } | null
}

/** Live message of a run, per op — consumed here and by the footer feed (status-bar). */
export const MAINT_RUNNING: Record<MaintKind, () => string> = {
  fsck: () => messages.maintenance.verifying,
  gc: () => messages.maintenance.compacting,
}

/* Long-running Verify/Compact feedback inside the maintenance modal: a determinate bar with
   the percentage when git emits `NN%`, shadcn's `shimmer` sweeping the text otherwise, then a
   brief result. The footer renders the same MaintState through the feed (status-bar), not this
   component. */
export function MaintenanceStatus({ maint, className }: { maint: MaintState | null; className?: string }) {
  if (maint?.running) {
    return (
      <div className={cn("flex min-w-0 items-center gap-2", className)} aria-live="polite">
        {maint.percent !== null && (
          <div className="h-1 w-20 shrink-0 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200"
              style={{ width: `${maint.percent}%` }}
            />
          </div>
        )}
        <span className={cn("truncate", maint.percent === null && "shimmer")}>
          {MAINT_RUNNING[maint.op]()}
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

  return null
}
