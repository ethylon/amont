/* The ordered merge queue armed by the release modal (or the selection menu): its branches
   are merged into `target` one at a time, each on an explicit click — never chained. The
   queue is session state, not git state: a restart falls back to a plain release with
   unmerged features, resumable from the branches' own merge actions. */

import { decodeError, describePayload } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { invalidateRepo } from "@/lib/queries"
import { queryClient } from "@/lib/query-client"

import type { ActionCtx, MergeQueue, MergeQueueItemState, RepoStoreState } from "../repo-store"

/** Nothing left to act on: every branch landed. */
const queueDone = (q: MergeQueue) => q.items.every((i) => i.state === "merged")

type MergeQueueActions = Pick<RepoStoreState, "armMergeQueue" | "closeMergeQueue" | "queueMerge" | "queueRecheck">

export function createMergeQueueActions({ set, get, api, repoId }: ActionCtx): MergeQueueActions {
  return {
    armMergeQueue(target, branches) {
      const items = branches.filter((b) => b !== target).map((branch) => ({ branch, state: "pending" as const }))
      set(() => ({ mergeQueue: items.length ? { target, items } : null }))
    },
    closeMergeQueue() {
      set(() => ({ mergeQueue: null }))
    },

    async queueMerge(branch) {
      const q = get().mergeQueue
      /* one at a time, always explicit: a second click while a merge runs is a no-op */
      if (!q || q.items.some((i) => i.state === "merging")) return
      if (!q.items.some((i) => i.branch === branch && (i.state === "pending" || i.state === "conflict"))) return
      const setItem = (state: MergeQueueItemState) =>
        set((s) =>
          s.mergeQueue
            ? {
                mergeQueue: {
                  ...s.mergeQueue,
                  items: s.mergeQueue.items.map((i) => (i.branch === branch ? { ...i, state } : i)),
                },
              }
            : {}
        )
      setItem("merging")
      get().setFlowBusy(true) // the banner rolls the traced commands, shimmer on
      const err = await api.merge(branch, true).then(() => null, decodeError)
      get().setFlowBusy(false)
      setItem(err ? (err.code === "MERGE_CONFLICT" ? "conflict" : "pending") : "merged")
      invalidateRepo(queryClient, repoId)
      if (err && err.code !== "MERGE_CONFLICT") {
        get().showOp(describePayload(err), "danger")
        return
      }
      /* a landed merge reshapes the graph — full reload; a conflict only dirtied the tree,
         the soft reload refreshes without ripping the user's view away */
      await (err ? get().reload() : get().hardReload())
      const done = get().mergeQueue
      if (done && queueDone(done)) {
        set(() => ({ mergeQueue: null }))
        get().showOp(messages.queue.allMerged(done.target), "primary")
      }
    },

    async queueRecheck() {
      const q = get().mergeQueue
      if (!q) return
      const stale = q.items.filter((i) => i.state === "conflict" || i.state === "pending")
      if (!stale.length) return
      /* fresh read, not the query cache: right after a conflicted merge the cached mergeState
         still says "no operation" for a beat — demoting the conflict on that stale beat would
         flash it back to pending. Only a genuinely concluded operation moves items here. */
      const inProgress = await api.mergeState().then(
        (ms) => ms.op !== null,
        () => true
      )
      if (inProgress) return
      const preview = await api
        .mergePreview(
          q.target,
          stale.map((i) => i.branch)
        )
        .catch(() => null)
      if (!preview) return
      const status = new Map(preview.map((p) => [p.branch, p.status]))
      set((s) => {
        if (!s.mergeQueue || s.mergeQueue.target !== q.target) return {}
        return {
          mergeQueue: {
            ...s.mergeQueue,
            items: s.mergeQueue.items.map((i) => {
              if (status.get(i.branch) === "merged") return { ...i, state: "merged" as const }
              /* the conflicted merge is gone (aborted): back in line */
              if (i.state === "conflict") return { ...i, state: "pending" as const }
              return i
            }),
          },
        }
      })
      const left = get().mergeQueue
      if (left && queueDone(left)) {
        set(() => ({ mergeQueue: null }))
        get().showOp(messages.queue.allMerged(left.target), "primary")
      }
    },
  }
}
