/* Merge-queue banner: while HEAD sits on the queue's target (the release branch, usually),
   this strip replaces the read-only flow cockpit and drives the composed merges — one
   explicit click per branch, never chained. Same 32px grammar as the other banners: the
   flow tint of the target, spinner + traced-commands ticker while a merge runs, and the
   destructive tint when a merge stopped on conflicts (resolution routes to the existing
   conflict view; aborting skips the branch without touching the release).

   The queue also self-heals from work done outside its own buttons (a conflict resolved and
   committed by hand, an external abort): whenever no merge is in progress while an item still
   says "conflict", queueRecheck re-reads reality (cf. repo-store). */

import { useEffect } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon, Cancel01Icon, GitMergeIcon, Tick02Icon } from "@hugeicons/core-free-icons"

import { branchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { traceCommand, useTraceStep } from "@/lib/use-trace-step"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RollingText } from "@/components/ui/rolling-text"
import { Spinner } from "@/components/ui/spinner"
import { useMergeStateQuery } from "@/features/conflict/conflict-queries"
import { FLOW_META } from "@/features/flow/flow-context"
import { useFlowQuery } from "@/features/flow/flow-queries"
import { useRepoStore, type MergeQueueItemState } from "@/features/repo/repo-store"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"

/* one background per state — the base class carries none, so these never fight */
const CHIP: Record<MergeQueueItemState, string> = {
  merged: "border-success/35 bg-success/10 text-success",
  merging: "border-current/40 bg-current/10",
  conflict: "border-destructive/45 bg-destructive/10 text-destructive",
  pending: "border-current/25 bg-background opacity-70",
  skipped: "border-current/20 bg-background line-through opacity-50",
}

const CHIP_LABEL: Record<Exclude<MergeQueueItemState, "merging">, () => string> = {
  merged: () => messages.queue.stateMerged,
  conflict: () => messages.queue.stateConflict,
  pending: () => messages.queue.statePending,
  skipped: () => messages.queue.stateSkipped,
}

export function MergeQueueBanner() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const queue = useRepoStore((s) => s.mergeQueue)
  const queueMerge = useRepoStore((s) => s.queueMerge)
  const queueAbort = useRepoStore((s) => s.queueAbort)
  const queueRecheck = useRepoStore((s) => s.queueRecheck)
  const closeMergeQueue = useRepoStore((s) => s.closeMergeQueue)
  const showWorktree = useRepoStore((s) => s.showWorktree)

  const { data: flow = null } = useFlowQuery(api, repoId)
  const { data: mergeState } = useMergeStateQuery(api, repoId)
  /* live conflicted-path count of the stopped merge (the failure's own list isn't kept) */
  const conflictFiles = useWorktreeQuery(api, repoId).data?.conflicts.length ?? 0

  const items = queue?.items ?? []
  const merging = items.some((i) => i.state === "merging")
  const conflict = items.find((i) => i.state === "conflict")
  const next = items.find((i) => i.state === "pending")
  const done = items.filter((i) => i.state === "merged").length

  /* a conflict no longer backed by a merge in progress was handled elsewhere (resolved and
     committed, or aborted): reconcile. queueRecheck re-reads mergeState fresh before moving
     anything, so a stale cached `merging` here costs at most a no-op call. */
  const externallySettled = !!conflict && mergeState !== undefined && !mergeState.merging
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
        {merging ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <HugeiconsIcon icon={conflict ? Alert02Icon : GitMergeIcon} strokeWidth={2} className="size-3.5 shrink-0" />
        )}
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
              {i.state === "merging" && <Spinner className="size-2.5 shrink-0" />}
              <span className="truncate">{i.branch}</span>
            </span>
          </span>
        ))}
      </span>

      {conflict && !merging && conflictFiles > 0 && (
        <span className="opacity-85">{messages.release.conflictedFiles(conflictFiles)}</span>
      )}

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

      {conflict && !merging ? (
        <>
          <Button size="sm" color="destructive" onClick={showWorktree}>
            {messages.queue.resolve}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-foreground"
            onClick={() => void queueAbort(conflict.branch)}
          >
            {messages.queue.abort}
          </Button>
        </>
      ) : next ? (
        <Button size="sm" color={m?.btn} disabled={merging} onClick={() => void queueMerge(next.branch)}>
          {merging ? messages.queue.merging : messages.queue.mergeNext(next.branch)}
        </Button>
      ) : null}

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
