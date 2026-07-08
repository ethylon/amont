import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon, ArrowDown02Icon, ArrowUp02Icon, Folder01Icon,
  PanelLeftIcon, Refresh01Icon, Search01Icon,
} from "@hugeicons/core-free-icons"

import type { OpName, Status } from "@/lib/git"
import { Badge } from "@/components/ui/badge"
import { IconButton } from "@/components/ui/icon-button"
import { Mark } from "@/components/mark"
import { Button } from "@/components/ui/primitives/button"
import { Kbd, KbdGroup } from "@/components/ui/primitives/kbd"
import { Separator } from "@/components/ui/primitives/separator"
import { Spinner } from "@/components/ui/primitives/spinner"

const OPS = [
  { op: "fetch", label: "Fetch", icon: Refresh01Icon, title: "Fetch — toutes les distantes, avec --prune" },
  { op: "pull", label: "Pull", icon: ArrowDown02Icon, title: "Pull — fast-forward uniquement" },
  { op: "push", label: "Push", icon: ArrowUp02Icon, title: "Push vers la distante suivie" },
] as const

type Props = {
  repoName: string | null
  status: Status | null
  busyOp: OpName | null
  onToggleSidebar(): void
  onOpenRepo(): void
  onOpenPalette(): void
  onRunOp(op: OpName): void
}

export function Titlebar({ repoName, status, busyOp, onToggleSidebar, onOpenRepo, onOpenPalette, onRunOp }: Props) {
  const counts: Record<OpName, number | null> = {
    fetch: null,
    pull: status?.behind ?? null,
    push: status?.ahead ?? null,
  }

  return (
    <header className="flex h-12.5 shrink-0 items-center gap-1.5 border-b pr-3 pl-3.5">
      <div className="me-1.5 flex shrink-0 items-center gap-2.5">
        <Mark className="size-5" />
        <span className="text-xs font-semibold tracking-tight">git-graph</span>
      </div>

      {repoName && <IconButton label="Panneau latéral" icon={PanelLeftIcon} onClick={onToggleSidebar} />}

      <Button variant="ghost" size="sm" className="min-w-0 shrink" onClick={onOpenRepo}>
        <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} data-icon="inline-start" className="text-muted-foreground" />
        {repoName ? (
          <>
            <span aria-hidden className="text-border">/</span>
            <span className="truncate font-medium">{repoName}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} data-icon="inline-end" className="size-2.5 text-muted-foreground" />
          </>
        ) : (
          "Ouvrir un repo…"
        )}
      </Button>

      <div className="ms-auto flex shrink-0 items-center gap-1.5">
        {repoName && (
          <>
            <div className="flex items-center gap-1">
              {OPS.map(({ op, label, icon, title }) => {
                const n = counts[op]
                return (
                  <Button
                    key={op}
                    variant="ghost"
                    size="sm"
                    title={title}
                    disabled={n === 0 || busyOp !== null}
                    onClick={() => onRunOp(op)}
                  >
                    {busyOp === op ? (
                      <Spinner data-icon="inline-start" className="size-3" />
                    ) : (
                      <HugeiconsIcon icon={icon} strokeWidth={2} data-icon="inline-start" />
                    )}
                    {label}
                    {!!n && (
                      <Badge color="primary" shape="squared" className="font-mono tabular-nums">
                        {n}
                      </Badge>
                    )}
                  </Button>
                )
              })}
            </div>
            <Separator orientation="vertical" className="mx-0.5 h-4.5" />
          </>
        )}

        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={onOpenPalette}>
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} data-icon="inline-start" />
          Rechercher
          <KbdGroup className="ms-auto ps-2.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </Button>
      </div>
    </header>
  )
}
