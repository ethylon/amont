import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Bug01Icon, Cancel01Icon, Fire02Icon, GitMergeIcon, RocketIcon, SparklesIcon } from "@hugeicons/core-free-icons"

import type { FlowInfo } from "@/lib/git"
import type { BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { prefs } from "@/lib/prefs"
import { traceCommand, useTraceStep } from "@/lib/use-trace-step"
import { cn } from "@/lib/utils"
import { useRepoStore } from "@/features/repo/repo-store"
import { Button, type ButtonColor } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RollingSwap, RollingText } from "@/components/ui/rolling-text"
import { Spinner } from "@/components/ui/spinner"

/* Colors and hues of all flow indicators (statusbar, cockpit, card): same hues
   as the sidebar badges, same icons as the commit-type badges (feat's sparkle,
   the graph's merge-chip release/hotfix glyphs).
   `btn` = same hue for the flow-start button, so it follows the banner tint. */
export const FLOW_META: Record<BranchFlow, { icon: IconSvgElement; text: string; bg: string; btn: ButtonColor }> = {
  feature: { icon: SparklesIcon, text: "text-success", bg: "bg-success/10", btn: "success" },
  bugfix: { icon: Bug01Icon, text: "text-warning", bg: "bg-warning/10", btn: "warning" },
  release: { icon: RocketIcon, text: "text-release", bg: "bg-release/10", btn: "release" },
  hotfix: { icon: Fire02Icon, text: "text-destructive", bg: "bg-destructive/10", btn: "destructive" },
}

/** "35 min", "4 h", "2 d" — the coarse scale is enough to situate a cycle. */
function duration(epoch: number): string {
  const s = Math.max(60, Date.now() / 1000 - epoch)
  if (s < 3600) return messages.flow.minutes(Math.floor(s / 60))
  if (s < 86400) return messages.flow.hours(Math.floor(s / 3600))
  return messages.flow.days(Math.floor(s / 86400))
}

const count = (info: FlowInfo) => messages.flow.commitCount(info.commits)

/* Cockpit: banner under the toolbar as soon as a flow branch is checked out — hidden on
   trunks (master, develop) and detached HEAD. On the right, where the work will land once
   finished (finish merge, tag set). While a gitflow operation runs (finish, publish — they can
   be long: merge + tag + back-merge, network), the kind icon gives way to a spinner and the
   traced git commands roll where the count sits (same ticker as the commit button).

   `finish`: the same strip in confirmation mode — a requested feature/bugfix finish rolls the
   info row out and the options row in (same ticker mechanics), instead of running outright. */
export function FlowBanner({
  kind,
  branch,
  info,
  finish = false,
  onFinishDone,
}: {
  kind: BranchFlow
  branch: string
  info: FlowInfo
  finish?: boolean
  onFinishDone?: () => void
}) {
  const m = FLOW_META[kind]
  return (
    <div
      className={cn(
        /* amont-drop: after boot, the insertion pushes the content in smoothly (see app.css) */
        "amont-drop flex h-8 shrink-0 items-center border-b px-3.5 text-xs whitespace-nowrap",
        m.bg,
        m.text
      )}
    >
      <RollingSwap swapKey={finish ? "finish" : "info"} className="h-full min-w-0 flex-1">
        {finish ? (
          <FlowFinishRow kind={kind} branch={branch} info={info} onDone={onFinishDone ?? (() => {})} />
        ) : (
          <FlowInfoRow kind={kind} branch={branch} info={info} />
        )}
      </RollingSwap>
    </div>
  )
}

function FlowInfoRow({ kind, branch, info }: { kind: BranchFlow; branch: string; info: FlowInfo }) {
  const m = FLOW_META[kind]
  const repoId = useRepoStore((s) => s.repoId)
  const busy = useRepoStore((s) => s.ops.flowBusy)
  const cmd = useTraceStep(repoId, busy, traceCommand)
  return (
    <div className="flex h-full items-center gap-3">
      <span className="flex items-center gap-1.5 font-medium">
        {busy ? (
          <Spinner className="size-3.5 shrink-0" />
        ) : (
          <HugeiconsIcon icon={m.icon} strokeWidth={2} className="size-3.5 shrink-0" />
        )}
        {branch}
      </span>
      {/* the ticker stays mounted across idle/busy so the count rolls up into the first traced
          command (and rolls back when the op ends) — the same continuous roll as the commit
          button, rather than swapping the count out for a freshly mounted ticker. Shimmers only
          while busy. */}
      <RollingText
        text={busy ? (cmd ?? count(info)) : count(info)}
        className={cn("min-w-0 flex-1 font-mono text-[0.625rem] opacity-80", busy && "shimmer")}
      />
      <span className="flex items-center gap-1.5 opacity-80">
        <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} className="size-3.5 shrink-0" />
        {messages.flow.to(info.targets.join(" + "))}
        {info.nextTag && messages.flow.tag(info.nextTag)}
      </span>
    </div>
  )
}

/* Confirmation row of a feature/bugfix finish. Two choices, both remembered (prefs):
   - rebase on the merge target then fast-forward (linear history) — unchecked, the merge is
     forced with `--no-ff`, a merge commit every time;
   - delete the branch once merged — unchecked maps to `git flow finish -k`.
   Same inline mechanics as FlowStartBanner: submit stays open on failure with the error
   inline, Esc backs out (handled by RepoView's shortcut, the row has no input to host it). */
function FlowFinishRow({
  kind,
  branch,
  info,
  onDone,
}: {
  kind: BranchFlow
  branch: string
  info: FlowInfo
  onDone: () => void
}) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const runFlow = useRepoStore((s) => s.runFlow)
  const [rebase, setRebase] = useState(() => prefs.flowFinishMode.get() === "rebase")
  const [del, setDel] = useState(() => prefs.flowFinishBranch.get() !== "keep")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* Enter confirms out of the box: the row opens with the finish button focused */
  const btnRef = useRef<HTMLButtonElement>(null)
  useEffect(() => btnRef.current?.focus(), [])

  const flowBusy = useRepoStore((s) => s.ops.flowBusy)
  const cmd = useTraceStep(repoId, busy && flowBusy, traceCommand)

  const m = FLOW_META[kind]
  /* a feature/bugfix has a single finish target — its base trunk */
  const target = info.targets[0] ?? "develop"

  async function submit() {
    if (busy) return
    setBusy(true)
    setError(null)
    prefs.flowFinishMode.set(rebase ? "rebase" : "merge")
    prefs.flowFinishBranch.set(del ? "delete" : "keep")
    const err = await runFlow(() => api.flowFinish(branch, { rebase, deleteBranch: del }))
    setBusy(false)
    if (err) setError(err)
    else onDone()
  }

  return (
    <div className="flex h-full items-center gap-2">
      {busy ? (
        <Spinner className="size-3.5 shrink-0" />
      ) : (
        <HugeiconsIcon icon={m.icon} strokeWidth={2} className="size-3.5 shrink-0" />
      )}
      <span className="font-medium">{branch}</span>
      <label className={cn("flex cursor-pointer items-center gap-1.5", busy && "pointer-events-none opacity-50")}>
        <Checkbox checked={rebase} onCheckedChange={(v) => setRebase(v === true)} disabled={busy} />
        {messages.gitflow.rebaseOn(target)}
      </label>
      <label className={cn("flex cursor-pointer items-center gap-1.5", busy && "pointer-events-none opacity-50")}>
        <Checkbox checked={del} onCheckedChange={(v) => setDel(v === true)} disabled={busy} />
        {messages.gitflow.deleteBranch}
      </label>
      {error && <span className="min-w-0 flex-1 truncate text-destructive">{error}</span>}
      {busy ? (
        /* seed with the branch until the first traced command rolls in */
        <RollingText
          text={cmd ?? (rebase ? `git rebase ${target} ${branch}` : `git flow ${kind} finish --no-ff`)}
          className="shimmer min-w-0 flex-1 font-mono text-[0.625rem] opacity-80"
        />
      ) : (
        <span className="flex-1" />
      )}
      <Button ref={btnRef} size="sm" color={m.btn} onClick={() => void submit()} disabled={busy}>
        {busy ? messages.gitflow.finishing : messages.gitflow.finish}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDone} aria-label={messages.gitflow.cancelFinish}>
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

/* Context card: the detail panel's empty state summarizes the work in progress instead of
   saying nothing. All flow types, feature included. */
export function FlowCard({ kind, branch, info }: { kind: BranchFlow; branch: string; info: FlowInfo }) {
  const m = FLOW_META[kind]
  const rows = [
    [messages.flow.base, info.base ?? "—"],
    [messages.flow.commits, info.commits ? String(info.commits) : messages.flow.none],
    [
      info.targets.length > 1 ? messages.flow.finishTargets : messages.flow.finishTarget,
      info.targets.join(" + ") || "—",
    ],
    ...(info.nextTag ? [[messages.flow.expectedTag, info.nextTag]] : []),
  ]
  return (
    <div className="amont-fadein shrink-0 rounded-md border p-3.5">
      <div className="flex items-center gap-2.5">
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md", m.bg, m.text)}>
          <HugeiconsIcon icon={m.icon} strokeWidth={2} className="size-4" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{branch}</span>
          <span className={cn("block text-[0.625rem]", m.text)}>
            {messages.flow.inProgress(kind, info.startedAt ? duration(info.startedAt) : null)}
          </span>
        </span>
      </div>
      <dl className="mt-3 border-t pt-1.5 text-xs">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 py-1">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
