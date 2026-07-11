/* Stash feature (AUDIT.md §7, phase 5): component + query (stash-queries.ts) + actions (the
   store), colocated — the reference "copy-me" folder. Previously spread across
   refs-sidebar (tree + menu), detail-panel (no ref, just the click in the graph), repo-view
   (callbacks), and the graph engine (foldStashes): this feature only gathers the "list of
   stashes in the side panel" part — foldStashes stays in the graph engine (layout/collapse.ts),
   which consumes it for layout, not for rendering the list. */

import { HugeiconsIcon } from "@hugeicons/react"
import { Archive02Icon, ArchiveArrowUpIcon, ArchiveRestoreIcon, Delete02Icon } from "@hugeicons/core-free-icons"

import type { Stash, StashAct } from "@/lib/git"
import { messages } from "@/lib/messages"
import { useRepoStore } from "@/features/repo/repo-store"
import { useStashesQuery } from "@/features/stash/stash-queries"
import { useResettableOpen } from "@/features/refs/refs-tree"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { RefGroup } from "@/components/ui/ref-group"
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu"

/** Substring filter on the entry's name or the WIP message — same grammar as the
    sidebar's branch filter, which `RefsSidebar` also needs for its "no ref
    matches" message (it needs to know whether the stash itself has a result). */
export const matchStash = (s: Stash, q: string) => !q || s.name.includes(q) || s.s.toLowerCase().includes(q)

/* A stash entry is not a ref: no tree, no checkout, no branch focus.
   A click jumps to its graph node; the menu carries the three stash actions. */
function StashRow({ s, onFocus, onStash }: {
  s: Stash
  onFocus(s: Stash): void
  onStash(action: StashAct, name: string): void
}) {
  /* "WIP on develop: 1a2b3c4 subject" → the preamble repeats the name: we only keep the rest */
  const msg = s.s.replace(/^(?:WIP on|On) [^:]+:\s*/, "")
  return (
    <ContextMenu>
      <ContextMenuTrigger render={<li />}>
        <button
          type="button"
          onClick={() => onFocus(s)}
          title={`${s.name} · ${s.s}`}
          className="amont-refrow -my-px flex w-full items-center gap-2 rounded-md border border-transparent px-1.5 py-1 text-left text-xs text-foreground select-none hover:bg-muted"
        >
          <HugeiconsIcon icon={Archive02Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="shrink-0 font-medium">{s.name}</span>
          <span className="truncate text-muted-foreground">{msg}</span>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="max-w-72">
        <ContextMenuItem onClick={() => onStash("apply", s.name)}>
          <HugeiconsIcon icon={ArchiveArrowUpIcon} strokeWidth={2} />
          <MenuItemWithCmd label={messages.stash.apply} cmd={`git stash apply ${s.name}`} />
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onStash("pop", s.name)}>
          <HugeiconsIcon icon={ArchiveRestoreIcon} strokeWidth={2} />
          <MenuItemWithCmd label={messages.stash.applyAndDrop} cmd={`git stash pop ${s.name}`} />
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => onStash("drop", s.name)}>
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
          <MenuItemWithCmd label={messages.stash.drop} cmd={`git stash drop ${s.name}`} />
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Sidebar stash section: query, filter, and actions in the same place — renders `null` when
    nothing matches the filter, `RefsSidebar` doesn't need to know the shape of a stash entry
    to compose its "no results" message. */
export function StashSection({ filter }: { filter: string }) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const onFocusStash = useRepoStore((s) => s.focusStash)
  const onStash = useRepoStore((s) => s.runStash)
  const { data: stashes = [] } = useStashesQuery(api, repoId)

  const matches = stashes.filter((s) => matchStash(s, filter))
  const { open, onOpenChange } = useResettableOpen(true, !!filter)

  if (!matches.length) return null

  return (
    <RefGroup title="Stash" count={matches.length} open={open} onOpenChange={onOpenChange}>
      <ul role="list" className="mt-0.5 flex flex-col">
        {matches.map((s) => (
          <StashRow key={s.name + s.h} s={s} onFocus={onFocusStash} onStash={onStash} />
        ))}
      </ul>
    </RefGroup>
  )
}
