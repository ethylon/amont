import {
  ArrowUp02Icon,
  Bug01Icon,
  CheckmarkCircle02Icon,
  Fire02Icon,
  GitBranchIcon,
  RocketIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

import { messages } from "@/lib/messages"
import { promotedFlow, type BranchFlow, type StartKind } from "@/lib/gitflow"
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
const START_LABEL: Record<StartKind, () => string> = {
  feature: () => messages.menu.startFeature,
  release: () => messages.menu.startRelease,
  hotfix: () => messages.menu.startHotfix,
}

/** True when HEAD sits on a real git-flow branch of `kind` (prefix configured and matched);
    returns the suffix (branch name minus prefix), else `null`. */
function currentOf(repo: MenuRepo, kind: BranchFlow): string | null {
  const prefix = repo.flowPrefixes?.[kind]
  if (repo.workFlow !== kind || !repo.branch || !prefix || !repo.branch.startsWith(prefix)) return null
  return repo.branch.slice(prefix.length)
}

/* The promoted section: the obvious next move derived from HEAD (see the design table). A real
   flow branch surfaces Finish (+ Publish while unpushed); a trunk surfaces the matching Start.
   The derivation itself (`promotedFlow`) is shared with the sidebar shortcut. */
function promotedItems(repo: MenuRepo): MenuNode[] {
  const promoted = promotedFlow(repo.branch, repo.flowPrefixes)
  if (!promoted) return []
  if (promoted.move === "finish") {
    const { kind, name } = promoted
    const items: MenuNode[] = [
      {
        kind: "action",
        id: "gitflow.promoted.finish",
        label: FINISH_NAMED[kind](name),
        icon: CheckmarkCircle02Icon,
        run: () => repo.finishFlow(repo.branch!),
      },
    ]
    if (repo.flowInfo?.unpushed)
      items.push({
        kind: "action",
        id: "gitflow.promoted.publish",
        label: PUBLISH_NAMED[kind](name),
        icon: ArrowUp02Icon,
        run: () => repo.publishFlow(kind, name),
      })
    return items
  }
  const { kinds, base } = promoted
  return kinds.map((kind) => ({
    kind: "action",
    id: `gitflow.promoted.start.${kind}`,
    label: START_LABEL[kind](),
    icon: FLOW_ICON[kind],
    run: () => repo.startFlow(kind, base),
  }))
}

/* One type submenu (Feature/Bugfix/…): Start is always available; Finish/Publish act on HEAD and
   only light up when HEAD is on a branch of this very type. */
function typeItems(repo: MenuRepo, kind: BranchFlow): MenuNode[] {
  const name = currentOf(repo, kind)
  return [
    {
      kind: "action",
      id: `gitflow.${kind}.start`,
      label: messages.menu.flowStart,
      icon: GitBranchIcon,
      run: () => repo.startFlow(kind),
    },
    {
      kind: "action",
      id: `gitflow.${kind}.finish`,
      label: messages.menu.flowFinish,
      icon: CheckmarkCircle02Icon,
      disabled: name === null,
      run: () => repo.finishFlow(repo.branch!),
    },
    {
      kind: "action",
      id: `gitflow.${kind}.publish`,
      label: messages.menu.flowPublish,
      icon: ArrowUp02Icon,
      disabled: name === null || !repo.flowInfo?.unpushed,
      run: () => name !== null && repo.publishFlow(kind, name),
    },
  ]
}

/** Git Flow — its own top-level menu (promoted from a Repository submenu so that the common
    Start/Finish/Publish moves sit one level shallower). Greyed off a repo tab; when the repo has
    never run `git flow init`, the whole menu is a single "Initialize Git Flow…" entry. */
export const gitflowMenu: MenuDescriptor = {
  id: "gitflow",
  get label() {
    return messages.menu.gitFlow
  },
  disabled: (ctx) => !ctx.activeRepo,
  build: (ctx) => {
    const repo = ctx.activeRepo
    if (!repo) return []
    if (!repo.flowPrefixes)
      return [
        {
          kind: "action",
          id: "gitflow.init",
          label: messages.menu.initializeGitFlow,
          icon: Settings02Icon,
          run: repo.initFlow,
        },
      ]
    const promoted = promotedItems(repo)
    const grid = FLOW_KINDS.map<MenuNode>((kind) => ({
      kind: "submenu",
      id: `gitflow.${kind}`,
      label: FLOW_LABEL[kind](),
      icon: FLOW_ICON[kind],
      items: typeItems(repo, kind),
    }))
    return promoted.length ? [...promoted, { kind: "separator" }, ...grid] : grid
  },
}
