/* Sidebar flow shortcut: the promoted gitflow move (same derivation as the Git Flow menu's
   promoted section, see lib/gitflow `promotedFlow`), surfaced at the top of the refs sidebar.
   Renders nothing without a real gitflow (`git flow init`) or when HEAD has no obvious move. */

import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { ArrowUp02Icon, CheckmarkCircle02Icon } from "@hugeicons/core-free-icons"

import { promotedFlow, type BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { useRepoStore } from "@/features/repo/repo-store"
import { useStatusQuery } from "@/features/repo/repo-queries"
import { useFlowInfoQuery, useFlowQuery } from "@/features/flow/flow-queries"
import { FLOW_META } from "@/features/flow/flow-context"

const FINISH_NAMED: Record<BranchFlow, (name: string) => string> = {
  feature: messages.menu.finishFeatureNamed,
  bugfix: messages.menu.finishBugfixNamed,
  release: messages.menu.finishReleaseNamed,
  hotfix: messages.menu.finishHotfixNamed,
}
const PUBLISH_NAMED: Record<BranchFlow, (name: string) => string> = {
  feature: messages.menu.publishFeatureNamed,
  bugfix: messages.menu.publishBugfixNamed,
  release: messages.menu.publishReleaseNamed,
  hotfix: messages.menu.publishHotfixNamed,
}

function ShortcutRow({
  icon,
  tint,
  label,
  onClick,
}: {
  icon: IconSvgElement
  tint: string
  label: string
  onClick(): void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs font-medium text-foreground select-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
      >
        <HugeiconsIcon icon={icon} strokeWidth={2} className={`size-3.5 shrink-0 ${tint}`} />
        <span className="truncate">{label}</span>
      </button>
    </li>
  )
}

export function FlowShortcut() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const onBranch = useRepoStore((s) => s.runBranch)
  const runGitAction = useRepoStore((s) => s.runGitAction)
  const openFlowStart = useRepoStore((s) => s.openFlowStart)

  const { data: flow = null } = useFlowQuery(api, repoId)
  const { data: status } = useStatusQuery(api, repoId)
  const branch = status?.branch ?? null
  const promoted = promotedFlow(branch, flow)
  const finishKind = promoted?.move === "finish" ? promoted.kind : null
  const { data: flowInfo } = useFlowInfoQuery(api, repoId, branch, finishKind)

  if (!promoted) return null

  if (promoted.move === "finish") {
    const { kind, name } = promoted
    return (
      <ul role="list" className="flex flex-col border-b pb-1.5">
        <ShortcutRow
          icon={CheckmarkCircle02Icon}
          tint={FLOW_META[kind].text}
          label={FINISH_NAMED[kind](name)}
          onClick={() => void onBranch("finish", branch!)}
        />
        {flowInfo?.unpushed && (
          <ShortcutRow
            icon={ArrowUp02Icon}
            tint={FLOW_META[kind].text}
            label={PUBLISH_NAMED[kind](name)}
            onClick={() => void runGitAction(() => api.flowPublish(kind, name))}
          />
        )}
      </ul>
    )
  }

  const start = promoted.kind
  return (
    <ul role="list" className="flex flex-col border-b pb-1.5">
      <ShortcutRow
        icon={FLOW_META[start].icon}
        tint={FLOW_META[start].text}
        label={start === "feature" ? messages.menu.startFeature : messages.menu.startHotfix}
        onClick={() => openFlowStart(start)}
      />
    </ul>
  )
}
