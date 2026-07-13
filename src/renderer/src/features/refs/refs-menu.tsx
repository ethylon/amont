/* Context menu for a branch (AUDIT.md §7, phase 5): one of the five concerns of the
   old monolithic refs-sidebar.tsx. The stash menu now lives in
   features/stash/stash-section.tsx (extracted into a vertical feature). */

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  FolderAddIcon,
  GitBranchIcon,
  GitMergeIcon,
} from "@hugeicons/core-free-icons"

import type { FlowPrefixes, GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"
import type { Ctx } from "@/features/refs/refs-tree"

/* Thunks, not values: reading messages.* at module scope would run `t` during import,
   before setupI18n() has activated a locale (throws in dev). */
const FLOW_LABEL = {
  feature: () => messages.refs.finishFeature,
  bugfix: () => messages.refs.finishBugfix,
  release: () => messages.refs.finishRelease,
  hotfix: () => messages.refs.finishHotfix,
} as const satisfies Record<keyof FlowPrefixes, () => string>

const flowType = (name: string, prefixes: FlowPrefixes | null) =>
  prefixes &&
  (Object.keys(FLOW_LABEL) as (keyof FlowPrefixes)[]).find((t) => prefixes[t] && name.startsWith(prefixes[t]))

/* The menu only opens on a local branch: a remote is neither merged nor pushed,
   and a tag has none of that. `flow finish` knows the full name, prefix included. */
export function BranchMenu({ r, ctx }: { r: GitRef; ctx: Ctx }) {
  const flow = flowType(r.name, ctx.flow)
  /* the displayed commands replicate BRANCH_OPS on the main side: `origin/master` → remote + branch */
  const [remote, ...up] = (r.upstream ?? "").split("/")
  const upBranch = up.join("/")
  return (
    <ContextMenuContent className="max-w-72">
      <ContextMenuItem disabled={r.head} onClick={() => ctx.onCheckout(r.name)}>
        <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.refs.checkout} cmd={`git checkout ${r.name}`} />
      </ContextMenuItem>
      <ContextMenuItem disabled={r.head || !ctx.current} onClick={() => ctx.onBranch("merge", r.name)}>
        <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.refs.mergeInto(ctx.current ?? "HEAD")} cmd={`git merge ${r.name}`} />
      </ContextMenuItem>

      <ContextMenuSeparator />
      <ContextMenuItem disabled={!r.upstream} onClick={() => ctx.onBranch("pull", r.name)}>
        <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
        <MenuItemWithCmd
          label={messages.refs.pull}
          cmd={!r.upstream || r.head ? "git pull --ff-only" : `git fetch ${remote} ${upBranch}:${r.name}`}
        />
      </ContextMenuItem>
      <ContextMenuItem disabled={!r.upstream} onClick={() => ctx.onBranch("push", r.name)}>
        <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
        <MenuItemWithCmd
          label={r.upstream ? messages.refs.pushTo(r.upstream) : messages.refs.push}
          cmd={r.upstream ? `git push ${remote} ${r.name}:${upBranch}` : "git push"}
        />
      </ContextMenuItem>

      <ContextMenuSeparator />
      {/* checked out here (head) or in a worktree: git refuses a second checkout of the branch */}
      <ContextMenuItem disabled={r.head || ctx.worktreeBranches.has(r.name)} onClick={() => ctx.onAddWorktree(r.name)}>
        <HugeiconsIcon icon={FolderAddIcon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.worktrees.create} cmd={`git worktree add <dir> ${r.name}`} />
      </ContextMenuItem>

      {flow && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => ctx.onBranch("finish", r.name)}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            <MenuItemWithCmd
              label={FLOW_LABEL[flow]()}
              cmd={`git flow ${flow} finish ${r.name.slice(ctx.flow![flow]!.length)}`}
            />
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />
      {/* git refuses `-d` on the checked-out branch, but an item that can only fail has no place here */}
      <ContextMenuItem variant="destructive" disabled={r.head} onClick={() => ctx.onBranch("delete", r.name)}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.refs.deleteBranch} cmd={`git branch -d ${r.name}`} />
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
