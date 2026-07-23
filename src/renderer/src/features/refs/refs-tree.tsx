/* Refs tree (AUDIT.md §7, phase 5): one of the five concerns of the old
   refs-sidebar.tsx (514 lines) — building the tree by name segments, sorting (integration
   branches first), and the ref row itself (menu included). See refs-menu.tsx for
   the context menu content and refs-focus-paint.ts for the selection-run painting. */

import { createContext, memo, useContext, useEffect, useMemo, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { ArrowRight01Icon, Delete02Icon, GitBranchIcon, GitMergeIcon } from "@hugeicons/core-free-icons"

import type { BranchAct, FlowPrefixes, GitRef } from "@/lib/git"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { typeColor } from "@/lib/commit-parse"
import { PINNED, pinRank } from "@/lib/gitflow"
import { buildPathTree, type PathTree } from "@/lib/path-tree"
import type { BadgeColor } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { ScrollText } from "@/features/graph/interactions/scroll-text"
import { BranchMenu, SelectionMenu } from "@/features/refs/refs-menu"

type RowProps = { onCheckout(name: string): void }
/* the context a branch's menu needs to know — the single object the sidebar memoizes
   (see refs-sidebar), provided once at the tree root instead of threading through
   every level of the recursion. */
export type Ctx = RowProps & {
  /** current branch, `null` on detached HEAD */
  current: string | null
  flow: FlowPrefixes | null
  onBranch(action: BranchAct, name: string): void
  /** opens the delete-branch confirmation for `r` (local delete + optional remote) */
  onDeleteBranch(r: GitRef): void
  /** opens the delete confirmation for a remote-tracking ref (`git push <remote> --delete`) */
  onDeleteRemoteBranch(r: GitRef): void
  /** opens the delete confirmation for a tag (local delete + optional remote) */
  onDeleteTag(r: GitRef): void
  /** focused refs, `kind:name` — the clicked identities, or branches derived from commits */
  focusedKeys: Set<string>
  /** focuses the ref in the graph: scroll to the tip and select the whole branch.
      Ctrl (`additive`) adds or removes; the focus clears on a click in empty space */
  onFocusRef(r: GitRef, additive: boolean): void
  /** branches already checked out in a worktree: git refuses a second checkout of the same
      branch, so "Create worktree" is disabled for them */
  worktreeBranches: Set<string>
  onAddWorktree(name: string): void
  /** focused local branches, in click order — ≥ 2 swaps a lit row's menu for SelectionMenu */
  selection: string[]
  /** opens the "create a release" modal seeded with the selection (its order = merge order) */
  onCreateRelease(branches: string[]): void
  /** arms the merge queue on the current branch with the selection */
  onMergeSelection(branches: string[]): void
  onClearFocus(): void
}

/* Dirs and rows read the ctx here; `Tree` wraps every root in the provider, so the
   null default never reaches a consumer. The value is the sidebar's memoized object:
   it only changes when the focus, the flow config or the refs themselves do, so
   providing it is exactly as memo-friendly as passing it by prop was. */
const CtxContext = createContext<Ctx | null>(null)
const useCtx = () => useContext(CtxContext)!

/** identity of a ref, shared with RepoView: local `master` and `origin/master` coexist */
export const refKey = (r: GitRef) => `${r.kind}:${r.name}`

/* A branch prefix carries the same semantics as a commit's type badge:
   `feature/…` is green like `feat:`, `hotfix/…` red like `[HOTFIX]`. An unknown
   prefix (`origin`, `ui`) has no tint: no dot. */
const DOT: Partial<Record<BadgeColor, string>> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  perf: "bg-perf",
  danger: "bg-destructive",
  revert: "bg-revert",
  release: "bg-release",
  info: "bg-info",
  refactor: "bg-refactor",
  polish: "bg-polish",
  beta: "bg-beta",
  wip: "bg-wip",
  plugin: "bg-plugin",
  chore: "bg-chore",
  docs: "bg-docs",
  style: "bg-style",
  ci: "bg-ci",
  build: "bg-build",
}

export const buildTree = (refs: GitRef[]) => buildPathTree(refs, (r) => r.name)

/** Under the root, everything is collapsed on first render except the path leading to HEAD. */
const holdsHead = (n: PathTree<GitRef>): boolean => n.items.some((r) => r.head) || [...n.dirs.values()].some(holdsHead)

/** a fold hiding a focused ref must open: focus set from the graph should be visible */
const holdsFocused = (n: PathTree<GitRef>, keys: Set<string>): boolean =>
  n.items.some((r) => keys.has(refKey(r))) || [...n.dirs.values()].some((d) => holdsFocused(d, keys))

const track = (r: GitRef) => [r.ahead && `↑${r.ahead}`, r.behind && `↓${r.behind}`].filter(Boolean).join(" ")

/** Controlled Collapsible with one-way auto-open: whenever an open dependency changes
    (a focus set from the graph, a filter starting) and `shouldOpen` is true, the node
    opens itself. Code never closes a node — once open, it stays open until the user
    explicitly closes it via the trigger. */
export function useAutoOpen(shouldOpen: boolean, ...openDeps: unknown[]) {
  const [open, setOpen] = useState(shouldOpen)
  useEffect(() => {
    if (shouldOpen) setOpen(true)
  }, openDeps) // eslint-disable-line react-hooks/exhaustive-deps
  return { open, onOpenChange: setOpen }
}

const RefDir = memo(function RefDir({
  label,
  node,
  icon,
  openDirs,
  forceOpen,
}: {
  label: string
  node: PathTree<GitRef>
  icon: IconSvgElement
  openDirs: boolean
  forceOpen: boolean
}) {
  const ctx = useCtx()
  const dot = DOT[typeColor(label.toLowerCase())]
  /* memoized subtree scans (perf audit, finding 4b): `node` is stable (the tree is built
     once per [data, filter] in the sidebar) and `focusedKeys` is reference-stable while the
     focus doesn't move (repo-store), so repaint-only renders skip both recursions. */
  const focused = useMemo(
    () => ctx.focusedKeys.size > 0 && holdsFocused(node, ctx.focusedKeys),
    [node, ctx.focusedKeys]
  )
  const hasHead = useMemo(() => holdsHead(node), [node])
  const { open, onOpenChange } = useAutoOpen(forceOpen || openDirs || focused || hasHead, forceOpen, focused)

  return (
    <li>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className="group/dir flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            strokeWidth={2}
            className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
          />
          {dot && <span className={cn("size-1.5 shrink-0 rounded-full", dot)} />}
          <span className="truncate">{label}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="ml-2 border-l pl-2">
          <TreeLevel node={node} icon={icon} forceOpen={forceOpen} />
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
})

const RefRow = memo(function RefRow({ r, label, icon }: { r: GitRef; label: string; icon: IconSvgElement }) {
  const ctx = useCtx()
  /* memo'd component with localized descendants (the branch/checkout context menus):
     re-render on a runtime language switch even when no prop moved */
  useLocale()
  const t = track(r)
  /* a tag checks out to a detached HEAD, which a double-click can't undo.
     A remote switches to its tracking local branch (git checkout <name>'s DWIM). */
  const switchable = (r.kind === "head" && !r.head) || r.kind === "remote"
  /* Strips the first segment (assumed to be the remote name); git itself refuses the checkout if
     the resulting name is ambiguous across remotes. */
  const target = r.kind === "remote" ? r.name.split("/").slice(1).join("/") : r.name

  /* "lit" = this ref is focused — by identity, `kind` included: the local branch and its
     remote never light up together. Selection is a quiet tinted fill alone (no rail or
     border), the same treatment as the file tree. Contiguous lit refs still merge into one
     block: the DOM pass (see refs-focus-paint.ts) reads `data-lit` and squares the corners
     between neighbors (app.css) so the fill reads as a single surface, not a stack of pills. */
  const lit = ctx.focusedKeys.has(refKey(r))
  const row = (
    <button
      type="button"
      data-lit={lit ? "1" : undefined}
      onClick={(e) => ctx.onFocusRef(r, e.ctrlKey || e.metaKey)}
      onDoubleClick={switchable ? () => ctx.onCheckout(target) : undefined}
      className={cn(
        "amont-refrow flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs select-none",
        /* offscreen rows skip layout/paint (perf audit, finding 13); ~24px = py-1 + text-xs line.
           On the button itself, not the li: the focus-paint pass reads the buttons' offsetParent. */
        "[content-visibility:auto] [contain-intrinsic-size:auto_1.5rem]",
        "text-foreground hover:bg-muted/60",
        "focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
        "data-lit:bg-primary/15 data-lit:hover:bg-primary/20"
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
      {/* a branch whose remote has vanished is no longer a destination: it reads as a leftover */}
      <ScrollText
        text={label}
        className={cn(r.head ? "font-semibold" : "font-medium", r.gone && "text-muted-foreground line-through")}
      />
      {/* HEAD is an identity, not a state: a marker (weight + dot), so the primary fill
          keeps a single meaning in the sidebar — selected. */}
      {r.head && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
      {/* badge, not bare text: at the end of a line, a bare number reads like the group's
          ref counter. h-4 so the row keeps the height of branches without tracking. */}
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

  /* the trigger carries the `li`: right-click takes the whole row, not just the button.
     A lit row inside a multi-selection opens the selection's menu (release, batch merge)
     instead of its own — right-clicking an unlit branch keeps the per-branch menu. */
  if (r.kind === "head")
    return (
      <ContextMenu>
        <ContextMenuTrigger render={<li />}>{row}</ContextMenuTrigger>
        {lit && ctx.selection.length >= 2 ? <SelectionMenu ctx={ctx} /> : <BranchMenu r={r} ctx={ctx} />}
      </ContextMenu>
    )

  /* Remote/tag (AUDIT.md §8): no full BranchMenu (merge/pull/push/flow don't make
     sense outside a local branch), but the checkout — today double-click-only for
     remotes, absent for tags — must stay reachable from the keyboard (context menu,
     also openable via Shift+F10/Menu key on the focused row). Deletion follows the
     BranchMenu policy: the destructive click opens a confirmation, never deletes outright. */
  const [remote, ...rest] = r.name.split("/")
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>{row}</ContextMenuTrigger>
      <ContextMenuContent className="max-w-72">
        <ContextMenuItem onClick={() => ctx.onCheckout(target)}>
          <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} />
          <MenuItemWithCmd label={messages.refs.checkout} cmd={`git checkout ${target}`} />
        </ContextMenuItem>
        <ContextMenuSeparator />
        {r.kind === "remote" ? (
          <ContextMenuItem variant="destructive" onClick={() => ctx.onDeleteRemoteBranch(r)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            <MenuItemWithCmd
              label={messages.refs.deleteRemoteBranch}
              cmd={`git push ${remote} --delete ${rest.join("/")}`}
            />
          </ContextMenuItem>
        ) : (
          <ContextMenuItem variant="destructive" onClick={() => ctx.onDeleteTag(r)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            <MenuItemWithCmd label={messages.refs.deleteTag} cmd={`git tag -d ${r.name}`} />
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
})

/* `openDirs`: opens the folders at this single level (the recursion resets to false). Used for
   remotes, where the remote (`origin`) would otherwise stay collapsed for lack of a HEAD inside.
   `forceOpen`: everything open, at every level — a filter result hidden in a fold
   would be invisible. A folder holding a focused ref opens through the same mechanism,
   targeted to its single path (see `useAutoOpen` in RefDir). */
export function Tree({
  node,
  icon,
  ctx,
  openDirs = false,
  forceOpen = false,
}: {
  node: PathTree<GitRef>
  icon: IconSvgElement
  ctx: Ctx
  openDirs?: boolean
  forceOpen?: boolean
}) {
  return (
    <CtxContext.Provider value={ctx}>
      <TreeLevel node={node} icon={icon} openDirs={openDirs} forceOpen={forceOpen} />
    </CtxContext.Provider>
  )
}

function TreeLevel({
  node,
  icon,
  openDirs = false,
  forceOpen = false,
}: {
  node: PathTree<GitRef>
  icon: IconSvgElement
  openDirs?: boolean
  forceOpen?: boolean
}) {
  /* Sorting memoized on the node (perf audit, finding 4b): the tree is rebuilt only when
     [data, filter] change (see refs-sidebar), so per-click re-renders (focus moved) reuse
     the sorted order instead of re-running the recursive `localeCompare`/`pinRank` sorts. */
  const { dirs, pinned, rest } = useMemo(() => {
    const dirs = [...node.dirs.keys()].sort((a, b) => a.localeCompare(b))
    const leaves = [...node.items].sort(
      (a, b) => pinRank(a.name.split("/").pop()!) - pinRank(b.name.split("/").pop()!) || a.name.localeCompare(b.name)
    )
    const pinned = leaves.filter((r) => pinRank(r.name.split("/").pop()!) < PINNED.length)
    return { dirs, pinned, rest: leaves.slice(pinned.length) }
  }, [node])
  const label = (r: GitRef) => r.name.split("/").pop()!

  const row = (r: GitRef) => <RefRow key={r.name} r={r} label={label(r)} icon={icon} />

  return (
    <ul role="list" className="flex flex-col">
      {pinned.map(row)}
      {dirs.map((k) => (
        <RefDir key={k} label={k} node={node.dirs.get(k)!} icon={icon} openDirs={openDirs} forceOpen={forceOpen} />
      ))}
      {rest.map(row)}
    </ul>
  )
}
