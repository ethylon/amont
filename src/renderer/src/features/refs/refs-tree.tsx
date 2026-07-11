/* Arbre des refs (AUDIT.md §7, phase 5) : une des cinq préoccupations de l'ancien
   refs-sidebar.tsx (514 lignes) — construction de l'arbre par segments de nom, tri (branches
   d'intégration en tête), et la ligne de ref elle-même (menu compris). Voir refs-menu.tsx pour
   le contenu du menu contextuel et refs-focus-paint.ts pour la peinture des contours. */

import { useEffect, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { ArrowRight01Icon, GitMergeIcon } from "@hugeicons/core-free-icons"

import type { BranchAct, FlowPrefixes, GitRef } from "@/lib/git"
import { typeColor } from "@/lib/commit-parse"
import { PINNED, pinRank } from "@/lib/gitflow"
import { buildPathTree, type PathTree } from "@/lib/path-tree"
import type { BadgeColor } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu"
import { BranchMenu } from "@/features/refs/refs-menu"

type RowProps = { onCheckout(name: string): void }
/* le contexte que le menu d'une branche a besoin de connaître, remis tel quel à chaque niveau
   de l'arbre : quatre props traversant trois composants ne diraient rien de plus. */
export type Ctx = RowProps & {
  /** branche courante, `null` sur HEAD détachée */
  current: string | null
  flow: FlowPrefixes | null
  onBranch(action: BranchAct, name: string): void
  /** refs focalisées, `kind:name` — les identités cliquées, ou les branches dérivées des commits */
  focusedKeys: Set<string>
  /** focalise la ref dans le graphe : scroll au tip et sélection de la branche entière.
      Ctrl (`additive`) ajoute ou retire ; le focus se lève d'un clic dans le vide */
  onFocusRef(r: GitRef, additive: boolean): void
}

/** identité d'une ref, partagée avec RepoView : `master` local et `origin/master` cohabitent */
export const refKey = (r: GitRef) => `${r.kind}:${r.name}`

/* Le préfixe d'une branche porte la même sémantique que le badge de type d'un commit :
   `feature/…` est vert comme `feat:`, `hotfix/…` rouge comme `[HOTFIX]`. Un préfixe
   inconnu (`origin`, `ui`) n'a pas de teinte : pas de pastille. */
const DOT: Partial<Record<BadgeColor, string>> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  release: "bg-release",
  info: "bg-info",
  refactor: "bg-refactor",
}

export const buildTree = (refs: GitRef[]) => buildPathTree(refs, (r) => r.name)

/** Sous la racine, tout est replié au premier rendu sauf le chemin qui mène à HEAD. */
const holdsHead = (n: PathTree<GitRef>): boolean =>
  n.items.some((r) => r.head) || [...n.dirs.values()].some(holdsHead)

/** un pli qui cache une ref focalisée doit s'ouvrir : le focus posé depuis le graphe se voit */
const holdsFocused = (n: PathTree<GitRef>, keys: Set<string>): boolean =>
  n.items.some((r) => keys.has(refKey(r))) || [...n.dirs.values()].some((d) => holdsFocused(d, keys))

const track = (r: GitRef) =>
  [r.ahead && `↑${r.ahead}`, r.behind && `↓${r.behind}`].filter(Boolean).join(" ")

/** Remplace le remount-par-clé (3 variantes dans l'ancien refs-sidebar.tsx monolithique) par un
    Collapsible contrôlé : l'ouverture est un state React, réinitialisé à `defaultOpen` chaque
    fois qu'une dépendance de reset change (un focus posé depuis le graphe, un filtre qui
    démarre/s'arrête) — exactement l'effet du remount-par-clé, sans démonter/remonter le
    sous-arbre. Entre deux resets, l'utilisateur reste maître : un clic sur le trigger persiste
    jusqu'au prochain reset. */
export function useResettableOpen(defaultOpen: boolean, ...resetDeps: unknown[]) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => setOpen(defaultOpen), resetDeps) // eslint-disable-line react-hooks/exhaustive-deps
  return { open, onOpenChange: setOpen }
}

function RefDir({ label, node, icon, ctx, openDirs, forceOpen }: {
  label: string; node: PathTree<GitRef>; icon: IconSvgElement; ctx: Ctx; openDirs: boolean; forceOpen: boolean
}) {
  const dot = DOT[typeColor(label.toLowerCase())]
  const focused = ctx.focusedKeys.size > 0 && holdsFocused(node, ctx.focusedKeys)
  const { open, onOpenChange } = useResettableOpen(
    forceOpen || openDirs || focused || holdsHead(node),
    forceOpen,
    focused
  )

  return (
    <li>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group/dir flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
          />
          {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />}
          <span className="truncate">{label}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-2 border-l pl-2">
          <Tree node={node} icon={icon} ctx={ctx} forceOpen={forceOpen} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function RefRow({ r, label, icon, ctx }: { r: GitRef; label: string; icon: IconSvgElement; ctx: Ctx }) {
  const t = track(r)
  /* un tag se checkout en HEAD détaché, ce qui ne s'annule pas d'un double-clic.
     Une distante bascule sur la locale de suivi (DWIM de git checkout <nom>). */
  const switchable = (r.kind === "head" && !r.head) || r.kind === "remote"
  /* ponytail: strip du premier segment ; git refuse de lui-même si le nom est ambigu entre remotes */
  const target = r.kind === "remote" ? r.name.split("/").slice(1).join("/") : r.name

  /* « allumée » = cette ref est focalisée — à l'identité, `kind` compris : la locale et sa
     distante ne s'allument jamais ensemble. La passe DOM (cf. refs-focus-paint.ts) lit `data-lit`
     pour tracer le contour et fusionner les runs contigus. */
  const lit = ctx.focusedKeys.has(refKey(r))
  const row = (
    <button
      type="button"
      data-lit={lit ? "1" : undefined}
      onClick={(e) => ctx.onFocusRef(r, e.ctrlKey || e.metaKey)}
      onDoubleClick={switchable ? () => ctx.onCheckout(target) : undefined}
      className={cn(
        "gg-refrow flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-xs select-none",
        "text-foreground hover:bg-muted -my-px",
        r.head && "bg-primary/30 hover:bg-primary/45"
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
      {/* une branche dont la distante a disparu n'est plus une destination : elle se lit comme un reliquat */}
      <span className={cn("truncate font-medium", r.gone && "text-muted-foreground line-through")}>{label}</span>
      {/* badge, pas du texte nu : en bout de ligne, un nombre nu se lit comme le compteur de
          refs du groupe. h-4 pour que la ligne garde la hauteur des branches sans suivi. */}
      {t && (
        <Badge shape="squared" className="ms-auto h-4 px-1.5 tabular-nums">
          {t}
        </Badge>
      )}
      {r.merged && (
        <HugeiconsIcon
          icon={GitMergeIcon}
          strokeWidth={2}
          className={cn("size-3.5 shrink-0 text-muted-foreground", !t && "ms-auto")}
        />
      )}
    </button>
  )

  if (r.kind !== "head") return <li>{row}</li>
  /* le trigger porte le `li` : le clic droit prend toute la ligne, pas le seul bouton */
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>{row}</ContextMenuTrigger>
      <BranchMenu r={r} ctx={ctx} />
    </ContextMenu>
  )
}

/* `openDirs` : ouvre les dossiers de ce seul niveau (la récursion repasse à false). Sert aux
   distantes, où le remote (`origin`) resterait sinon replié faute de HEAD à l'intérieur.
   `forceOpen` : tout ouvert, à tous les niveaux — un résultat de filtre caché dans un pli
   serait invisible. Un dossier qui abrite une ref focalisée s'ouvre par le même mécanisme,
   ciblé sur son seul chemin (cf. `useResettableOpen` dans RefDir). */
export function Tree({ node, icon, ctx, openDirs = false, forceOpen = false }: {
  node: PathTree<GitRef>; icon: IconSvgElement; ctx: Ctx; openDirs?: boolean; forceOpen?: boolean
}) {
  const dirs = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
  const leaves = [...node.items].sort(
    (a, b) => pinRank(a.name.split("/").pop()!) - pinRank(b.name.split("/").pop()!) || a.name.localeCompare(b.name)
  )
  const label = (r: GitRef) => r.name.split("/").pop()!
  const pinned = leaves.filter((r) => pinRank(label(r)) < PINNED.length)

  const row = (r: GitRef) => <RefRow key={r.name} r={r} label={label(r)} icon={icon} ctx={ctx} />

  return (
    <ul role="list" className="flex flex-col">
      {pinned.map(row)}
      {dirs.map((k) => (
        <RefDir key={k} label={k} node={node.dirs.get(k)!} icon={icon} ctx={ctx} openDirs={openDirs} forceOpen={forceOpen} />
      ))}
      {leaves.slice(pinned.length).map(row)}
    </ul>
  )
}
