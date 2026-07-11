/* Refs tree (AUDIT.md §7, phase 5): one of the five concerns of the old
   refs-sidebar.tsx (514 lines) — building the tree by name segments, sorting (integration
   branches first), and the ref row itself (menu included). See refs-menu.tsx for
   the context menu content and refs-focus-paint.ts for the outline painting. */

import { useEffect, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { ArrowRight01Icon, GitBranchIcon, GitMergeIcon } from "@hugeicons/core-free-icons"

import type { BranchAct, FlowPrefixes, GitRef } from "@/lib/git"
import { typeColor } from "@/lib/commit-parse"
import { PINNED, pinRank } from "@/lib/gitflow"
import { buildPathTree, type PathTree } from "@/lib/path-tree"
import type { BadgeColor } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { BranchMenu } from "@/features/refs/refs-menu"

type RowProps = { onCheckout(name: string): void }
/* the context a branch's menu needs to know, passed down as-is at every level
   of the tree: four props threading through three components wouldn't say anything more. */
export type Ctx = RowProps & {
  /** current branch, `null` on detached HEAD */
  current: string | null
  flow: FlowPrefixes | null
  onBranch(action: BranchAct, name: string): void
  /** focused refs, `kind:name` — the clicked identities, or branches derived from commits */
  focusedKeys: Set<string>
  /** focuses the ref in the graph: scroll to the tip and select the whole branch.
      Ctrl (`additive`) adds or removes; the focus clears on a click in empty space */
  onFocusRef(r: GitRef, additive: boolean): void
}

/** identity of a ref, shared with RepoView: local `master` and `origin/master` coexist */
export const refKey = (r: GitRef) => `${r.kind}:${r.name}`

/* A branch prefix carries the same semantics as a commit's type badge:
   `feature/…` is green like `feat:`, `hotfix/…` red like `[HOTFIX]`. An unknown
   prefix (`origin`, `ui`) has no tint: no dot. */
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

/** Under the root, everything is collapsed on first render except the path leading to HEAD. */
const holdsHead = (n: PathTree<GitRef>): boolean => n.items.some((r) => r.head) || [...n.dirs.values()].some(holdsHead)

/** a fold hiding a focused ref must open: focus set from the graph should be visible */
const holdsFocused = (n: PathTree<GitRef>, keys: Set<string>): boolean =>
  n.items.some((r) => keys.has(refKey(r))) || [...n.dirs.values()].some((d) => holdsFocused(d, keys))

const track = (r: GitRef) => [r.ahead && `↑${r.ahead}`, r.behind && `↓${r.behind}`].filter(Boolean).join(" ")

/** Replaces the remount-by-key pattern (3 variants in the old monolithic refs-sidebar.tsx) with a
    controlled Collapsible: the open state is React state, reset to `defaultOpen` every
    time a reset dependency changes (a focus set from the graph, a filter starting/stopping)
    — exactly the effect of remount-by-key, without unmounting/remounting the
    subtree. Between two resets, the user stays in control: a click on the trigger persists
    until the next reset. */
export function useResettableOpen(defaultOpen: boolean, ...resetDeps: unknown[]) {
  const [open, setOpen] = useState(defaultOpen)
  useEffect(() => setOpen(defaultOpen), resetDeps) // eslint-disable-line react-hooks/exhaustive-deps
  return { open, onOpenChange: setOpen }
}

function RefDir({
  label,
  node,
  icon,
  ctx,
  openDirs,
  forceOpen,
}: {
  label: string
  node: PathTree<GitRef>
  icon: IconSvgElement
  ctx: Ctx
  openDirs: boolean
  forceOpen: boolean
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
  /* a tag checks out to a detached HEAD, which a double-click can't undo.
     A remote switches to its tracking local branch (git checkout <name>'s DWIM). */
  const switchable = (r.kind === "head" && !r.head) || r.kind === "remote"
  /* Strips the first segment (assumed to be the remote name); git itself refuses the checkout if
     the resulting name is ambiguous across remotes. */
  const target = r.kind === "remote" ? r.name.split("/").slice(1).join("/") : r.name

  /* "lit" = this ref is focused — by identity, `kind` included: the local branch and its
     remote never light up together. The DOM pass (see refs-focus-paint.ts) reads `data-lit`
     to draw the outline and merge contiguous runs. */
  const lit = ctx.focusedKeys.has(refKey(r))
  const row = (
    <button
      type="button"
      data-lit={lit ? "1" : undefined}
      onClick={(e) => ctx.onFocusRef(r, e.ctrlKey || e.metaKey)}
      onDoubleClick={switchable ? () => ctx.onCheckout(target) : undefined}
      className={cn(
        "amont-refrow flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-xs select-none",
        "text-foreground hover:bg-muted -my-px",
        r.head && "bg-primary/30 hover:bg-primary/45"
      )}
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
      {/* a branch whose remote has vanished is no longer a destination: it reads as a leftover */}
      <span className={cn("truncate font-medium", r.gone && "text-muted-foreground line-through")}>{label}</span>
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

  /* the trigger carries the `li`: right-click takes the whole row, not just the button */
  if (r.kind === "head")
    return (
      <ContextMenu>
        <ContextMenuTrigger render={<li />}>{row}</ContextMenuTrigger>
        <BranchMenu r={r} ctx={ctx} />
      </ContextMenu>
    )

  /* Remote/tag (AUDIT.md §8): no full BranchMenu (merge/pull/push/flow don't make
     sense outside a local branch), but the checkout — today double-click-only for
     remotes, absent for tags — must stay reachable from the keyboard (context menu,
     also openable via Shift+F10/Menu key on the focused row). */
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>{row}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => ctx.onCheckout(target)}>
          <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} />
          <MenuItemWithCmd label="Checkout" cmd={`git checkout ${target}`} />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* `openDirs`: opens the folders at this single level (the recursion resets to false). Used for
   remotes, where the remote (`origin`) would otherwise stay collapsed for lack of a HEAD inside.
   `forceOpen`: everything open, at every level — a filter result hidden in a fold
   would be invisible. A folder holding a focused ref opens through the same mechanism,
   targeted to its single path (see `useResettableOpen` in RefDir). */
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
        <RefDir
          key={k}
          label={k}
          node={node.dirs.get(k)!}
          icon={icon}
          ctx={ctx}
          openDirs={openDirs}
          forceOpen={forceOpen}
        />
      ))}
      {leaves.slice(pinned.length).map(row)}
    </ul>
  )
}
