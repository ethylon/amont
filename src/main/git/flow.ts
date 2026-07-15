/* Git-flow (AUDIT.md §4): prefixes from `git flow init`, read-only context of the current
   branch (cockpit, context card), and `finish` (fix B2: rejects suffixes starting with `-`,
   which could pass themselves off as a git-flow option — cf. computeNextTag/flowVersionSuffix
   in git/parse.ts for the pure part, tested in isolation). */

import { AppError } from "../../shared/errors.ts"
import type { FlowInfo, FlowInitConfig, FlowKind, FlowPrefixes } from "../../shared/types.ts"
import { withLock, type RepoHandle } from "../repos.ts"
import { OP_TIMEOUT } from "./exec.ts"
import { BRANCH, computeNextTag, flowInitConfigArgs, flowVersionSuffix, parseFlowPrefixes } from "./parse.ts"

export const FLOW_TYPES = ["feature", "bugfix", "release", "hotfix"] as const

/** The prefixes set by `git flow init` in the config, or `null`: the repo doesn't use git-flow. */
export async function flowPrefixes(r: RepoHandle): Promise<FlowPrefixes | null> {
  const out = await r.git(["config", "--get-regexp", "^gitflow\\.prefix\\."]).catch(() => "")
  const prefixes = parseFlowPrefixes(out)
  return FLOW_TYPES.some((t) => prefixes[t]) ? prefixes : null
}

const cfgOf = (r: RepoHandle, key: string): Promise<string> =>
  r.git(["config", "--get", key]).then(
    (o) => o.trim(),
    () => ""
  )

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
  const parent = kind === "hotfix" ? master : (develop ?? master)
  if (!parent || !heads.has(parent) || parent === branch) return null

  const tagged = kind === "release" || kind === "hotfix"
  /* "produced by the branch" = commits reachable from it but from no integration trunk. Measuring
     against the flow's canonical trunk alone (`develop` for a bugfix) over-counts when that trunk
     is stale and the branch was actually cut from another: a `develop` sitting 60 commits behind
     `master` would make a two-commit fix branched off `master` report 62. Excluding every trunk
     keeps the count and the start date on the branch's own work. */
  const trunks = [master, develop].filter((t): t is string => !!t && t !== branch)
  const ownWork = [branch, ...trunks.map((t) => `^${t}`)]
  /* describe returns the nearest tag, semver or not — the bump logic guards against that with a regex */
  const [commits, lastTag] = await Promise.all([
    r.git(["rev-list", "--count", ...ownWork]).then((o) => parseInt(o, 10)),
    tagged
      ? r.git(["describe", "--tags", "--abbrev=0", branch]).then(
          (o) => o.trim(),
          () => null
        )
      : Promise.resolve(null),
  ])
  const startedAt = commits
    ? parseInt((await r.git(["log", "--format=%ct", "--reverse", ...ownWork])).split("\n", 1)[0], 10)
    : null

  /* "unpushed": the branch has no remote-tracking counterpart yet — `@{upstream}` resolves only
     once it does (git-flow `publish` sets it). A quiet failure is the nominal "never published" case. */
  const unpushed = !(await r.git(["rev-parse", "--verify", "-q", `${branch}@{upstream}`]).then(
    (o) => !!o.trim(),
    () => false
  ))

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
    unpushed,
  }
}

/* `git flow` does everything — merge, tag, back-merge, branch deletion. Reimplementing it means
   silently drifting from the semantics the user expects from their tool. If the extension isn't
   installed, git's own error message will say so when the user clicks. */
export async function finishFlow(r: RepoHandle, name: string): Promise<void> {
  const prefixes = (await flowPrefixes(r)) ?? {}
  const type = FLOW_TYPES.find((t) => prefixes[t] && name.startsWith(prefixes[t]))
  if (!type) throw new AppError("NOT_FLOW_BRANCH", name)
  const version = name.slice(prefixes[type]!.length)
  /* BRANCH only forbids `-` at the start of the full name: `feature/-D` would give
     version = '-D', which git-flow would read as an option (forced deletion) — fix B2 */
  if (version.startsWith("-")) throw new AppError("BAD_ARG", name)
  /* release and hotfix create an annotated tag: without `-m`, `git tag -a` would prompt for an editor */
  const tagged = type === "release" || type === "hotfix"
  await r.git(["flow", type, "finish", ...(tagged ? ["-m", version] : []), version], { timeout: OP_TIMEOUT })
}

/* Same option-injection guard as `finishFlow` (fix B2): the name/version comes straight from a
   text field, so a value like `-D` (or a full name resolving to one) must never reach git-flow as
   an option. We validate the *full* branch name with the shared BRANCH filter. */
function flowSuffix(prefixes: FlowPrefixes | null, kind: FlowKind, x: string): { prefix: string; name: string } {
  const prefix = (prefixes ?? {})[kind] ?? `${kind}/`
  const name = typeof x === "string" ? x.trim() : ""
  if (!name || name.startsWith("-") || !BRANCH.test(prefix + name)) throw new AppError("BAD_ARG", x)
  return { prefix, name }
}

/* Optional start point of a `flow start`: same `-`/option-injection guard as the name (fix B2),
   and the full ref name is validated with the shared BRANCH filter. Empty or absent means "let
   git-flow pick its own default trunk" — no positional base is appended. */
function flowStartBase(x: string | undefined): string | null {
  const base = typeof x === "string" ? x.trim() : ""
  if (!base) return null
  if (base.startsWith("-") || !BRANCH.test(base)) throw new AppError("BAD_ARG", base)
  return base
}

/** `git flow <kind> start <name|version> [<base>]` — branch off `base` (default trunk when
    omitted). No tag or editor at start (that only happens at finish), so nothing can hang here. */
export async function flowStart(r: RepoHandle, kind: FlowKind, x: string, base?: string): Promise<void> {
  if (!FLOW_TYPES.includes(kind)) throw new AppError("BAD_ARG", "kind")
  const { name } = flowSuffix(await flowPrefixes(r), kind, x)
  const from = flowStartBase(base)
  await withLock(r, `flow ${kind} start`, () =>
    r.git(["flow", kind, "start", name, ...(from ? [from] : [])], { timeout: OP_TIMEOUT }).then(() => {})
  )
}

/** `git flow <kind> publish <name>` — push the flow branch and set its upstream. */
export async function flowPublish(r: RepoHandle, kind: FlowKind, x: string): Promise<void> {
  if (!FLOW_TYPES.includes(kind)) throw new AppError("BAD_ARG", "kind")
  const { name } = flowSuffix(await flowPrefixes(r), kind, x)
  await withLock(r, `flow ${kind} publish`, () =>
    r.git(["flow", kind, "publish", name], { timeout: OP_TIMEOUT }).then(() => {})
  )
}

/** Initialize git-flow non-interactively: `git flow init` prompts (and would hang without a TTY),
    so we write the `gitflow.*` config from the form ourselves, then run `git flow init -d` to let
    it finish the wiring against those values. Every value is guarded against `-` injection, and
    `flowPrefixes` is re-read afterwards to confirm it took. */
export async function flowInit(r: RepoHandle, cfg: FlowInitConfig): Promise<FlowPrefixes | null> {
  const pairs = flowInitConfigArgs(cfg)
  /* trunk names must be real branch names; prefixes/versiontag may be empty (no prefix) but never
     an option-injecting `-…` */
  for (const [key, value] of pairs) {
    if (typeof value !== "string" || value.startsWith("-")) throw new AppError("BAD_ARG", key)
    const required = key === "gitflow.branch.master" || key === "gitflow.branch.develop"
    if (required && (!value || !BRANCH.test(value))) throw new AppError("BAD_ARG", key)
  }
  await withLock(r, "flow init", async () => {
    for (const [key, value] of pairs) await r.git(["config", key, value])
    await r.git(["flow", "init", "-d"], { timeout: OP_TIMEOUT })
  })
  return flowPrefixes(r)
}
