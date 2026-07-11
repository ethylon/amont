import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Bug01Icon, Fire02Icon, GitBranchIcon, GitMergeIcon, RocketIcon } from "@hugeicons/core-free-icons"

import type { FlowInfo } from "@/lib/git"
import type { BranchFlow } from "@/lib/gitflow"
import { cn } from "@/lib/utils"

/* Signes et teintes de tous les indicateurs de flow (statusbar, cockpit, carte) : mêmes teintes
   que les pastilles du sidebar, mêmes icônes release/hotfix que les chips de merge du graphe. */
export const FLOW_META: Record<BranchFlow, { icon: IconSvgElement; text: string; bg: string }> = {
  feature: { icon: GitBranchIcon, text: "text-success", bg: "bg-success/10" },
  bugfix: { icon: Bug01Icon, text: "text-warning", bg: "bg-warning/10" },
  release: { icon: RocketIcon, text: "text-release", bg: "bg-release/10" },
  hotfix: { icon: Fire02Icon, text: "text-destructive", bg: "bg-destructive/10" },
}

/** « 35 min », « 4 h », « 2 j » — l'échelle grossière suffit à situer un cycle. */
function duration(epoch: number): string {
  const s = Math.max(60, Date.now() / 1000 - epoch)
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return `${Math.floor(s / 86400)} j`
}

const count = (info: FlowInfo) =>
  info.commits ? `${info.commits} commit${info.commits > 1 ? "s" : ""}` : "aucun commit"

/* Cockpit : bandeau sous la toolbar dès qu'une branche de flow est sortie — masqué sur les
   troncs (master, develop) et HEAD détachée. À droite, où le travail atterrira une fois
   terminé (merge du finish, tag posé). */
export function FlowBanner({ kind, branch, info }: { kind: BranchFlow; branch: string; info: FlowInfo }) {
  const m = FLOW_META[kind]
  return (
    <div
      className={cn(
        /* gg-drop : après le boot, l'insertion pousse le contenu en douceur (cf. app.css) */
        "gg-drop flex h-8 shrink-0 items-center gap-3 overflow-x-auto border-b px-3.5 text-xs whitespace-nowrap",
        m.bg,
        m.text
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <HugeiconsIcon icon={m.icon} strokeWidth={2} className="size-3.5 shrink-0" />
        {branch}
      </span>
      <span className="opacity-80">{count(info)}</span>
      <span className="flex-1" />
      <span className="flex items-center gap-1.5 opacity-80">
        <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} className="size-3.5 shrink-0" />
        vers {info.targets.join(" + ")}
        {info.nextTag && ` · tag ${info.nextTag}`}
      </span>
    </div>
  )
}

/* Carte contexte : l'état vide du panneau détail résume le travail en cours au lieu de ne
   rien dire. Tous les types de flow, feature comprise. */
export function FlowCard({ kind, branch, info }: { kind: BranchFlow; branch: string; info: FlowInfo }) {
  const m = FLOW_META[kind]
  const rows = [
    ["base", info.base ?? "—"],
    ["commits", info.commits ? String(info.commits) : "aucun"],
    [info.targets.length > 1 ? "cibles du finish" : "cible du finish", info.targets.join(" + ") || "—"],
    ...(info.nextTag ? [["tag attendu", info.nextTag]] : []),
  ]
  return (
    <div className="gg-fadein shrink-0 rounded-md border p-3.5">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", m.bg, m.text)}>
          <HugeiconsIcon icon={m.icon} strokeWidth={2} className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{branch}</span>
          <span className={cn("block text-[0.625rem]", m.text)}>
            {kind} en cours{info.startedAt ? ` depuis ${duration(info.startedAt)}` : ""}
          </span>
        </span>
      </div>
      <dl className="mt-3 border-t pt-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
