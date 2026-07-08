import { HugeiconsIcon } from "@hugeicons/react"
import { GitBranchIcon } from "@hugeicons/core-free-icons"

import type { Stats } from "@/components/graph-canvas"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/primitives/button"
import { Separator } from "@/components/ui/primitives/separator"

export type OpState = {
  text: string
  color: "neutral" | "primary" | "success" | "danger"
  action?: { label: string; run(): void }
}

type Props = {
  branch: string | null
  opState: OpState | null
  hoverInfo: string | null
  stats: Stats | null
}

const nf = new Intl.NumberFormat("fr")

const Num = ({ children }: { children: React.ReactNode }) => (
  <b className="font-mono font-medium text-foreground">{children}</b>
)

export function StatusBar({ branch, opState, hoverInfo, stats }: Props) {
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t pr-3 pl-3.5 text-[0.625rem] text-muted-foreground">
      <span className="flex shrink-0 items-center gap-1.5">
        <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} className="size-3" />
        {branch ?? "—"}
      </span>

      {opState && (
        <Badge color={opState.color} shape="squared" title={opState.text} className="max-w-[46ch] gap-2 ps-2 pe-1">
          <span className="truncate">{opState.text}</span>
          {opState.action && (
            <Button variant="ghost" size="xs" onClick={opState.action.run} className="text-(--badge-fg)">
              {opState.action.label}
            </Button>
          )}
        </Badge>
      )}

      {hoverInfo && (
        /* shrink (et non shrink-0 de la base) : la pastille cède la place aux stats */
        <Badge color="primary" shape="squared" className="min-w-0 shrink">
          <span className="truncate">{hoverInfo}</span>
        </Badge>
      )}

      {stats && (
        <div className="ms-auto flex shrink-0 items-center gap-3 whitespace-nowrap tabular-nums">
          <span>
            <Num>{nf.format(stats.loaded)}</Num> / {nf.format(stats.total)} commits
          </span>
          <Separator orientation="vertical" className="h-3.5" />
          <span>
            <Num>{stats.lanes}</Num> lanes
          </span>
          <Separator orientation="vertical" className="h-3.5" />
          <span>
            <Num>{stats.dangling}</Num> arêtes en attente
          </span>
          <Separator orientation="vertical" className="h-3.5" />
          <span>
            layout <Num>{stats.ms.toFixed(0)} ms</Num>
          </span>
        </div>
      )}
    </footer>
  )
}
