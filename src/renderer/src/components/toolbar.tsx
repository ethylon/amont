import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon, ArrowDown02Icon, ArrowUp02Icon, Folder01Icon,
  PanelLeftCloseIcon, PanelLeftOpenIcon, Refresh01Icon,
} from "@hugeicons/core-free-icons"

import type { OpName, Repo, Status } from "@/lib/git"
import { Badge } from "@/components/ui/badge"
import { IconButton } from "@/components/ui/icon-button"
import { Tip } from "@/components/ui/tip"
import { Button } from "@/components/ui/primitives/button"
import { Separator } from "@/components/ui/primitives/separator"
import { Spinner } from "@/components/ui/primitives/spinner"

const OPS = [
  { op: "fetch", label: "Fetch", icon: Refresh01Icon, hint: "Fetch — toutes les distantes, avec --prune" },
  { op: "pull", label: "Pull", icon: ArrowDown02Icon, hint: "Pull — fast-forward uniquement" },
  { op: "push", label: "Push", icon: ArrowUp02Icon, hint: "Push vers la distante suivie" },
] as const

type Props = {
  repo: Repo
  status: Status | null
  busyOp: OpName | null
  sidebarOpen: boolean
  onToggleSidebar(): void
  onRunOp(op: OpName): void
  /** la barre de recherche : elle a besoin du graphe, que la toolbar ne connaît pas */
  children: React.ReactNode
}

export function Toolbar({ repo, status, busyOp, sidebarOpen, onToggleSidebar, onRunOp, children }: Props) {
  const counts: Record<OpName, number | null> = {
    fetch: null,
    pull: status?.behind ?? null,
    push: status?.ahead ?? null,
  }

  return (
    <div className="flex h-11.5 shrink-0 items-center gap-2 overflow-x-auto border-b pr-3.5 pl-2.5">
      <IconButton
        label={sidebarOpen ? "Masquer le panneau latéral" : "Afficher le panneau latéral"}
        icon={PanelLeftCloseIcon}
        swapIcon={PanelLeftOpenIcon}
        swapped={sidebarOpen}
        onClick={onToggleSidebar}
      />

      {/* largeur figée : sans elle, un nom plus long décalerait toute la barre au changement
          d'onglet — et le fondu croisé du nom se ferait à géométrie variable */}
      <Tip text={repo.path}>
        <span className="gg-reponame flex w-42 shrink-0 items-center gap-1.5 text-xs">
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{repo.name}</span>
        </span>
      </Tip>

      <Separator orientation="vertical" className="mx-1 my-2" />

      <div className="flex shrink-0 items-center gap-1">
        {OPS.map(({ op, label, icon, hint }) => {
          const n = counts[op]
          return (
            <Tip key={op} text={hint}>
              <Button variant="ghost" size="sm" disabled={n === 0 || busyOp !== null} onClick={() => onRunOp(op)}>
                {busyOp === op ? (
                  <Spinner data-icon="inline-start" className="size-3" />
                ) : (
                  <HugeiconsIcon icon={icon} strokeWidth={2} data-icon="inline-start" />
                )}
                {label}
                {!!n && (
                  <Badge color="primary" shape="squared" className="tabular-nums">
                    {n}
                  </Badge>
                )}
              </Button>
            </Tip>
          )
        })}
      </div>

      <Separator orientation="vertical" className="mx-1 my-2" />

      {children}

      {/* ponytail: filtres à venir — désactivés tant qu'inertes, le shell garde la forme */}
      {["Auteur", "Période"].map((label) => (
        <Tip key={label} text="Filtre à venir">
          <span className="inline-flex shrink-0">
            <Button variant="outline" size="sm" disabled className="shrink-0">
              {label}
              <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} data-icon="inline-end" className="size-2.5 text-muted-foreground" />
            </Button>
          </span>
        </Tip>
      ))}

      <span className="flex-1" />
    </div>
  )
}
