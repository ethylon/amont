import { HugeiconsIcon } from "@hugeicons/react"
import { GitBranchIcon } from "@hugeicons/core-free-icons"

import type { Stats } from "@/features/graph/controller"
import type { BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { FLOW_META } from "@/features/flow/flow-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export type OpState = {
  text: string
  color: "neutral" | "primary" | "success" | "danger"
  action?: { label: string; run(): void }
}

type Props = {
  branch: string | null
  /** work type of the current branch, `null` outside a flow (master, detached HEAD…) */
  flow: BranchFlow | null
  opState: OpState | null
  stats: Stats | null
  /** the git console, as a slot — named this way to avoid shadowing the global `console` (AUDIT.md §7,
      phase 5, item 6). */
  consoleSlot?: React.ReactNode
}

const nf = new Intl.NumberFormat()

const Num = ({ children }: { children: React.ReactNode }) => <b className="font-medium text-foreground">{children}</b>

export function StatusBar({ branch, flow, opState, stats, consoleSlot }: Props) {
  /* the work type tints the branch segment: shared signals from flow-context */
  const f = flow && FLOW_META[flow]
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t pr-3 pl-3.5 text-[0.625rem] text-muted-foreground">
      {/* outcome of git operations announced to screen readers; the hover (hoverInfo) stays silent */}
      <span aria-live="polite" className="sr-only">
        {opState?.text ?? ""}
      </span>
      {/* graph loading stats (AUDIT.md §8): polite, not assertive — doesn't interrupt an
          ongoing selection announcement for a mere pagination progress update. */}
      <span aria-live="polite" className="sr-only">
        {stats ? messages.graph.commitsLoaded(nf.format(stats.loaded), nf.format(stats.total)) : ""}
      </span>

      {/* min-w-0 + truncate: a long branch name ellipses instead of pushing stats out of view */}
      <span className={cn("flex min-w-0 shrink items-center gap-1.5", f && `font-medium ${f.text}`)}>
        <HugeiconsIcon icon={f ? f.icon : GitBranchIcon} strokeWidth={2} className="size-3 shrink-0" />
        <span className="truncate">{branch ?? "—"}</span>
      </span>

      {opState && (
        <Badge color={opState.color} shape="squared" className="min-w-0 max-w-[46ch] shrink gap-2 ps-2 pe-1">
          <span className="truncate">{opState.text}</span>
          {opState.action && (
            <Button variant="ghost" size="xs" onClick={opState.action.run} className="text-(--badge-fg)">
              {opState.action.label}
            </Button>
          )}
        </Badge>
      )}

      {consoleSlot}

      {stats && (
        <div className="ms-auto flex shrink-0 items-center gap-3 whitespace-nowrap tabular-nums">
          <span>
            <Num>{nf.format(stats.loaded)}</Num> / {nf.format(stats.total)} commits
          </span>
        </div>
      )}
    </footer>
  )
}
