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
   stays amber, and a merge into a trunk keeps its teal. A PR merge never names its target, but
   it IS a deliberate integration — it rides the same trunk hue. */
export function mergeColor(mg: ParsedMerge): BadgeColor {
  const flow = mergeFlow(mg)
  if (flow) return FLOW_COLOR[flow]
  if (mg.tag) return "warning"
  if (mg.pr !== undefined) return "primary"
  return !mg.noise && mg.to && MAIN_TARGETS.test(mg.to) ? "primary" : "neutral"
}

/** Color of a semver tag placed on a row: red if the row is a hotfix, purple otherwise. */
export const tagFlowColor = (flow: FlowKind | null): BadgeColor => (flow === "hotfix" ? "danger" : "release")

/* --- Suggested start version --- */

/** Strict X.Y.Z only: prereleases ("v2.0.0-rc.1") and free-form tags never seed a suggestion. */
const SEMVER_TAG = /^(v?)(\d+)\.(\d+)\.(\d+)$/

const semverCmp = (a: [number, number, number], b: [number, number, number]) =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2]

/** Version to suggest when starting a release/hotfix, from the latest semver tag (highest by
    numeric order — not tag-list order — with its `v` prefix preserved): a hotfix bumps the
    patch, a release bumps the minor and resets the patch. The major is never bumped.
    `null` when no tag gives a lead. */
export function suggestedFlowVersion(kind: FlowKind, tags: string[]): string | null {
  let latest: { prefix: string; nums: [number, number, number] } | null = null
  for (const tag of tags) {
    const m = SEMVER_TAG.exec(tag)
    if (!m) continue
    const nums: [number, number, number] = [+m[2], +m[3], +m[4]]
    if (!latest || semverCmp(nums, latest.nums) > 0) latest = { prefix: m[1], nums }
  }
  if (!latest) return null
  const [major, minor, patch] = latest.nums
  return kind === "hotfix"
    ? `${latest.prefix}${major}.${minor}.${patch + 1}`
    : `${latest.prefix}${major}.${minor + 1}.0`
}

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
    prefixes && (Object.keys(prefixes) as BranchFlow[]).find((t) => prefixes[t] && name.startsWith(prefixes[t]))
  return flow || (BRANCH_PREFIX.find(([re]) => re.test(name))?.[1] ?? null)
}

/* --- Promoted flow moves --- */

export type StartKind = "feature" | "hotfix" | "release"

export type PromotedFlow =
  /** HEAD sits on a real flow branch (configured prefix matched): finish it. `name` = suffix. */
  | { move: "finish"; kind: BranchFlow; name: string }
  /** HEAD sits on a trunk: start the natural work type — or a release — from that trunk. */
  | { move: "start"; kinds: StartKind[]; base: string }

/** The obvious next gitflow moves from HEAD — shared by the Git Flow menu's promoted section
    and the sidebar shortcut. Requires a real gitflow (`prefixes` from `git flow init`). */
export function promotedFlow(branch: string | null, prefixes: FlowPrefixes | null): PromotedFlow | null {
  if (!branch || !prefixes) return null
  const kind = (Object.keys(prefixes) as BranchFlow[]).find((k) => prefixes[k] && branch.startsWith(prefixes[k]))
  if (kind) return { move: "finish", kind, name: branch.slice(prefixes[kind]!.length) }
  if (branch === "develop") return { move: "start", kinds: ["feature", "release"], base: branch }
  if (branch === "master" || branch === "main") return { move: "start", kinds: ["hotfix", "release"], base: branch }
  return null
}
