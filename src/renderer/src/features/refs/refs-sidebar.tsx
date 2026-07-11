import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { CloudIcon, GitBranchIcon, Search01Icon, Tag01Icon } from "@hugeicons/core-free-icons"

import type { GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
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
  { title: messages.refs.branches, kind: "head", icon: GitBranchIcon },
  { title: messages.refs.remotes, kind: "remote", icon: CloudIcon },
  { title: messages.refs.tags, kind: "tag", icon: Tag01Icon },
] as const satisfies readonly { title: string; kind: GitRef["kind"]; icon: IconSvgElement }[]

function RefGroupSection({
  title,
  icon,
  refs,
  ctx,
  openDirs,
  forceOpen,
}: {
  title: string
  icon: IconSvgElement
  refs: GitRef[]
  ctx: Ctx
  openDirs: boolean
  forceOpen: boolean
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

/** Store and queries rather than 10 props (AUDIT.md §5): `open`/`focusedKeys` come from the
    store, `flow`/refs/stashes from TanStack Query — no more `refreshKey` rigged up in a chain,
    the query layer's invalidations are enough to re-read the tree.

    Split into five modules (AUDIT.md §7, phase 5 — the old file was 514 lines): this
    file orchestrates the filter and assembly; refs-tree.tsx carries the tree and the ref
    row, refs-menu.tsx the branch menu, refs-focus-paint.ts the outline painting, and the
    stash section now lives in features/stash/ (a full-fledged vertical feature). */
export function RefsSidebar() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const open = useRepoStore((s) => s.ui.sidebarOpen)
  const focusedKeys = useRepoStore((s) => s.selection.focusedKeys)
  const onCheckout = useRepoStore((s) => s.checkout)
  const onBranch = useRepoStore((s) => s.runBranch)
  const onFocusRef = useRepoStore((s) => s.focusRef)

  const { data: flow = null } = useFlowQuery(api, repoId)
  /* no `stale` flag to copy over: `placeholderData: keepPreviousData` (see lib/queries.ts)
     keeps the old render displayed while a new response arrives, without the flicker
     `useAsync` (cleared on every key) would have produced every five minutes (auto-fetch). */
  const { data, isError: error } = useRefsQuery(api, repoId)
  /* only the count matters to us here ("no results" message): the list's rendering lives
     in <StashSection>, which calls the same query — TanStack Query dedupes by key. */
  const { data: stashes = [] } = useStashesQuery(api, repoId)
  const [filter, setFilter] = useState("")
  const navRef = useRef<HTMLElement>(null)

  /* substring filter on the full name, prefix included: `feat` catches `feature/x` */
  const q = filter.trim().toLowerCase()
  const match = (r: GitRef) => !q || r.name.toLowerCase().includes(q)

  const paint = useCallback(() => paintFocusRuns(navRef.current), [])

  useLayoutEffect(paint, [paint, focusedKeys, data, q]) // the filter moves the lit refs around
  /* A focus set from the graph may target a ref outside the sidebar's viewport: once
     the folds are open (see refs-tree.tsx), we bring the first lit ref into view. */
  useEffect(() => {
    if (!focusedKeys.size) return
    navRef.current?.querySelector(".amont-refrow[data-lit]")?.scrollIntoView({ block: "nearest" })
  }, [focusedKeys])
  /* Collapsing/expanding a folder doesn't rerender the sidebar (Collapsible's internal state):
     we repaint after every click in the nav, once the DOM has settled. */
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
    /* collapsed = zero width, not unmounted: the content keeps its width and gets clipped,
       otherwise the fields and labels would squeeze together during the animation. */
    <nav
      ref={navRef}
      data-amont-keep-focus
      aria-label={messages.refs.branches}
      inert={!open}
      className={cn(
        /* min-w-0: without it, the flex item's automatic minimum locks onto the content (236px) */
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
              placeholder={messages.refs.filterBranches}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && filter && (e.stopPropagation(), setFilter(""))}
            />
          </InputGroup>
        </div>

        <div className="flex flex-1 flex-col gap-1.5 overflow-auto px-2 pt-2 pb-4">
          {error && <p className="px-1.5 text-xs text-muted-foreground">{messages.refs.branchesUnavailable}</p>}
          {!data && !error && <AsyncHint className="px-1.5">{messages.refs.loadingBranches}</AsyncHint>}
          {data && q && !data.some(match) && !stashes.some((s) => matchStash(s, q)) && (
            <p className="px-1.5 text-xs text-muted-foreground">{messages.refs.noMatchingRef}</p>
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
