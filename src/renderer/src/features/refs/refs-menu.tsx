/* Menu contextuel d'une branche (AUDIT.md §7, phase 5) : une des cinq préoccupations de
   l'ancien refs-sidebar.tsx monolithique. Le menu de stash vit désormais dans
   features/stash/stash-section.tsx (extraction en feature verticale). */

import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown02Icon, ArrowUp02Icon, CheckmarkCircle02Icon, Delete02Icon, GitBranchIcon, GitMergeIcon,
} from "@hugeicons/core-free-icons"

import type { FlowPrefixes, GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import {
  ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from "@/components/ui/context-menu"
import type { Ctx } from "@/features/refs/refs-tree"

const FLOW_LABEL = {
  feature: messages.refs.finishFeature,
  bugfix: messages.refs.finishBugfix,
  release: messages.refs.finishRelease,
  hotfix: messages.refs.finishHotfix,
} as const satisfies Record<keyof FlowPrefixes, string>

const flowType = (name: string, prefixes: FlowPrefixes | null) =>
  prefixes &&
  (Object.keys(FLOW_LABEL) as (keyof FlowPrefixes)[]).find(
    (t) => prefixes[t] && name.startsWith(prefixes[t]!)
  )

/* Le menu ne s'ouvre que sur une branche locale : une distante ne se merge ni ne se pousse,
   et un tag n'a rien de tout ça. `flow finish` connaît le nom complet, préfixe compris. */
export function BranchMenu({ r, ctx }: { r: GitRef; ctx: Ctx }) {
  const flow = flowType(r.name, ctx.flow)
  /* les commandes affichées répliquent BRANCH_OPS côté main : `origin/master` → remote + branche */
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

      {flow && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => ctx.onBranch("finish", r.name)}>
            <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
            <MenuItemWithCmd
              label={FLOW_LABEL[flow]}
              cmd={`git flow ${flow} finish ${r.name.slice(ctx.flow![flow]!.length)}`}
            />
          </ContextMenuItem>
        </>
      )}

      <ContextMenuSeparator />
      {/* git refuse `-d` sur la branche sortie, mais un item qui ne peut qu'échouer n'a rien à faire là */}
      <ContextMenuItem variant="destructive" disabled={r.head} onClick={() => ctx.onBranch("delete", r.name)}>
        <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.refs.deleteBranch} cmd={`git branch -d ${r.name}`} />
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
