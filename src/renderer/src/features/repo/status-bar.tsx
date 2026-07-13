import { HugeiconsIcon } from "@hugeicons/react"
import { GitBranchIcon } from "@hugeicons/core-free-icons"

import type { Stats } from "@/features/graph/controller"
import type { BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { FLOW_META } from "@/features/flow/flow-context"
import { GitConsole, type FeedEntry } from "@/features/console/git-console"
import { MAINT_RUNNING, type MaintState } from "@/features/maintenance/maintenance-status"
import type { RepoHealth } from "@/features/maintenance/health"

export type OpState = {
  text: string
  color: "neutral" | "primary" | "success" | "danger"
  action?: { label: string; run(): void }
}

type Props = {
  repoId: number
  branch: string | null
  /** work type of the current branch, `null` outside a flow (master, detached HEAD…) */
  flow: BranchFlow | null
  opState: OpState | null
  stats: Stats | null
  /** live database-maintenance progress (Verify/Compact), cf. features/maintenance */
  maint: MaintState | null
  /** repo healthcheck: when it recommends compaction and the feed is idle, a hint appears */
  health: RepoHealth | null
  onCompact(): void
}

const nf = new Intl.NumberFormat()

/* A single feed occupant at a time, by priority: a running maintenance op, then operation
   feedback (errors, "new commits" + Reload — auto-cleared by the store), then a settled
   maintenance result, then the health hint. `null` hands the feed back to the console line. */
function feedEntry({ opState, maint, health, onCompact }: Props): FeedEntry | null {
  if (maint?.running) return { tone: "busy", verb: maint.op, text: MAINT_RUNNING[maint.op](), percent: maint.percent }
  if (opState) return { tone: opState.color, text: opState.text, action: opState.action }
  if (maint?.result) return { tone: maint.result.ok ? "success" : "danger", verb: maint.op, text: maint.result.text }
  if (health?.needsCompaction)
    return {
      tone: "warning",
      verb: "health",
      text: messages.maintenance.compactRecommended,
      action: { label: messages.maintenance.compact, run: onCompact },
    }
  return null
}

export function StatusBar(props: Props) {
  const { repoId, branch, flow, stats } = props
  /* the work type tints the branch segment: shared signals from flow-context */
  const f = flow && FLOW_META[flow]
  const entry = feedEntry(props)
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t pr-3 pl-3.5 text-[0.625rem] text-muted-foreground">
      {/* feed occupant announced to screen readers (operation outcomes, maintenance, health) */}
      <span aria-live="polite" className="sr-only">
        {entry?.text ?? ""}
      </span>
      {/* graph loading stats (AUDIT.md §8): polite, not assertive — doesn't interrupt an
          ongoing selection announcement for a mere pagination progress update. */}
      <span aria-live="polite" className="sr-only">
        {stats ? messages.graph.commitsLoaded(nf.format(stats.loaded), nf.format(stats.total)) : ""}
      </span>

      {/* min-w-0 + truncate: a long branch name ellipses instead of pushing the feed out of view */}
      <span className={cn("flex max-w-[40ch] min-w-0 shrink items-center gap-1.5", f && `font-medium ${f.text}`)}>
        <HugeiconsIcon icon={f ? f.icon : GitBranchIcon} strokeWidth={2} className="size-3 shrink-0" />
        <span className="truncate">{branch ?? "—"}</span>
      </span>

      <GitConsole repoId={repoId} entry={entry} />

      {stats && (
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          <b className="font-medium text-foreground">{nf.format(stats.loaded)}</b> / {nf.format(stats.total)} commits
        </span>
      )}
    </footer>
  )
}
