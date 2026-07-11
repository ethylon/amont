/* Feature stash (AUDIT.md §7, phase 5) : composant + requête (stash-queries.ts) + actions (le
   store), colocalisés — le dossier « copie-moi » de référence. Auparavant étalée sur
   refs-sidebar (arbre + menu), detail-panel (aucune ref, juste le clic dans le graphe), repo-view
   (callbacks) et le graphe (foldStashes) : cette feature ne rassemble que la partie « liste des
   stashes dans le panneau latéral » — foldStashes reste dans le moteur de graphe (layout/collapse.ts),
   qui la consomme pour la mise en page, pas pour l'affichage de la liste. */

import { HugeiconsIcon } from "@hugeicons/react"
import { Archive02Icon, ArchiveArrowUpIcon, ArchiveRestoreIcon, Delete02Icon } from "@hugeicons/core-free-icons"

import type { Stash, StashAct } from "@/lib/git"
import { useRepoStore } from "@/features/repo/repo-store"
import { useStashesQuery } from "@/features/stash/stash-queries"
import { useResettableOpen } from "@/features/refs/refs-tree"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { RefGroup } from "@/components/ui/ref-group"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu"

/** Filtre par sous-chaîne sur le nom de l'entrée ou le message du WIP — même grammaire que le
    filtre de branches du sidebar, dont `RefsSidebar` a aussi besoin pour son message « aucune
    ref ne correspond » (il doit savoir si le stash, lui, a un résultat). */
export const matchStash = (s: Stash, q: string) => !q || s.name.includes(q) || s.s.toLowerCase().includes(q)

/* Une entrée de stash n'est pas une ref : pas d'arbre, pas de checkout, pas de focus de
   branche. Un clic saute à son nœud du graphe ; le menu porte les trois gestes de stash. */
function StashRow({ s, onFocus, onStash }: {
  s: Stash
  onFocus(s: Stash): void
  onStash(action: StashAct, name: string): void
}) {
  /* "WIP on develop: 1a2b3c4 sujet" → le préambule redit le nom : on ne garde que la suite */
  const msg = s.s.replace(/^(?:WIP on|On) [^:]+:\s*/, "")
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <button
          type="button"
          onClick={() => onFocus(s)}
          title={`${s.name} · ${s.s}`}
          className="gg-refrow -my-px flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-xs text-foreground select-none hover:bg-muted"
        >
          <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">{s.name}</span>
          <span className="truncate text-muted-foreground">{msg}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-72">
        <ContextMenuItem onClick={() => onStash("apply", s.name)}>
          <HugeiconsIcon icon={ArchiveArrowUpIcon} strokeWidth={2} />
          <MenuItemWithCmd label="Appliquer" cmd={`git stash apply ${s.name}`} />
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onStash("pop", s.name)}>
          <HugeiconsIcon icon={ArchiveRestoreIcon} strokeWidth={2} />
          <MenuItemWithCmd label="Appliquer et supprimer" cmd={`git stash pop ${s.name}`} />
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onStash("drop", s.name)}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          <MenuItemWithCmd label="Supprimer" cmd={`git stash drop ${s.name}`} />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Section stash du sidebar : requête, filtre et actions au même endroit — rendu `null` quand
    rien ne correspond au filtre, `RefsSidebar` n'a pas à connaître la forme d'une entrée de
    stash pour composer son message « aucun résultat ». */
export function StashSection({ filter }: { filter: string }) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const onFocusStash = useRepoStore((s) => s.focusStash)
  const onStash = useRepoStore((s) => s.runStash)
  const { data: stashes = [] } = useStashesQuery(api, repoId)

  const matches = stashes.filter((s) => matchStash(s, filter))
  const { open, onOpenChange } = useResettableOpen(true, !!filter)

  if (!matches.length) return null

  return (
    <RefGroup title="Stash" count={matches.length} open={open} onOpenChange={onOpenChange}>
      <ul role="list" className="mt-0.5 flex flex-col">
        {matches.map((s) => (
          <StashRow key={s.name + s.h} s={s} onFocus={onFocusStash} onStash={onStash} />
        ))}
      </ul>
    </RefGroup>
  )
}
