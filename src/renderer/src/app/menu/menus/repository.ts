import {
  Analytics01Icon,
  ArrowUp02Icon,
  Bug01Icon,
  CheckmarkCircle02Icon,
  Fire02Icon,
  FlowIcon,
  GitBranchIcon,
  PackageIcon,
  RocketIcon,
  Settings02Icon,
  ShieldIcon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

import { messages } from "@/lib/messages"
import type { BranchFlow } from "@/lib/gitflow"
import type { MenuDescriptor, MenuNode, MenuRepo } from "@/app/menu/types"

/** The four git-flow work types, in the bar order of the type grid. */
const FLOW_KINDS: BranchFlow[] = ["feature", "bugfix", "release", "hotfix"]

const FLOW_ICON: Record<BranchFlow, IconSvgElement> = {
  feature: GitBranchIcon,
  bugfix: Bug01Icon,
  release: RocketIcon,
  hotfix: Fire02Icon,
}

/* Thunks, not values: reading a `messages.*` getter at module scope would run `t` during import,
   before setupI18n() has activated a locale (cf. refs-menu.tsx). The `*Named` entries are plain
   functions (they only call `t` when invoked), so they can be referenced directly. */
const FLOW_LABEL: Record<BranchFlow, () => string> = {
  feature: () => messages.menu.flowFeature,
  bugfix: () => messages.menu.flowBugfix,
  release: () => messages.menu.flowRelease,
  hotfix: () => messages.menu.flowHotfix,
}
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

/** True when HEAD sits on a real git-flow branch of `kind` (prefix configured and matched). */
function currentOf(repo: MenuRepo, kind: BranchFlow): string | null {
  const prefix = repo.flowPrefixes?.[kind]
  if (repo.workFlow !== kind || !repo.branch || !prefix || !repo.branch.startsWith(prefix)) return null
  return repo.branch.slice(prefix.length)
}

/* The promoted section: the obvious next move derived from HEAD (see the design table). A real
   flow branch surfaces Finish (+ Publish while unpushed); a trunk surfaces the matching Start. */
function promotedItems(repo: MenuRepo): MenuNode[] {
  const kind = repo.workFlow
  if (kind && repo.branch) {
    const name = currentOf(repo, kind)
    if (name !== null) {
      const items: MenuNode[] = [
        {
          kind: "action",
          id: "repository.flow.promoted.finish",
          label: FINISH_NAMED[kind](name),
          icon: CheckmarkCircle02Icon,
          run: () => repo.finishFlow(repo.branch!),
        },
      ]
      if (repo.flowInfo?.unpushed)
        items.push({
          kind: "action",
          id: "repository.flow.promoted.publish",
          label: PUBLISH_NAMED[kind](name),
          icon: ArrowUp02Icon,
          run: () => repo.publishFlow(kind, name),
        })
      return items
    }
  }
  if (repo.branch === "develop")
    return [
      {
        kind: "action",
        id: "repository.flow.promoted.startFeature",
        label: messages.menu.startFeature,
        icon: GitBranchIcon,
        run: () => repo.startFlow("feature"),
      },
    ]
  if (repo.branch === "master" || repo.branch === "main")
    return [
      {
        kind: "action",
        id: "repository.flow.promoted.startHotfix",
        label: messages.menu.startHotfix,
        icon: Fire02Icon,
        run: () => repo.startFlow("hotfix"),
      },
    ]
  return []
}

/* One type submenu (Feature/Bugfix/…): Start is always available; Finish/Publish act on HEAD and
   only light up when HEAD is on a branch of this very type. */
function typeItems(repo: MenuRepo, kind: BranchFlow): MenuNode[] {
  const name = currentOf(repo, kind)
  return [
    {
      kind: "action",
      id: `repository.flow.${kind}.start`,
      label: messages.menu.flowStart,
      icon: GitBranchIcon,
      run: () => repo.startFlow(kind),
    },
    {
      kind: "action",
      id: `repository.flow.${kind}.finish`,
      label: messages.menu.flowFinish,
      icon: CheckmarkCircle02Icon,
      disabled: name === null,
      run: () => repo.finishFlow(repo.branch!),
    },
    {
      kind: "action",
      id: `repository.flow.${kind}.publish`,
      label: messages.menu.flowPublish,
      icon: ArrowUp02Icon,
      disabled: name === null || !repo.flowInfo?.unpushed,
      run: () => name !== null && repo.publishFlow(kind, name),
    },
  ]
}

function flowSubmenu(repo: MenuRepo): MenuNode {
  let items: MenuNode[]
  if (!repo.flowPrefixes) {
    items = [
      {
        kind: "action",
        id: "repository.flow.init",
        label: messages.menu.initializeGitFlow,
        icon: Settings02Icon,
        run: repo.initFlow,
      },
    ]
  } else {
    const promoted = promotedItems(repo)
    const grid = FLOW_KINDS.map<MenuNode>((kind) => ({
      kind: "submenu",
      id: `repository.flow.${kind}`,
      label: FLOW_LABEL[kind](),
      icon: FLOW_ICON[kind],
      items: typeItems(repo, kind),
    }))
    items = promoted.length ? [...promoted, { kind: "separator" }, ...grid] : grid
  }
  return { kind: "submenu", id: "repository.gitflow", label: messages.menu.gitFlow, icon: FlowIcon, items }
}

/** Repository ▸ database maintenance and git-flow. The whole menu is greyed off a repo tab
    (`disabled`); its items only build when a repository is in the foreground. */
export const repositoryMenu: MenuDescriptor = {
  id: "repository",
  get label() {
    return messages.menu.repository
  },
  disabled: (ctx) => !ctx.activeRepo,
  build: (ctx) => {
    const repo = ctx.activeRepo
    if (!repo) return []
    return [
      {
        kind: "action",
        id: "repository.stats",
        label: messages.menu.databaseStatistics,
        icon: Analytics01Icon,
        run: repo.openStats,
      },
      {
        kind: "action",
        id: "repository.verify",
        label: messages.menu.verifyDatabase,
        icon: ShieldIcon,
        run: repo.verifyDatabase,
      },
      {
        kind: "action",
        id: "repository.compact",
        label: messages.menu.compactDatabase,
        icon: PackageIcon,
        run: repo.compactDatabase,
      },
      { kind: "separator" },
      flowSubmenu(repo),
    ]
  },
}
