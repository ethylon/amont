/* Conventions gitflow et branches (AUDIT.md §7, phase 5 — anciennement lib/commit-message.ts,
   plus `PINNED`/`pinRank`, déménagés depuis refs-sidebar : les deux tables de conventions de
   branches (branches d'intégration à épingler, cibles de merge d'une release/hotfix) vivent
   maintenant au même endroit). */

import type { BadgeColor } from "@/components/ui/badge"
import type { FlowPrefixes } from "@/lib/git"
import type { ParsedMerge } from "@/lib/commit-parse"

/** Les branches d'intégration passent devant dans l'arbre des refs, dans cet ordre. */
export const PINNED = ["master", "main", "develop"]

export const pinRank = (label: string) => {
  const i = PINNED.indexOf(label)
  return i < 0 ? PINNED.length : i
}

export const MAIN_TARGETS = /^(develop|master|main|release\/.+)$/

/* Une release/hotfix gitflow atterrit sur master ET develop, avec un tag de version. Le motif se
   reconnaît à la source du merge : préfixe `release/`|`hotfix/`, ou — côté develop du « merge tag
   into develop » — au tag semver lui-même. Un tag semver seul ne distingue pas release de hotfix :
   on retombe sur release, le rouge du hotfix venant de ses merges `hotfix/`. */
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

/* Teinte du chip source d'un merge. Le motif release/hotfix prime ; sinon un tag reste ambre, et
   un merge vers un tronc garde son teal. */
export function mergeColor(mg: ParsedMerge): BadgeColor {
  const flow = mergeFlow(mg)
  if (flow) return FLOW_COLOR[flow]
  if (mg.tag) return "warning"
  return !mg.noise && mg.to && MAIN_TARGETS.test(mg.to) ? "primary" : "neutral"
}

/** Teinte d'un tag semver posé sur une ligne : rouge si la ligne est un hotfix, violet sinon. */
export const tagFlowColor = (flow: FlowKind | null): BadgeColor => (flow === "hotfix" ? "danger" : "release")

/* --- Type de travail d'une branche --- */

export type BranchFlow = keyof FlowPrefixes

/* Conventions usuelles quand git-flow n'est pas configuré : ce dépôt même nomme ses
   branches `fix/…` et `release/…` sans jamais avoir vu `git flow init`. */
const BRANCH_PREFIX: [RegExp, BranchFlow][] = [
  [/^(feature|feat)\//, "feature"],
  [/^(bugfix|fix)\//, "bugfix"],
  [RELEASE_BRANCH, "release"],
  [HOTFIX_BRANCH, "hotfix"],
]

/* Type de travail porté par le nom d'une branche : préfixes gitflow s'ils sont configurés,
   sinon les conventions usuelles. Nourrit les indicateurs de contexte (chip et rail de la
   toolbar), pas le menu `flow finish` — lui exige un vrai gitflow, cf. features/refs. */
export function branchFlow(name: string, prefixes: FlowPrefixes | null): BranchFlow | null {
  const flow =
    prefixes &&
    (Object.keys(prefixes) as BranchFlow[]).find((t) => prefixes[t] && name.startsWith(prefixes[t]!))
  return flow || (BRANCH_PREFIX.find(([re]) => re.test(name))?.[1] ?? null)
}
