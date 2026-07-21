/* Worktrees sidebar section (component + query + actions colocated, same shape as
   features/stash). One row per entry of `git worktree list`, the main worktree included — but
   only once at least one linked worktree exists, since a lone main is the repo itself and has
   nothing to manage. A click jumps to its HEAD in the graph, a double-click opens it as a tab,
   the menu carries open/reveal/remove (or prune for a stale entry; the main row can neither be
   opened when current nor removed). */

import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowUpRight01Icon, CleanIcon, Delete02Icon, FolderOpenIcon, Tree07Icon } from "@hugeicons/core-free-icons"

import { worktreeName, type WorktreeAct, type WorktreeInfo } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { ScrollText } from "@/features/graph/interactions/scroll-text"
import { useRepoStore } from "@/features/repo/repo-store"
import { useWorktreesQuery } from "@/features/worktrees/worktrees-queries"
import { useAutoOpen } from "@/features/refs/refs-tree"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { RefGroup } from "@/components/ui/ref-group"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

/** Substring filter on the folder name or the checked-out branch — same grammar as the
    sidebar's branch filter, which `RefsSidebar` also needs for its "no ref matches" message. */
export const matchWorktree = (w: WorktreeInfo, q: string) =>
  !q || worktreeName(w).toLowerCase().includes(q) || !!w.branch?.toLowerCase().includes(q)

function WorktreeRow({
  w,
  onFocus,
  onOpen,
  onReveal,
  onAct,
}: {
  w: WorktreeInfo
  onFocus(w: WorktreeInfo): void
  onOpen(path: string): void
  onReveal(path: string): void
  onAct(action: WorktreeAct, path?: string): void
}) {
  const name = worktreeName(w)
  const openable = !w.current && !w.prunable
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <button
          type="button"
          onClick={() => void onFocus(w)}
          onDoubleClick={() => openable && onOpen(w.path)}
          title={w.current ? messages.worktrees.currentTab : w.path}
          className="amont-refrow flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-foreground select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
        >
          <HugeiconsIcon icon={Tree07Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          {/* a prunable entry's folder is gone: it reads as a leftover, same as a gone branch */}
          <ScrollText
            text={name}
            className={cn(
              w.current ? "font-semibold" : "font-medium",
              w.prunable && "text-muted-foreground line-through"
            )}
          />
          {w.current && <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />}
          {/* the branch column is noise when it duplicates the folder name (the common case:
              `git worktree add` names the folder after the branch) — keep it only when it adds info */}
          {w.branch !== name && (
            <span className="truncate text-muted-foreground">{w.branch ?? messages.worktrees.detached}</span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-72">
        <ContextMenuItem disabled={!openable} onClick={() => onOpen(w.path)}>
          <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} />
          {messages.worktrees.openInTab}
        </ContextMenuItem>
        <ContextMenuItem disabled={w.prunable} onClick={() => onReveal(w.path)}>
          <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
          {messages.worktrees.reveal}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {/* a stale entry (folder gone from disk) can only be pruned; a live linked worktree is
            removed — git itself refuses on dirty/locked, same policy as branch delete */}
        {w.prunable ? (
          <ContextMenuItem variant="destructive" onClick={() => onAct("prune")}>
            <HugeiconsIcon icon={CleanIcon} strokeWidth={2} />
            <MenuItemWithCmd label={messages.worktrees.prune} cmd="git worktree prune" />
          </ContextMenuItem>
        ) : (
          <ContextMenuItem variant="destructive" disabled={w.main || w.current} onClick={() => onAct("remove", w.path)}>
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            <MenuItemWithCmd label={messages.worktrees.remove} cmd={`git worktree remove ${name}`} />
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Sidebar worktrees section: renders `null` when the repo has no linked worktree (a lone main
    is the repository, not something to manage) or when nothing matches the filter. */
export function WorktreesSection({ filter }: { filter: string }) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const onFocus = useRepoStore((s) => s.focusWorktree)
  const onOpen = useRepoStore((s) => s.openWorktree)
  const onAct = useRepoStore((s) => s.runWorktree)
  const { data: worktrees = [] } = useWorktreesQuery(api, repoId)

  // the main worktree earns a row only once there is at least one linked worktree to sit beside —
  // a repo with no linked worktree has nothing to manage here, so the section stays hidden
  const hasLinked = worktrees.some((w) => !w.main)
  const matches = hasLinked ? worktrees.filter((w) => matchWorktree(w, filter)) : []
  const { open, onOpenChange } = useAutoOpen(true, !!filter)

  if (!matches.length) return null

  return (
    <RefGroup title={messages.worktrees.title} count={matches.length} open={open} onOpenChange={onOpenChange}>
      <ul role="list" className="mt-0.5 flex flex-col">
        {matches.map((w) => (
          <WorktreeRow
            key={w.path}
            w={w}
            onFocus={onFocus}
            onOpen={(path) => void onOpen(path)}
            onReveal={(path) => void api.worktreeReveal(path)}
            onAct={(action, path) => void onAct(action, path)}
          />
        ))}
      </ul>
    </RefGroup>
  )
}
