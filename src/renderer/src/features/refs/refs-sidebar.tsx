import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { CloudIcon, GitBranchIcon, Search01Icon, Tag01Icon } from "@hugeicons/core-free-icons"

import type { GitRef } from "@/lib/git"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import type { PathTree } from "@/lib/path-tree"
import { useFlowQuery } from "@/features/flow/flow-queries"
import { FlowShortcut } from "@/features/flow/flow-shortcut"
import { useRefsQuery } from "@/features/refs/refs-queries"
import { useStashesQuery } from "@/features/stash/stash-queries"
import { matchStash, StashSection } from "@/features/stash/stash-section"
import { useWorktreesQuery } from "@/features/worktrees/worktrees-queries"
import { matchWorktree, WorktreesSection } from "@/features/worktrees/worktrees-section"
import { useRepoStore } from "@/features/repo/repo-store"
import { buildTree, refKey, Tree, useResettableOpen, type Ctx } from "@/features/refs/refs-tree"
import { DeleteBranchDialog } from "@/features/refs/delete-branch-dialog"
import { paintFocusRuns } from "@/features/refs/refs-focus-paint"
import { AsyncHint } from "@/components/ui/async-hint"
import { RefGroup } from "@/components/ui/ref-group"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"

/* `title` is a thunk: messages.* getters run `t`, which must not execute at module scope
   (before setupI18n() activates the locale — throws in dev). */
const GROUPS = {
  head: { title: () => messages.refs.branches, icon: GitBranchIcon },
  remote: { title: () => messages.refs.remotes, icon: CloudIcon },
  tag: { title: () => messages.refs.tags, icon: Tag01Icon },
} as const satisfies Record<GitRef["kind"], { title: () => string; icon: IconSvgElement }>

/* memo: per-click renders of the sidebar (focus moved) reuse the section when neither its
   prebuilt tree nor the ctx changed; `focusedKeys` travels inside ctx, so a focus change
   still reaches every section. */
const RefGroupSection = memo(function RefGroupSection({
  title,
  icon,
  refs,
  tree,
  ctx,
  openDirs,
  forceOpen,
}: {
  title: string
  icon: IconSvgElement
  refs: GitRef[]
  tree: PathTree<GitRef>
  ctx: Ctx
  openDirs: boolean
  forceOpen: boolean
}) {
  /* memo'd component: re-render on a runtime language switch even when no prop moved */
  useLocale()
  const focused = useMemo(() => refs.some((r) => ctx.focusedKeys.has(refKey(r))), [refs, ctx.focusedKeys])
  const { open, onOpenChange } = useResettableOpen(true, forceOpen, focused)

  return (
    <RefGroup title={title} count={refs.length} open={open} onOpenChange={onOpenChange}>
      <div className="mt-0.5">
        <Tree node={tree} icon={icon} ctx={ctx} openDirs={openDirs} forceOpen={forceOpen} />
      </div>
    </RefGroup>
  )
})

/** Store and queries rather than 10 props (AUDIT.md §5): `open`/`focusedKeys` come from the
    store, `flow`/refs/stashes from TanStack Query — no more `refreshKey` rigged up in a chain,
    the query layer's invalidations are enough to re-read the tree.

    Split into five modules (AUDIT.md §7, phase 5 — the old file was 514 lines): this
    file orchestrates the filter and assembly; refs-tree.tsx carries the tree and the ref
    row, refs-menu.tsx the branch menu, refs-focus-paint.ts the selection-run painting, and the
    stash section now lives in features/stash/ (a full-fledged vertical feature). */
export const RefsSidebar = memo(function RefsSidebar() {
  /* memo'd (propless) component: subscribe to the locale so a runtime language switch,
     which no longer cascades through the memoized tab, still re-renders the sidebar */
  useLocale()
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const open = useRepoStore((s) => s.ui.sidebarOpen)
  const focusedKeys = useRepoStore((s) => s.selection.focusedKeys)
  const onCheckout = useRepoStore((s) => s.checkout)
  const onBranch = useRepoStore((s) => s.runBranch)
  const runDeleteBranch = useRepoStore((s) => s.deleteBranch)
  const onFocusRef = useRepoStore((s) => s.focusRef)
  const onAddWorktree = useRepoStore((s) => s.addWorktree)

  /* pending branch deletion, held until the confirmation dialog resolves it (mirrors the
     discard dialog's local-state pattern) */
  const [deleteTarget, setDeleteTarget] = useState<GitRef | null>(null)

  const { data: flow = null } = useFlowQuery(api, repoId)
  /* no `stale` flag to copy over: `placeholderData: keepPreviousData` (see lib/queries.ts)
     keeps the old render displayed while a new response arrives, without the flicker
     `useAsync` (cleared on every key) would have produced every five minutes (auto-fetch). */
  const { data, isError: error } = useRefsQuery(api, repoId)
  /* only the count matters to us here ("no results" message): the list's rendering lives
     in <StashSection>/<WorktreesSection>, which call the same queries — TanStack Query
     dedupes by key. */
  const { data: stashes = [] } = useStashesQuery(api, repoId)
  const { data: worktrees = [] } = useWorktreesQuery(api, repoId)
  const [filter, setFilter] = useState("")
  const navRef = useRef<HTMLElement>(null)

  /* substring filter on the full name, prefix included: `feat` catches `feature/x`.
     The input stays controlled on `filter` (immediate echo); the tree below filters and
     force-expands on the deferred value, so a keystroke never waits for the rebuild
     (perf audit, finding 14). */
  const q = useDeferredValue(filter.trim().toLowerCase())

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

  const worktreeBranches = useMemo(() => new Set(worktrees.flatMap((w) => (w.branch ? [w.branch] : []))), [worktrees])
  const current = useMemo(() => data?.find((r) => r.head)?.name ?? null, [data])
  const onAddWorktreeCb = useCallback((name: string) => void onAddWorktree(name), [onAddWorktree])
  /* one object, memoized: a stable ctx is what lets the sections and rows below skip —
     it only changes when the focus, the flow config or the refs themselves do */
  const ctx = useMemo<Ctx>(
    () => ({
      current,
      flow,
      onCheckout,
      onBranch,
      onDeleteBranch: setDeleteTarget,
      focusedKeys,
      onFocusRef,
      worktreeBranches,
      onAddWorktree: onAddWorktreeCb,
    }),
    [current, flow, onCheckout, onBranch, focusedKeys, onFocusRef, worktreeBranches, onAddWorktreeCb]
  )

  /* Filter + tree build memoized on [data, q] (perf audit, finding 4b): they don't depend
     on the selection, so a commit click repaints the lit rows without re-filtering or
     rebuilding a single group. */
  const groups = useMemo(() => {
    if (!data) return null
    const mk = (kind: GitRef["kind"]) => {
      const refs = data.filter((r) => r.kind === kind && (!q || r.name.toLowerCase().includes(q)))
      return refs.length ? { refs, tree: buildTree(refs) } : null
    }
    return { head: mk("head"), remote: mk("remote"), tag: mk("tag") }
  }, [data, q])

  const group = (kind: GitRef["kind"]) => {
    const g = groups?.[kind]
    if (!g) return null
    const meta = GROUPS[kind]
    return (
      <RefGroupSection
        key={kind}
        title={meta.title()}
        icon={meta.icon}
        refs={g.refs}
        tree={g.tree}
        ctx={ctx}
        openDirs={kind === "remote"}
        forceOpen={!!q}
      />
    )
  }

  return (
    <>
      {/* collapsed = zero width, not unmounted: the content keeps its width and gets clipped,
          otherwise the fields and labels would squeeze together during the animation. */}
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
            {/* the promoted gitflow move — a shortcut, not a ref: it steps aside while filtering */}
            {!q && <FlowShortcut />}
            {error && <p className="px-1.5 text-xs text-muted-foreground">{messages.refs.branchesUnavailable}</p>}
            {!data && !error && <AsyncHint className="px-1.5">{messages.refs.loadingBranches}</AsyncHint>}
            {groups &&
              q &&
              !groups.head &&
              !groups.remote &&
              !groups.tag &&
              !stashes.some((s) => matchStash(s, q)) &&
              !worktrees.some((w) => !w.main && matchWorktree(w, q)) && (
                <p className="px-1.5 text-xs text-muted-foreground">{messages.refs.noMatchingRef}</p>
              )}
            {/* local branches, remotes, worktrees, tags, stashes — worktrees sit with the
              branch groups (they anchor checkouts), tags and stashes close the list */}
            {group("head")}
            {group("remote")}
            <WorktreesSection filter={q} />
            {group("tag")}
            <StashSection filter={q} />
          </div>
        </div>
      </nav>

      {deleteTarget && (
        <DeleteBranchDialog
          branch={deleteTarget}
          onConfirm={(deleteRemote) => void runDeleteBranch(deleteTarget.name, deleteRemote)}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </>
  )
})
