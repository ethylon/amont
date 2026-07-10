import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowDown02Icon,
  ArrowRight01Icon,
  ArrowUp02Icon,
  CheckmarkCircle02Icon,
  CloudIcon,
  Delete02Icon,
  GitBranchIcon,
  GitMergeIcon,
  Search01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons"

import type { BranchAct, FlowPrefixes, GitRef, RepoApi } from "@/lib/git"
import { typeColor, type BadgeColor } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/primitives/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/primitives/context-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/primitives/input-group"
import { Spinner } from "@/components/ui/primitives/spinner"

const GROUPS = [
  { title: "Branches", kind: "head", icon: GitBranchIcon },
  { title: "Distantes", kind: "remote", icon: CloudIcon },
  { title: "Tags", kind: "tag", icon: Tag01Icon },
] as const satisfies readonly { title: string; kind: GitRef["kind"]; icon: IconSvgElement }[]

/* Le préfixe d'une branche porte la même sémantique que le badge de type d'un commit :
   `feature/…` est vert comme `feat:`, `hotfix/…` rouge comme `[HOTFIX]`. Un préfixe
   inconnu (`origin`, `ui`) n'a pas de teinte : pas de pastille. */
const DOT: Partial<Record<BadgeColor, string>> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  release: "bg-release",
}

/** Les branches d'intégration passent devant, dans cet ordre. */
const PINNED = ["master", "main", "develop"]
const pinRank = (label: string) => {
  const i = PINNED.indexOf(label)
  return i < 0 ? PINNED.length : i
}

/* `git flow feature finish` : le genre suit le mot français qu'on lui prête. */
const FLOW_LABEL = {
  feature: "Terminer la feature",
  bugfix: "Terminer le bugfix",
  release: "Terminer la release",
  hotfix: "Terminer le hotfix",
} as const satisfies Record<keyof FlowPrefixes, string>

const flowType = (name: string, prefixes: FlowPrefixes | null) =>
  prefixes &&
  (Object.keys(FLOW_LABEL) as (keyof FlowPrefixes)[]).find(
    (t) => prefixes[t] && name.startsWith(prefixes[t]!)
  )

/* Les segments de `feature/optim-cout` deviennent des dossiers ; la feuille porte la ref. */
type Node = { dirs: Map<string, Node>; leaves: { ref: GitRef; label: string }[] }
type RowProps = { onCheckout(name: string): void }
/* le contexte que le menu d'une branche a besoin de connaître, remis tel quel à chaque niveau
   de l'arbre : quatre props traversant trois composants ne diraient rien de plus. */
type Ctx = RowProps & {
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
const refKey = (r: GitRef) => `${r.kind}:${r.name}`

function buildTree(refs: GitRef[]): Node {
  const root: Node = { dirs: new Map(), leaves: [] }
  for (const ref of refs) {
    const parts = ref.name.split("/")
    let n = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), leaves: [] })
      n = n.dirs.get(parts[i])!
    }
    n.leaves.push({ ref, label: parts[parts.length - 1] })
  }
  return root
}

/** Sous la racine, tout est replié au premier rendu sauf le chemin qui mène à HEAD. */
const holdsHead = (n: Node): boolean =>
  n.leaves.some((l) => l.ref.head) || [...n.dirs.values()].some(holdsHead)

/** un pli qui cache une ref focalisée doit s'ouvrir : le focus posé depuis le graphe se voit */
const holdsFocused = (n: Node, keys: Set<string>): boolean =>
  n.leaves.some((l) => keys.has(refKey(l.ref))) || [...n.dirs.values()].some((d) => holdsFocused(d, keys))

const track = (r: GitRef) =>
  [r.ahead && `↑${r.ahead}`, r.behind && `↓${r.behind}`].filter(Boolean).join(" ")

/* Le menu ne s'ouvre que sur une branche locale : une distante ne se merge ni ne se pousse,
   et un tag n'a rien de tout ça. `flow finish` connaît le nom complet, préfixe compris. */
function BranchMenu({ r, ctx }: { r: GitRef; ctx: Ctx }) {
  const flow = flowType(r.name, ctx.flow)
  return (
    <ContextMenuContent>
      <ContextMenuItem disabled={r.head} onClick={() => ctx.onCheckout(r.name)}>
        <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} />
        Checkout
      </ContextMenuItem>
      <ContextMenuItem disabled={r.head || !ctx.current} onClick={() => ctx.onBranch("merge", r.name)}>
        <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} />
        Fusionner dans «&nbsp;{ctx.current ?? "HEAD"}&nbsp;»
      </ContextMenuItem>

      <ContextMenuSeparator />
      <ContextMenuItem disabled={!r.upstream} onClick={() => ctx.onBranch("pull", r.name)}>
        <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
        Pull
      </ContextMenuItem>
      <ContextMenuItem disabled={!r.upstream} onClick={() => ctx.onBranch("push", r.name)}>
        <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
        {r.upstream ? <>Push vers «&nbsp;{r.upstream}&nbsp;»</> : "Push"}
      </ContextMenuItem>

      {flow && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => ctx.onBranch("finish", r.name)}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            {FLOW_LABEL[flow]}
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />
      {/* git refuse `-d` sur la branche sortie, mais un item qui ne peut qu'échouer n'a rien à faire là */}
      <ContextMenuItem variant="destructive" disabled={r.head} onClick={() => ctx.onBranch("delete", r.name)}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        Supprimer la branche
      </ContextMenuItem>
    </ContextMenuContent>
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
     distante ne s'allument jamais ensemble. La passe DOM (cf. RefsSidebar) lit `data-lit`
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
   serait invisible. La clé change avec lui : `defaultOpen` ne vaut qu'au montage. Un dossier
   qui abrite une ref focalisée s'ouvre par le même remontage, ciblé sur son seul chemin. */
function Tree({ node, icon, ctx, openDirs = false, forceOpen = false }: {
  node: Node; icon: IconSvgElement; ctx: Ctx; openDirs?: boolean; forceOpen?: boolean
}) {
  const dirs = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
  const leaves = [...node.leaves].sort(
    (a, b) => pinRank(a.label) - pinRank(b.label) || a.label.localeCompare(b.label)
  )
  const pinned = leaves.filter((l) => pinRank(l.label) < PINNED.length)

  const row = ({ ref, label }: Node["leaves"][number]) => (
    <RefRow key={ref.name} r={ref} label={label} icon={icon} ctx={ctx} />
  )

  return (
    <ul role="list" className="flex flex-col">
      {pinned.map(row)}
      {dirs.map((k) => {
        const child = node.dirs.get(k)!
        const dot = DOT[typeColor(k.toLowerCase())]
        const focused = ctx.focusedKeys.size > 0 && holdsFocused(child, ctx.focusedKeys)
        return (
          <li key={k}>
            <Collapsible
              key={forceOpen ? `f:${k}` : focused ? `o:${k}` : k}
              defaultOpen={forceOpen || openDirs || focused || holdsHead(child)}
            >
              <CollapsibleTrigger className="group/dir flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
                />
                {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />}
                <span className="truncate">{k}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-2 border-l pl-2">
                <Tree node={child} icon={icon} ctx={ctx} forceOpen={forceOpen} />
              </CollapsibleContent>
            </Collapsible>
          </li>
        )
      })}
      {leaves.slice(pinned.length).map(row)}
    </ul>
  )
}

export function RefsSidebar({
  api,
  open,
  refreshKey,
  flow,
  onCheckout,
  onBranch,
  onFocusRef,
  focusedKeys,
}: Pick<Ctx, "flow" | "onCheckout" | "onBranch" | "onFocusRef" | "focusedKeys"> & {
  api: RepoApi
  open: boolean
  refreshKey: string
}) {
  /* pas `useAsync` : il vide ses données à chaque clé, et l'auto-fetch ferait clignoter
     l'arbre toutes les cinq minutes. Ici l'ancien rendu tient jusqu'à la réponse. */
  const [data, setData] = useState<GitRef[] | null>(null)
  const [error, setError] = useState(false)
  const [filter, setFilter] = useState("")
  const navRef = useRef<HTMLElement>(null)

  /* filtre par sous-chaîne sur le nom complet, préfixe compris : `feat` attrape `feature/x` */
  const q = filter.trim().toLowerCase()
  const match = (r: GitRef) => !q || r.name.toLowerCase().includes(q)

  useEffect(() => {
    let stale = false
    api.refs().then(
      (r) => !stale && setData(r),
      () => !stale && setError(true)
    )
    return () => {
      stale = true
    }
    // `api` est stable pour un onglet donné : `refreshKey` porte déjà son identité.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  /* Fusionne les contours des refs allumées visuellement contiguës : on lit l'ordre DOM réel
     (les dossiers repliés sont display:none → hors flux), pas l'ordre logique de l'arbre. */
  const paint = useCallback(() => {
    const root = navRef.current
    if (!root) return
    const rows = [...root.querySelectorAll<HTMLElement>(".gg-refrow")].filter((b) => b.offsetParent)
    const lit = rows.map((b) => b.dataset.lit === "1")
    /* Deux refs ne se joignent que dans la même liste : un trigger de dossier n'est pas une `.gg-refrow`,
       donc deux branches de dossiers voisins seraient consécutives ici alors qu'un pli les sépare. */
    const list = rows.map((b) => b.closest("ul"))
    rows.forEach((b, i) => {
      if (!lit[i]) return void delete b.dataset.run
      const p = i > 0 && lit[i - 1] && list[i - 1] === list[i]
      const n = i < rows.length - 1 && lit[i + 1] && list[i + 1] === list[i]
      b.dataset.run = p && n ? "mid" : p ? "end" : n ? "start" : "solo"
    })
  }, [])

  useLayoutEffect(paint, [paint, focusedKeys, data, q]) // le filtre déplace les refs allumées
  /* Un focus posé depuis le graphe peut viser une ref hors de la fenêtre du sidebar : une fois
     les plis ouverts (remontage par clé, cf. Tree), on amène la première allumée en vue. */
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
          {!data && !error && (
            <p className="flex items-center gap-2 px-1.5 text-xs text-muted-foreground">
              <Spinner className="size-3" /> branches…
            </p>
          )}
          {data && q && !data.some(match) && (
            <p className="px-1.5 text-xs text-muted-foreground">Aucune ref ne correspond.</p>
          )}
          {data &&
            GROUPS.map((g) => {
              const refs = data.filter((r) => r.kind === g.kind && match(r))
              if (!refs.length) return null
              const focused = refs.some((r) => focusedKeys.has(refKey(r)))
              return (
                /* la clé change avec le filtre ou l'arrivée d'un focus : un groupe replié à la
                   main se rouvre pour montrer les résultats, comme les dossiers */
                <Collapsible key={`${q ? "f:" : ""}${focused ? "o:" : ""}${g.kind}`} defaultOpen>
                  <CollapsibleTrigger className="group/trigger flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.625rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
                    <HugeiconsIcon
                      icon={ArrowRight01Icon}
                      strokeWidth={2}
                      className="size-3 transition-transform group-data-[panel-open]/trigger:rotate-90 motion-reduce:transition-none"
                    />
                    {g.title}
                    <span className="ms-auto tabular-nums">{refs.length}</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-0.5">
                      <Tree node={buildTree(refs)} icon={g.icon} ctx={ctx} openDirs={g.kind === "remote"} forceOpen={!!q} />
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )
            })}
        </div>
      </div>
    </nav>
  )
}
