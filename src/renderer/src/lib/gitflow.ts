/* Gitflow and branch conventions (AUDIT.md §7, phase 5 — formerly lib/commit-message.ts,
   plus `PINNED`/`pinRank`, moved from refs-sidebar: the two branch-convention tables
   (integration branches to pin, merge targets of a release/hotfix) now live
   in the same place). */

import type { BadgeColor } from "@/components/ui/badge"
import type { FlowPrefixes } from "@/lib/git"
import type { ParsedMerge } from "@/lib/commit-parse"

/** Integration branches come first in the refs tree, in this order. */
export const PINNED = ["master", "main", "develop"]

export const pinRank = (label: string) => {
  const i = PINNED.indexOf(label)
  return i < 0 ? PINNED.length : i
}

export const MAIN_TARGETS = /^(develop|master|main|release\/.+)$/

/* A gitflow release/hotfix lands on master AND develop, with a version tag. The pattern is
   recognized from the merge's source: `release/`|`hotfix/` prefix, or — on the develop side of a
   "merge tag into develop" — the semver tag itself. A semver tag alone doesn't distinguish release
   from hotfix: it falls back to release, the hotfix red coming from its `hotfix/` merges. */
export type FlowKind = "release" | "hotfix"
export const SEMVER = /^v?\d+\.\d+\.\d+/
const RELEASE_BRANCH = /^release\//
const HOTFIX_BRANCH = /^hotfix\//
const FLOW_COLOR: Record<FlowKind, BadgeColor> = { release: "release", hotfix: "danger" }

export function mergeFlow(mg: ParsedMerge): FlowKind | null {
  if (HOTFIX_BRANCH.test(mg.from)) return "hotfix"
  if (RELEASE_BRANCH.test(mg.from)) return "release"
  if (mg.tag && SEMVER.test(mg.from)) return "release"
  return null
}

/* Color of a merge's source chip. The release/hotfix pattern takes priority; otherwise a tag
   stays amber, and a merge into a trunk keeps its teal. */
export function mergeColor(mg: ParsedMerge): BadgeColor {
  const flow = mergeFlow(mg)
  if (flow) return FLOW_COLOR[flow]
  if (mg.tag) return "warning"
  return !mg.noise && mg.to && MAIN_TARGETS.test(mg.to) ? "primary" : "neutral"
}

/** Color of a semver tag placed on a row: red if the row is a hotfix, purple otherwise. */
export const tagFlowColor = (flow: FlowKind | null): BadgeColor => (flow === "hotfix" ? "danger" : "release")

/* --- Work type of a branch --- */

export type BranchFlow = keyof FlowPrefixes

/* Common conventions when git-flow isn't configured: this very repo names its
   branches `fix/…` and `release/…` without ever having seen `git flow init`. */
const BRANCH_PREFIX: [RegExp, BranchFlow][] = [
  [/^(feature|feat)\//, "feature"],
  [/^(bugfix|fix)\//, "bugfix"],
  [RELEASE_BRANCH, "release"],
  [HOTFIX_BRANCH, "hotfix"],
]

/* Work type carried by a branch name: gitflow prefixes if configured,
   otherwise the common conventions. Feeds the context indicators (chip and toolbar
   rail), not the `flow finish` menu — that one requires a real gitflow, see features/refs. */
export function branchFlow(name: string, prefixes: FlowPrefixes | null): BranchFlow | null {
  const flow =
    prefixes &&
    (Object.keys(prefixes) as BranchFlow[]).find((t) => prefixes[t] && name.startsWith(prefixes[t]!))
  return flow || (BRANCH_PREFIX.find(([re]) => re.test(name))?.[1] ?? null)
}
