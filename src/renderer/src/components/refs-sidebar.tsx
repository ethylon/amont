import { useEffect, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  CloudIcon,
  GitBranchIcon,
  GitMergeIcon,
  Search01Icon,
  Tag01Icon,
} from "@hugeicons/core-free-icons"

import type { GitRef, RepoApi } from "@/lib/git"
import { typeColor, type BadgeColor } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Tip } from "@/components/ui/tip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/primitives/collapsible"
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
}

/** Les branches d'intégration passent devant, dans cet ordre. */
const PINNED = ["master", "main", "develop"]
const pinRank = (label: string) => {
  const i = PINNED.indexOf(label)
  return i < 0 ? PINNED.length : i
}

/* Les segments de `feature/optim-cout` deviennent des dossiers ; la feuille porte la ref. */
type Node = { dirs: Map<string, Node>; leaves: { ref: GitRef; label: string }[] }
type RowProps = { onCheckout(name: string): void }

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

const track = (r: GitRef) =>
  [r.ahead && `↑${r.ahead}`, r.behind && `↓${r.behind}`].filter(Boolean).join(" ")

function RefRow({ r, label, icon, onCheckout }: RowProps & { r: GitRef; label: string; icon: IconSvgElement }) {
  const t = track(r)
  /* seules les branches locales se checkout au double-clic ; une distante ou un tag
     détacheraient HEAD, ce qui ne s'annule pas d'un double-clic. */
  const switchable = r.kind === "head" && !r.head
  const notes = [
    r.merged && "fusionnée",
    r.gone && "absente de la distante",
    switchable && "double-clic pour basculer",
  ].filter(Boolean)
  return (
    <li>
      <Tip text={[r.name, ...notes].join(" — ")} side="right">
        <button
          type="button"
          onDoubleClick={switchable ? () => onCheckout(r.name) : undefined}
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs select-none",
            "text-foreground hover:bg-muted",
            /* surélévation : la surface tient au-dessus de son ombre, et le survol la repose */
            r.head && "bg-primary/20 shadow-xs shadow-primary/25 hover:bg-primary/25 hover:shadow-none"
          )}
        >
          <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          {/* une branche que la distante ignore n'est plus une destination : elle se lit comme un reliquat */}
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
      </Tip>
    </li>
  )
}

function Tree({ node, icon, onCheckout }: RowProps & { node: Node; icon: IconSvgElement }) {
  const dirs = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
  const leaves = [...node.leaves].sort(
    (a, b) => pinRank(a.label) - pinRank(b.label) || a.label.localeCompare(b.label)
  )
  const pinned = leaves.filter((l) => pinRank(l.label) < PINNED.length)

  const row = ({ ref, label }: Node["leaves"][number]) => (
    <RefRow key={ref.name} r={ref} label={label} icon={icon} onCheckout={onCheckout} />
  )

  return (
    <ul role="list" className="flex flex-col">
      {pinned.map(row)}
      {dirs.map((k) => {
        const child = node.dirs.get(k)!
        const dot = DOT[typeColor(k.toLowerCase())]
        return (
          <li key={k}>
            <Collapsible defaultOpen={holdsHead(child)}>
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
                <Tree node={child} icon={icon} onCheckout={onCheckout} />
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
  onCheckout,
}: RowProps & { api: RepoApi; open: boolean; refreshKey: string }) {
  /* pas `useAsync` : il vide ses données à chaque clé, et l'auto-fetch ferait clignoter
     l'arbre toutes les cinq minutes. Ici l'ancien rendu tient jusqu'à la réponse. */
  const [data, setData] = useState<GitRef[] | null>(null)
  const [error, setError] = useState(false)

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

  return (
    /* replié = largeur nulle, pas démonté : le contenu garde sa largeur et se fait rogner,
       sinon les champs et les libellés se tasseraient pendant l'animation. */
    <nav
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
            <InputGroupInput type="search" placeholder="Filtrer les branches" />
          </InputGroup>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 overflow-auto px-2 pt-2 pb-4">
          {error && <p className="px-1.5 text-xs text-muted-foreground">Branches indisponibles.</p>}
          {!data && !error && (
            <p className="flex items-center gap-2 px-1.5 text-xs text-muted-foreground">
              <Spinner className="size-3" /> branches…
            </p>
          )}
          {data &&
            GROUPS.map((g) => {
              const refs = data.filter((r) => r.kind === g.kind)
              if (!refs.length) return null
              return (
                <Collapsible key={g.kind} defaultOpen>
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
                      <Tree node={buildTree(refs)} icon={g.icon} onCheckout={onCheckout} />
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
