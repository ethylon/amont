import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { CloudIcon, GitBranchIcon, Search01Icon, Tag01Icon } from "@hugeicons/core-free-icons"

import type { GitRef } from "@/lib/git"
import { cn } from "@/lib/utils"
import { useFlowQuery } from "@/features/flow/flow-queries"
import { useRefsQuery } from "@/features/refs/refs-queries"
import { useStashesQuery } from "@/features/stash/stash-queries"
import { matchStash, StashSection } from "@/features/stash/stash-section"
import { useRepoStore } from "@/features/repo/repo-store"
import { buildTree, refKey, Tree, useResettableOpen, type Ctx } from "@/features/refs/refs-tree"
import { paintFocusRuns } from "@/features/refs/refs-focus-paint"
import { AsyncHint } from "@/components/ui/async-hint"
import { RefGroup } from "@/components/ui/ref-group"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"

const GROUPS = [
  { title: "Branches", kind: "head", icon: GitBranchIcon },
  { title: "Distantes", kind: "remote", icon: CloudIcon },
  { title: "Tags", kind: "tag", icon: Tag01Icon },
] as const satisfies readonly { title: string; kind: GitRef["kind"]; icon: IconSvgElement }[]

function RefGroupSection({ title, icon, refs, ctx, openDirs, forceOpen }: {
  title: string; icon: IconSvgElement; refs: GitRef[]; ctx: Ctx; openDirs: boolean; forceOpen: boolean
}) {
  const focused = refs.some((r) => ctx.focusedKeys.has(refKey(r)))
  const { open, onOpenChange } = useResettableOpen(true, forceOpen, focused)

  return (
    <RefGroup title={title} count={refs.length} open={open} onOpenChange={onOpenChange}>
      <div className="mt-0.5">
        <Tree node={buildTree(refs)} icon={icon} ctx={ctx} openDirs={openDirs} forceOpen={forceOpen} />
      </div>
    </RefGroup>
  )
}

/** Store et requêtes plutôt que 10 props (AUDIT.md §5) : `open`/`focusedKeys` viennent du
    store, `flow`/refs/stashes de TanStack Query — plus de `refreshKey` bricolé en chaîne, les
    invalidations de la couche requêtes suffisent à faire relire l'arbre.

    Éclaté en cinq modules (AUDIT.md §7, phase 5 — l'ancien fichier en faisait 514 lignes) :
    ce fichier orchestre le filtre et l'assemblage ; refs-tree.tsx porte l'arbre et la ligne de
    ref, refs-menu.tsx le menu de branche, refs-focus-paint.ts la peinture des contours, et la
    section stash vit désormais dans features/stash/ (feature verticale à part entière). */
export function RefsSidebar() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const open = useRepoStore((s) => s.ui.sidebarOpen)
  const focusedKeys = useRepoStore((s) => s.selection.focusedKeys)
  const onCheckout = useRepoStore((s) => s.checkout)
  const onBranch = useRepoStore((s) => s.runBranch)
  const onFocusRef = useRepoStore((s) => s.focusRef)

  const { data: flow = null } = useFlowQuery(api, repoId)
  /* pas de flag `stale` à recopier : `placeholderData: keepPreviousData` (cf. lib/queries.ts)
     tient l'ancien rendu affiché pendant qu'une nouvelle réponse arrive, sans le clignotement
     que `useAsync` (vidé à chaque clé) aurait produit toutes les cinq minutes (auto-fetch). */
  const { data, isError: error } = useRefsQuery(api, repoId)
  /* seul le comptage nous intéresse ici (message « aucun résultat ») : le rendu de la liste vit
     dans <StashSection>, qui appelle la même requête — TanStack Query dédoublonne par clé. */
  const { data: stashes = [] } = useStashesQuery(api, repoId)
  const [filter, setFilter] = useState("")
  const navRef = useRef<HTMLElement>(null)

  /* filtre par sous-chaîne sur le nom complet, préfixe compris : `feat` attrape `feature/x` */
  const q = filter.trim().toLowerCase()
  const match = (r: GitRef) => !q || r.name.toLowerCase().includes(q)

  const paint = useCallback(() => paintFocusRuns(navRef.current), [])

  useLayoutEffect(paint, [paint, focusedKeys, data, q]) // le filtre déplace les refs allumées
  /* Un focus posé depuis le graphe peut viser une ref hors de la fenêtre du sidebar : une fois
     les plis ouverts (cf. refs-tree.tsx), on amène la première allumée en vue. */
  useEffect(() => {
    if (!focusedKeys.size) return
    navRef.current?.querySelector(".gg-refrow[data-lit]")?.scrollIntoView({ block: "nearest" })
  }, [focusedKeys])
  /* Un repli/dépli de dossier ne rerend pas le sidebar (état interne du Collapsible) : on repeint
     après chaque clic dans la nav, une fois le DOM stabilisé. */
  useEffect(() => {
    const root = navRef.current
    if (!root) return
    const onClick = () => requestAnimationFrame(paint)
    root.addEventListener("click", onClick)
    return () => root.removeEventListener("click", onClick)
  }, [paint])

  const ctx: Ctx = {
    current: data?.find((r) => r.head)?.name ?? null,
    flow,
    onCheckout,
    onBranch,
    focusedKeys,
    onFocusRef,
  }

  return (
    /* replié = largeur nulle, pas démonté : le contenu garde sa largeur et se fait rogner,
       sinon les champs et les libellés se tasseraient pendant l'animation. */
    <nav
      ref={navRef}
      data-gg-keep-focus
      aria-label="Branches"
      inert={!open}
      className={cn(
        /* min-w-0 : sans lui, le minimum automatique du flex item se cale sur le contenu (236px) */
        "flex min-w-0 shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none",
        open ? "w-59 border-r" : "w-0"
      )}
    >
      <div className="flex w-59 flex-1 flex-col overflow-hidden">
        <div className="flex border-b p-2.5">
          <InputGroup>
            <InputGroupAddon>
              <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              placeholder="Filtrer les branches"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && filter && (e.stopPropagation(), setFilter(""))}
            />
          </InputGroup>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 overflow-auto px-2 pt-2 pb-4">
          {error && <p className="px-1.5 text-xs text-muted-foreground">Branches indisponibles.</p>}
          {!data && !error && <AsyncHint className="px-1.5">branches…</AsyncHint>}
          {data && q && !data.some(match) && !stashes.some((s) => matchStash(s, q)) && (
            <p className="px-1.5 text-xs text-muted-foreground">Aucune ref ne correspond.</p>
          )}
          {data &&
            GROUPS.map((g) => {
              const refs = data.filter((r) => r.kind === g.kind && match(r))
              if (!refs.length) return null
              return (
                <RefGroupSection
                  key={g.kind}
                  title={g.title}
                  icon={g.icon}
                  refs={refs}
                  ctx={ctx}
                  openDirs={g.kind === "remote"}
                  forceOpen={!!q}
                />
              )
            })}
          <StashSection filter={q} />
        </div>
      </div>
    </nav>
  )
}
