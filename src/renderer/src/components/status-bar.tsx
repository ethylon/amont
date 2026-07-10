import { HugeiconsIcon } from "@hugeicons/react"
import { GitBranchIcon } from "@hugeicons/core-free-icons"

import type { Stats } from "@/components/graph-canvas"
import type { BranchFlow } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import { FLOW_META } from "@/components/flow-context"
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
  /** type de travail de la branche courante, `null` hors flow (master, HEAD détachée…) */
  flow: BranchFlow | null
  opState: OpState | null
  hoverInfo: string | null
  stats: Stats | null
  /** console git, rendue à droite des infos de survol */
  console?: React.ReactNode
}

const nf = new Intl.NumberFormat("fr")

const Num = ({ children }: { children: React.ReactNode }) => (
  <b className="font-medium text-foreground">{children}</b>
)

export function StatusBar({ branch, flow, opState, hoverInfo, stats, console }: Props) {
  /* le type de travail teinte le segment branche : signes partagés de flow-context */
  const f = flow && FLOW_META[flow]
  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t pr-3 pl-3.5 text-[0.625rem] text-muted-foreground">
      {/* issue des opérations git annoncée aux lecteurs d'écran ; le survol (hoverInfo) reste muet */}
      <span aria-live="polite" className="sr-only">{opState?.text ?? ""}</span>

      {/* min-w-0 + truncate : une branche longue s'ellipse au lieu de pousser stats hors champ */}
      <span className={cn("flex min-w-0 shrink items-center gap-1.5", f && `font-medium ${f.text}`)}>
        <HugeiconsIcon icon={f ? f.icon : GitBranchIcon} strokeWidth={2} className="size-3 shrink-0" />
        <span className="truncate">{branch ?? "—"}</span>
        {f && <span className="shrink-0 font-normal text-muted-foreground">{flow} en cours</span>}
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

      {hoverInfo && (
        /* shrink (et non shrink-0 de la base) : la pastille cède la place aux stats */
        <Badge color="primary" shape="squared" className="min-w-0 shrink">
          <span className="truncate">{hoverInfo}</span>
        </Badge>
      )}

      {console}

      {stats && (
        <div className="ms-auto flex shrink-0 items-center gap-3 whitespace-nowrap tabular-nums">
          <span>
            <Num>{nf.format(stats.loaded)}</Num> / {nf.format(stats.total)} commits
          </span>
          <Separator orientation="vertical" />
          <span>
            layout <Num>{stats.ms.toFixed(0)} ms</Num>
          </span>
        </div>
      )}
    </footer>
  )
}
