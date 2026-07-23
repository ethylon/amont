/* The graph reload pair. `reload()` is the default posture: restart the graph
   (scroll-preserving, cf. graph/controller.ts `reset`) and re-resolve the selection, leaving
   the current view and any open diff alone. `hardReload()` is the variant a caller must
   spell out — it adds the teardown of a user-initiated context switch. The old single
   `resetAndLoad(opts?)` made DESTRUCTION the default and preservation the opt-in `soft`
   flag, so every new caller shipped the "lose my place" regression until someone remembered
   the flag (architecture audit, §I.5; refresh audit, §1/§4). */

import { queryKeys } from "@/lib/queries"
import { queryClient } from "@/lib/query-client"

import type { ActionCtx, RepoStoreState } from "../repo-store"

export function createReloadActions({ set, get, repoId }: ActionCtx): Pick<RepoStoreState, "reload" | "hardReload"> {
  /* Coalesced graph reload (refresh audit, §2): an external rebase fires one watcher event
     per ref move — at most one rerun queues behind the running reload (it reads the
     then-current repo state, satisfying every caller that landed mid-flight), and further
     callers share that queued rerun's promise. A permanent chain rather than a nullable
     in-flight marker: with a marker, the microtask between "run settled" and "trailing rerun
     starts" let a caller's continuation slip a concurrent duplicate in. */
  let reloadChain: Promise<void> = Promise.resolve()
  let reloadDepth = 0

  const run = (): Promise<void> => {
    /* running + queued = 2: a third caller is satisfied by the queued rerun, which starts
       after the current one and reads fresh state */
    if (reloadDepth >= 2) return reloadChain
    reloadDepth++
    reloadChain = reloadChain
      .catch(() => {}) // a failed run must not poison the runs chained behind it
      .then(async () => {
        try {
          await get().graphRef.current?.reset()
          await get().reresolveSelection()
          await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
        } finally {
          reloadDepth--
        }
      })
    return reloadChain
  }

  return {
    reload: () => run(),

    hardReload() {
      /* the teardown applies immediately, even when the graph rerun is coalesced into an
         already-queued one */
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: null, fileHistory: null, view: "commits" } }))
      return run()
    },
  }
}
