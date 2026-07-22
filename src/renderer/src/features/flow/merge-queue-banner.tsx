/* Merge-queue banner: while HEAD sits on the queue's target (the release branch, usually),
   this strip replaces the read-only flow cockpit and drives the composed merges — one
   explicit click per branch, never chained. Same 32px grammar as the other banners: the
   flow tint of the target, a shimmering traced-commands ticker while a merge runs, and the
   destructive tint when a merge stopped on conflicts.

   A conflict carries no actions here: the repo-wide ConflictBanner (rendered above, as for
   any conflicted operation) already routes to the conflict view and owns the abort — this
   strip only keeps the queue's context in sight. Whichever way the conflict concludes
   (resolved and committed, or aborted), queueRecheck re-reads reality once no operation is
   in progress and moves the item to `merged` or back to `pending` (cf. repo-store). */

import { useEffect } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Cancel01Icon, GitMergeIcon, Tick02Icon } from "@hugeicons/core-free-icons"

import { branchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { traceCommand, useTraceStep } from "@/lib/use-trace-step"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RollingText } from "@/components/ui/rolling-text"
import { useMergeStateQuery } from "@/features/conflict/conflict-queries"
import { FLOW_META } from "@/features/flow/flow-context"
import { useFlowQuery } from "@/features/flow/flow-queries"
import { useRepoStore, type MergeQueueItemState } from "@/features/repo/repo-store"

/* one background per state — the base class carries none, so these never fight */
const CHIP: Record<MergeQueueItemState, string> = {
  merged: "border-success/35 bg-success/10 text-success",
  merging: "border-current/40 bg-current/10",
  conflict: "border-destructive/45 bg-destructive/10 text-destructive",
  pending: "border-current/25 bg-background opacity-70",
}

const CHIP_LABEL: Record<Exclude<MergeQueueItemState, "merging">, () => string> = {
  merged: () => messages.queue.stateMerged,
  conflict: () => messages.queue.stateConflict,
  pending: () => messages.queue.statePending,
}

export function MergeQueueBanner() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const queue = useRepoStore((s) => s.mergeQueue)
  const queueMerge = useRepoStore((s) => s.queueMerge)
  const queueRecheck = useRepoStore((s) => s.queueRecheck)
  const closeMergeQueue = useRepoStore((s) => s.closeMergeQueue)

  const { data: flow = null } = useFlowQuery(api, repoId)
  const { data: mergeState } = useMergeStateQuery(api, repoId)

  const items = queue?.items ?? []
  const merging = items.some((i) => i.state === "merging")
  const conflict = items.find((i) => i.state === "conflict")
  const next = items.find((i) => i.state === "pending")
  const done = items.filter((i) => i.state === "merged").length

  /* a conflict no longer backed by an operation in progress was handled (resolved and
     committed, or aborted — both live in the ConflictBanner): reconcile. queueRecheck
     re-reads mergeState fresh before moving anything, so a stale cached `op` here costs at
     most a no-op call. */
  const externallySettled = !!conflict && mergeState !== undefined && mergeState.op === null
  useEffect(() => {
    if (externallySettled) void queueRecheck()
  }, [externallySettled, queueRecheck])

  const flowBusy = useRepoStore((s) => s.ops.flowBusy)
  const mergingBranch = items.find((i) => i.state === "merging")?.branch
  const cmd = useTraceStep(repoId, merging && flowBusy, traceCommand)

  if (!queue) return null
  const kind = branchFlow(queue.target, flow)
  const m = kind ? FLOW_META[kind] : null

  return (
    <div
      className={cn(
        "amont-drop flex h-8 shrink-0 items-center gap-2.5 border-b px-3.5 text-xs whitespace-nowrap",
        conflict ? "bg-destructive/10 text-destructive" : (m?.bg ?? "bg-primary/10"),
        conflict ? "" : (m?.text ?? "text-primary")
      )}
    >
      <span className="flex items-center gap-1.5 font-medium">
        <HugeiconsIcon icon={conflict ? Alert02Icon : GitMergeIcon} strokeWidth={2} className="size-3.5 shrink-0" />
        {queue.target}
      </span>

      {/* the queue itself: one chip per branch, in merge order */}
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        {items.map((i, at) => (
          <span key={i.branch} className="flex min-w-0 items-center gap-1">
            {at > 0 && (
              <span aria-hidden className="text-[0.625rem] opacity-50">
                {"›"}
              </span>
            )}
            <span
              aria-label={i.state === "merging" ? messages.queue.merging : `${i.branch} · ${CHIP_LABEL[i.state]()}`}
              className={cn(
                "inline-flex h-5 min-w-0 items-center gap-1 rounded-full border px-2 text-[0.625rem] font-medium",
                CHIP[i.state]
              )}
            >
              {i.state === "merged" && (
                <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="size-2.5 shrink-0" />
              )}
              {i.state === "conflict" && (
                <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="size-2.5 shrink-0" />
              )}
              <span className={cn("truncate", i.state === "merging" && "shimmer")}>{i.branch}</span>
            </span>
          </span>
        ))}
      </span>

      {merging ? (
        /* the expected command seeds the ticker until the first traced one rolls in */
        <RollingText
          text={cmd ?? `git merge --no-ff ${mergingBranch ?? ""}`}
          className="shimmer min-w-0 flex-1 font-mono text-[0.625rem] opacity-80"
        />
      ) : (
        <span className="flex-1" />
      )}

      <span className="opacity-70 tabular-nums">{messages.queue.mergedCount(done, items.length)}</span>

      {/* no conflict actions here — the ConflictBanner above owns resolution and abort */}
      {!conflict && next && (
        <Button size="sm" color={m?.btn} disabled={merging} onClick={() => void queueMerge(next.branch)}>
          {merging ? messages.queue.merging : messages.queue.mergeNext(next.branch)}
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon-sm"
        disabled={merging}
        onClick={closeMergeQueue}
        aria-label={messages.queue.close}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}
