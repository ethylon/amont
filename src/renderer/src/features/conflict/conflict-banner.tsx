/* Repo-wide conflict banner — the strip under the toolbar that makes conflict mode
   unmistakable whatever the current view. The worktree panel's conflict rows only exist once
   the user has opened the uncommitted-changes view; this banner is the signal that gets them
   there ("View conflicts") — and it carries the way out: the abort of whatever operation is
   in progress (merge, rebase, cherry-pick, revert), not just merge.

   Shown while an operation's state is on disk — even with every file resolved, since the
   merge still needs its concluding commit — or when conflicted paths exist without one
   (a stash pop): then there is nothing to abort and the strip only names the situation. */

import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import type { MergeOp, MergeState } from "@/lib/git"
import { messages } from "@/lib/messages"
import { useMergeStateQuery } from "@/features/conflict/conflict-queries"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { useRepoStore } from "@/features/repo/repo-store"
import { Button } from "@/components/ui/button"
import { GitCmd } from "@/components/ui/git-cmd"
import { Spinner } from "@/components/ui/spinner"

/** What the strip says: the operation with its sides — the same A/B vocabulary as the
    conflict view's pane headers — or the op-less fallback (conflicts from a stash pop). */
function title(ms: MergeState): string {
  switch (ms.op) {
    case "merge":
      return messages.conflict.mergeBanner(ms.theirs ?? "MERGE_HEAD", ms.ours ?? "HEAD")
    case "rebase":
      return messages.conflict.rebaseBanner(ms.theirs ?? "REBASE_HEAD")
    case "cherry-pick":
      return messages.conflict.cherryPickBanner(ms.theirs ?? "CHERRY_PICK_HEAD")
    case "revert":
      return messages.conflict.revertBanner(ms.theirs ?? "REVERT_HEAD")
    default:
      return messages.conflict.conflictsBanner
  }
}

/* getters, not values: the label must be read at render time for a runtime language switch */
const ABORT_LABEL: Record<MergeOp, () => string> = {
  merge: () => messages.conflict.abortMerge,
  rebase: () => messages.conflict.abortRebase,
  "cherry-pick": () => messages.conflict.abortCherryPick,
  revert: () => messages.conflict.abortRevert,
}

export function ConflictBanner() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const view = useRepoStore((s) => s.ui.view)
  const showWorktree = useRepoStore((s) => s.showWorktree)
  const onAbort = useRepoStore((s) => s.abortMerge)
  const { data: ms } = useMergeStateQuery(api, repoId)
  const { data: worktree } = useWorktreeQuery(api, repoId)
  const [aborting, setAborting] = useState(false)

  const conflicts = worktree?.conflicts.length ?? 0
  if (!ms || (!ms.op && conflicts === 0)) return null

  return (
    /* amont-drop: after boot, the insertion pushes the content in smoothly (see app.css) */
    <div className="amont-drop flex shrink-0 items-center gap-2.5 border-b border-warning/40 bg-warning/10 px-3.5 py-1 text-xs whitespace-nowrap">
      <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-4 shrink-0 text-warning" />
      <span className="min-w-0 shrink-0 font-semibold">{title(ms)}</span>
      <span className="min-w-0 truncate text-muted-foreground">
        {conflicts > 0 ? messages.conflict.conflictedFiles(conflicts) : messages.conflict.allResolved}
      </span>
      <span className="ms-auto flex shrink-0 items-center gap-1.5">
        {conflicts > 0 && view !== "wt" && (
          <Button variant="outline" size="sm" className="h-6" onClick={showWorktree}>
            {messages.conflict.viewConflicts}
          </Button>
        )}
        {ms.op && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 normal-case tracking-normal text-destructive"
            disabled={aborting}
            aria-busy={aborting}
            onClick={async () => {
              setAborting(true)
              /* runGitAction never rejects (failure = badge), but the button must re-enable
                 either way — same belt-and-suspenders as the commit button */
              try {
                await onAbort()
              } finally {
                setAborting(false)
              }
            }}
          >
            <span className="flex flex-col items-start">
              <span className="flex items-center gap-1.5">
                {aborting && <Spinner className="size-3" />}
                {ABORT_LABEL[ms.op]()}
              </span>
              <GitCmd cmd={`git ${ms.op} --abort`} running={aborting} className="text-destructive/70" />
            </span>
          </Button>
        )}
      </span>
    </div>
  )
}
