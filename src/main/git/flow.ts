/* Git-flow (AUDIT.md §4) : préfixes de `git flow init`, contexte read-only de la branche
   courante (cockpit, carte de contexte), et `finish` (fix B2 : rejette les suffixes en `-`,
   qui se feraient passer pour une option de git-flow — cf. computeNextTag/flowVersionSuffix
   dans git/parse.ts pour la partie pure, testée isolément). */

import { AppError } from "../../shared/errors.ts"
import type { FlowInfo, FlowPrefixes } from "../../shared/types.ts"
import type { RepoHandle } from "../repos.ts"
import { OP_TIMEOUT } from "./exec.ts"
import { computeNextTag, flowVersionSuffix, parseFlowPrefixes } from "./parse.ts"

export const FLOW_TYPES = ["feature", "bugfix", "release", "hotfix"] as const

/** Les préfixes posés par `git flow init` dans la config, ou `null` : le dépôt ignore git-flow. */
export async function flowPrefixes(r: RepoHandle): Promise<FlowPrefixes | null> {
  const out = await r.git(["config", "--get-regexp", "^gitflow\\.prefix\\."]).catch(() => "")
  const prefixes = parseFlowPrefixes(out)
  return FLOW_TYPES.some((t) => prefixes[t]) ? prefixes : null
}

const cfgOf = (r: RepoHandle, key: string): Promise<string> =>
  r.git(["config", "--get", key]).then((o) => o.trim(), () => "")

/* --- Contexte de flow de la branche courante ---
   Lecture seule : ce que la branche a produit et où son finish atterrira. Le renderer classe
   la branche (préfixes gitflow ou conventions) ; main ne fait que mesurer. */
export async function flowInfo(r: RepoHandle, branch: string, kind: keyof FlowPrefixes): Promise<FlowInfo | null> {
  const [headsOut, cfgMaster, cfgDevelop] = await Promise.all([
    r.git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    cfgOf(r, "gitflow.branch.master"),
    cfgOf(r, "gitflow.branch.develop"),
  ])
  const heads = new Set(headsOut.split("\n").filter(Boolean))
  const master = cfgMaster || ["master", "main"].find((b) => heads.has(b)) || null
  const develop = cfgDevelop || (heads.has("develop") ? "develop" : null)
  /* un hotfix part du tronc de production, tout le reste du tronc d'intégration */
  const parent = kind === "hotfix" ? master : develop ?? master
  if (!parent || !heads.has(parent) || parent === branch) return null

  const tagged = kind === "release" || kind === "hotfix"
  /* ponytail: describe prend le tag le plus proche, semver ou non — le bump s'en protège par regex */
  const [commits, lastTag] = await Promise.all([
    r.git(["rev-list", "--count", `${parent}..${branch}`]).then((o) => parseInt(o, 10)),
    tagged ? r.git(["describe", "--tags", "--abbrev=0", branch]).then((o) => o.trim(), () => null) : Promise.resolve(null),
  ])
  const startedAt = commits
    ? parseInt((await r.git(["log", "--format=%ct", "--reverse", `${parent}..${branch}`])).split("\n", 1)[0], 10)
    : null

  /* le tag du finish : gitflow nomme la branche par sa version ; sinon, bump du dernier tag —
     patch pour un hotfix, minor pour une release */
  let nextTag: string | null = null
  if (kind === "release" || kind === "hotfix") {
    const prefixes = (await flowPrefixes(r)) ?? {}
    const prefix = prefixes[kind] && branch.startsWith(prefixes[kind]) ? prefixes[kind] : `${kind}/`
    /* même garde que finish : un suffixe en `-…` n'est jamais une version */
    nextTag = computeNextTag(kind, flowVersionSuffix(branch, prefix), lastTag)
  }

  return {
    commits,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    base: lastTag ?? parent,
    targets: tagged ? [master, develop].filter((x): x is string => x !== null) : [parent],
    nextTag,
  }
}

/* `git flow` fait tout — merge, tag, back-merge, suppression de la branche. Le réimplémenter,
   c'est s'écarter en silence de la sémantique que l'utilisateur attend de son outil.
   ponytail: l'extension n'est pas installée ? le message de git le dira au clic. */
export async function finishFlow(r: RepoHandle, name: string): Promise<void> {
  const prefixes = (await flowPrefixes(r)) ?? {}
  const type = FLOW_TYPES.find((t) => prefixes[t] && name.startsWith(prefixes[t]!))
  if (!type) throw new AppError("NOT_FLOW_BRANCH", name)
  const version = name.slice(prefixes[type]!.length)
  /* BRANCH n'interdit le `-` qu'en tête du nom complet : `feature/-D` donnerait
     version = '-D', que git-flow lirait comme une option (suppression forcée) — fix B2 */
  if (version.startsWith("-")) throw new AppError("BAD_ARG", name)
  /* release et hotfix posent un tag annoté : sans `-m`, `git tag -a` réclamerait un éditeur */
  const tagged = type === "release" || type === "hotfix"
  await r.git(["flow", type, "finish", ...(tagged ? ["-m", version] : []), version], { timeout: OP_TIMEOUT })
}
