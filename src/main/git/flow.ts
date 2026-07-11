/* Git-flow (AUDIT.md §4): prefixes from `git flow init`, read-only context of the current
   branch (cockpit, context card), and `finish` (fix B2: rejects suffixes starting with `-`,
   which could pass themselves off as a git-flow option — cf. computeNextTag/flowVersionSuffix
   in git/parse.ts for the pure part, tested in isolation). */

import { AppError } from "../../shared/errors.ts"
import type { FlowInfo, FlowPrefixes } from "../../shared/types.ts"
import type { RepoHandle } from "../repos.ts"
import { OP_TIMEOUT } from "./exec.ts"
import { computeNextTag, flowVersionSuffix, parseFlowPrefixes } from "./parse.ts"

export const FLOW_TYPES = ["feature", "bugfix", "release", "hotfix"] as const

/** The prefixes set by `git flow init` in the config, or `null`: the repo doesn't use git-flow. */
export async function flowPrefixes(r: RepoHandle): Promise<FlowPrefixes | null> {
  const out = await r.git(["config", "--get-regexp", "^gitflow\\.prefix\\."]).catch(() => "")
  const prefixes = parseFlowPrefixes(out)
  return FLOW_TYPES.some((t) => prefixes[t]) ? prefixes : null
}

const cfgOf = (r: RepoHandle, key: string): Promise<string> =>
  r.git(["config", "--get", key]).then((o) => o.trim(), () => "")

/* --- Flow context of the current branch ---
   Read-only: what the branch has produced and where its finish will land. The renderer
   classifies the branch (gitflow prefixes or conventions); main only measures. */
export async function flowInfo(r: RepoHandle, branch: string, kind: keyof FlowPrefixes): Promise<FlowInfo | null> {
  const [headsOut, cfgMaster, cfgDevelop] = await Promise.all([
    r.git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    cfgOf(r, "gitflow.branch.master"),
    cfgOf(r, "gitflow.branch.develop"),
  ])
  const heads = new Set(headsOut.split("\n").filter(Boolean))
  const master = cfgMaster || ["master", "main"].find((b) => heads.has(b)) || null
  const develop = cfgDevelop || (heads.has("develop") ? "develop" : null)
  /* a hotfix branches off the production trunk, everything else off the integration trunk */
  const parent = kind === "hotfix" ? master : develop ?? master
  if (!parent || !heads.has(parent) || parent === branch) return null

  const tagged = kind === "release" || kind === "hotfix"
  /* describe returns the nearest tag, semver or not — the bump logic guards against that with a regex */
  const [commits, lastTag] = await Promise.all([
    r.git(["rev-list", "--count", `${parent}..${branch}`]).then((o) => parseInt(o, 10)),
    tagged ? r.git(["describe", "--tags", "--abbrev=0", branch]).then((o) => o.trim(), () => null) : Promise.resolve(null),
  ])
  const startedAt = commits
    ? parseInt((await r.git(["log", "--format=%ct", "--reverse", `${parent}..${branch}`])).split("\n", 1)[0], 10)
    : null

  /* the finish tag: gitflow names the branch after its version; otherwise, bump the last tag —
     patch for a hotfix, minor for a release */
  let nextTag: string | null = null
  if (kind === "release" || kind === "hotfix") {
    const prefixes = (await flowPrefixes(r)) ?? {}
    const prefix = prefixes[kind] && branch.startsWith(prefixes[kind]) ? prefixes[kind] : `${kind}/`
    /* same guard as finish: a suffix starting with `-…` is never a version */
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

/* `git flow` does everything — merge, tag, back-merge, branch deletion. Reimplementing it means
   silently drifting from the semantics the user expects from their tool. If the extension isn't
   installed, git's own error message will say so when the user clicks. */
export async function finishFlow(r: RepoHandle, name: string): Promise<void> {
  const prefixes = (await flowPrefixes(r)) ?? {}
  const type = FLOW_TYPES.find((t) => prefixes[t] && name.startsWith(prefixes[t]!))
  if (!type) throw new AppError("NOT_FLOW_BRANCH", name)
  const version = name.slice(prefixes[type]!.length)
  /* BRANCH only forbids `-` at the start of the full name: `feature/-D` would give
     version = '-D', which git-flow would read as an option (forced deletion) — fix B2 */
  if (version.startsWith("-")) throw new AppError("BAD_ARG", name)
  /* release and hotfix create an annotated tag: without `-m`, `git tag -a` would prompt for an editor */
  const tagged = type === "release" || type === "hotfix"
  await r.git(["flow", type, "finish", ...(tagged ? ["-m", version] : []), version], { timeout: OP_TIMEOUT })
}
