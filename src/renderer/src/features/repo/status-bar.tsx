import { memo } from "react"

import type { Stats } from "@/features/graph/controller"
import type { OpName } from "@/lib/git"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { GitConsole, type FeedEntry } from "@/features/console/git-console"
import { MAINT_RUNNING, type MaintState } from "@/features/maintenance/maintenance-status"
import type { RepoHealth } from "@/features/maintenance/health"

/** Live footer label of a running network op, the counterpart of MAINT_RUNNING for fetch/pull/push. */
const OP_RUNNING: Record<OpName, () => string> = {
  fetch: () => messages.ops.fetching,
  pull: () => messages.ops.pulling,
  push: () => messages.ops.pushing,
}

export type OpState = {
  text: string
  color: "neutral" | "primary" | "success" | "danger"
  action?: { label: string; run(): void }
}

type Props = {
  repoId: number
  opState: OpState | null
  /** live `NN%` of the running network op (fetch/pull/push), streamed from git's `--progress` */
  opProgress: { op: OpName; percent: number } | null
  /** labels of the mutations waiting their turn in the repo queue (`git:queue`), in run order */
  queued: string[]
  stats: Stats | null
  /** live database-maintenance progress (Verify/Compact), cf. features/maintenance */
  maint: MaintState | null
  /** repo healthcheck: when it recommends compaction and the feed is idle, a hint appears */
  health: RepoHealth | null
  onCompact(): void
}

const nf = new Intl.NumberFormat()

/* A single feed occupant at a time, by priority: a running maintenance op, then a running
   network op (its live `--progress` percentage), then operation feedback (errors, "new commits" +
   Reload — auto-cleared by the store), then a settled maintenance result, then the health hint.
   `null` hands the feed back to the console line. */
function feedEntry({ opState, opProgress, maint, health, onCompact }: Props): FeedEntry | null {
  if (maint?.running) return { tone: "busy", verb: maint.op, text: MAINT_RUNNING[maint.op](), percent: maint.percent }
  if (opProgress)
    return { tone: "busy", verb: opProgress.op, text: OP_RUNNING[opProgress.op](), percent: opProgress.percent }
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

/* memo (perf audit, finding 4b): selection clicks re-render the tab but leave the footer's
   props untouched — with RepoView memoizing `health`/`onCompact`, the bar only re-renders
   when an operation or the graph stats actually move. */
export const StatusBar = memo(function StatusBar(props: Props) {
  /* memo'd component: re-render on a runtime language switch even when no prop moved */
  useLocale()
  const { repoId, stats, queued } = props
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

      <GitConsole repoId={repoId} entry={entry} />

      {/* operations waiting their turn behind the running one (main-side FIFO queue): count
          in the bar, run order in the tooltip. Announced politely — a queue growing or
          draining must not interrupt an ongoing announcement. */}
      {queued.length > 0 && (
        <span
          aria-live="polite"
          title={queued.join(" → ")}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap tabular-nums"
        >
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-warning" />
          {messages.ops.queued(queued.length)}
        </span>
      )}

      {stats && (
        <span className="ms-auto shrink-0 whitespace-nowrap tabular-nums">
          <b className="font-medium text-foreground">{nf.format(stats.loaded)}</b> / {nf.format(stats.total)}{" "}
          {messages.flow.commits}
        </span>
      )}
    </footer>
  )
})
