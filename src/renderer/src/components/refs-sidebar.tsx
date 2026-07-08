import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Archive02Icon, ArrowRight01Icon, CloudIcon, Search01Icon, Tag01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/primitives/collapsible"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/primitives/input-group"

/* ponytail: refs en dur — mockup de cadrage, à remplacer par un rendu depuis git for-each-ref */
type Ref = { name: string; lane?: number; icon?: IconSvgElement; ahead?: string; current?: boolean }
type Group = { title: string; open: boolean; refs: Ref[] }

const GROUPS: Group[] = [
  {
    title: "Branches",
    open: true,
    refs: [
      { name: "develop", lane: 0, ahead: "↑2", current: true },
      { name: "master", lane: 3 },
      { name: "feature/optim-cout", lane: 2 },
      { name: "hotfix/matrice-vide", lane: 1, ahead: "↓1" },
    ],
  },
  {
    title: "Distantes",
    open: true,
    refs: [
      { name: "origin/develop", icon: CloudIcon },
      { name: "origin/master", icon: CloudIcon },
      { name: "origin/release/4.2", icon: CloudIcon },
    ],
  },
  {
    title: "Tags",
    open: true,
    refs: [
      { name: "v4.2.0", icon: Tag01Icon },
      { name: "v4.1.3", icon: Tag01Icon },
      { name: "v4.1.2", icon: Tag01Icon },
    ],
  },
  { title: "Stashes", open: false, refs: [{ name: "stash@{0}", icon: Archive02Icon }] },
]

function RefRow({ r }: { r: Ref }) {
  return (
    <li>
      <button
        type="button"
        className={cn(
          "flex w-full items-center gap-2 rounded-md border-l-2 border-l-transparent px-1.5 py-1 text-left text-xs",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          r.current && "border-l-primary bg-primary/10 font-medium text-foreground"
        )}
      >
        {r.lane !== undefined ? (
          <span className="mx-0.75 size-1.75 shrink-0 rounded-full" style={{ background: `var(--lane-${r.lane})` }} />
        ) : (
          <HugeiconsIcon icon={r.icon!} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono">{r.name}</span>
        {r.ahead && <span className="ms-auto shrink-0 ps-1.5 tabular-nums">{r.ahead}</span>}
      </button>
    </li>
  )
}

export function RefsSidebar() {
  return (
    <nav aria-label="Références" className="flex w-59 shrink-0 min-w-0 flex-col border-r">
      <div className="flex border-b p-2.5">
        <InputGroup>
          <InputGroupAddon>
            <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
          </InputGroupAddon>
          <InputGroupInput type="search" placeholder="Filtrer les refs" />
        </InputGroup>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-auto px-2 pt-2 pb-4">
        {GROUPS.map((g) => (
          <Collapsible key={g.title} defaultOpen={g.open}>
            <CollapsibleTrigger className="group/trigger flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[0.625rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3 transition-transform group-data-[panel-open]/trigger:rotate-90 motion-reduce:transition-none"
              />
              {g.title}
              <span className="ms-auto tabular-nums">{g.refs.length}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul role="list" className="mt-0.5 flex flex-col">
                {g.refs.map((r) => (
                  <RefRow key={r.name} r={r} />
                ))}
              </ul>
            </CollapsibleContent>
          </Collapsible>
        ))}
      </div>
    </nav>
  )
}
