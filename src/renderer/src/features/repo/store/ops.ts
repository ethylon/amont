/* The `ops` slice's setters — mirrors of the main-side events (busy op, live progress,
   mutation queue, flow shimmer) — and the status badge, whose auto-clear timer is the one
   piece of local state here. `setStats` rides along: like the others it just lands a value
   pushed from outside (the graph controller's `emitStats`). */

import type { ActionCtx, RepoStoreState } from "../repo-store"

type OpsActions = Pick<
  RepoStoreState,
  "setBusyOp" | "setOpProgress" | "setQueue" | "setFlowBusy" | "showOp" | "clearOp" | "setStats"
>

export function createOpsActions({ set }: ActionCtx): OpsActions {
  let okTimer = 0

  return {
    setBusyOp(op) {
      set((s) => ({ ops: { ...s.ops, busyOp: op } }))
    },
    setOpProgress(progress) {
      set((s) => ({ ops: { ...s.ops, opProgress: progress } }))
    },
    setQueue(queue) {
      set((s) => ({ ops: { ...s.ops, queue } }))
    },
    setFlowBusy(v) {
      set((s) => ({ ops: { ...s.ops, flowBusy: v } }))
    },
    /* the badge clears itself; only an action ("Reload") keeps it in place */
    showOp(text, color, action) {
      clearTimeout(okTimer)
      set((s) => ({ ops: { ...s.ops, opState: { text, color, action } } }))
      if (!action) okTimer = window.setTimeout(() => set((s) => ({ ops: { ...s.ops, opState: null } })), 6000)
    },
    clearOp() {
      clearTimeout(okTimer)
      set((s) => ({ ops: { ...s.ops, opState: null } }))
    },
    setStats(stats) {
      set((s) => ({ graph: { ...s.graph, stats } }))
    },
  }
}
