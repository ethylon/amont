/* Git-flow (AUDIT.md §4): prefixes from `git flow init`, read-only context of the current
   branch (cockpit, context card), and the flow operations themselves — start, publish,
   finish, init.

   The operations are native sequences of plain git commands, not calls to the `git flow`
   extension. The extension is a shell script: on Windows every invocation pays bash/MSYS
   plus dozens of git subprocesses, turning a `finish` into seconds of wall clock. The
   sequences below reproduce git-flow AVH 1.12.x (cmd_start/cmd_publish/cmd_finish and
   _finish_from_develop/_finish_base, checked against the shell source) — same guards, same
   command order, same cleanup — so the history produced is indistinguishable from the
   extension's. Two deliberate departures: no implicit `git fetch` before a finish (AVH dies
   offline; we check against the last known remote-tracking refs instead), and no
   "one release/hotfix at a time" guard (parallel releases are a supported workflow here).
   AVH's gitflow hooks (pre/post-flow-*) and `gitflow.<cmd>.*` config overrides are not
   honored: the UI's explicit options are the single source of truth, as before (fix B2's
   option-injection guards all still apply — a suffix starting with `-` never reaches git). */

import { AppError } from "../../shared/errors.ts"
import type { FlowFinishOpts, FlowInfo, FlowInitConfig, FlowKind, FlowPrefixes } from "../../shared/types.ts"
import { withLock, type RepoHandle } from "../repos.ts"
import { mute } from "../watcher.ts"
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

/* --- Native primitives (parity with gitflow-common's helpers) --- */

/** Sha of a ref, or `null` when it doesn't resolve. */
const shaOf = (r: RepoHandle, ref: string): Promise<string | null> =>
  r.git(["rev-parse", "--verify", "-q", ref]).then(
    (o) => o.trim() || null,
    () => null
  )

/** `git merge-base --is-ancestor`: true when `a` is reachable from `b`. */
const isAncestor = (r: RepoHandle, a: string, b: string): Promise<boolean> =>
  r.git(["merge-base", "--is-ancestor", a, b]).then(
    () => true,
    () => false
  )

const originOf = (r: RepoHandle): Promise<string> => cfgOf(r, "gitflow.origin").then((o) => o || "origin")

/** `require_branches_equal` parity, without the pre-fetch: a branch behind or diverged from
    its remote-tracking ref is refused, a branch ahead passes (AVH only warns there). The
    check runs against the last fetched state — a finish stays instant, and possible, offline. */
async function requireNotBehindRemote(r: RepoHandle, origin: string, branch: string): Promise<void> {
  const remoteRef = `refs/remotes/${origin}/${branch}`
  if (!(await shaOf(r, remoteRef))) return
  if (!(await isAncestor(r, remoteRef, `refs/heads/${branch}`))) throw new AppError("DIVERGED", branch)
}

/** The two trunks, from the config `git flow init` wrote — with the same fallbacks as
    `flowInfo` for a repo whose config lost them. */
async function trunksOf(r: RepoHandle): Promise<{ master: string; develop: string; heads: Set<string> }> {
  const [headsOut, cfgMaster, cfgDevelop] = await Promise.all([
    r.git(["for-each-ref", "--format=%(refname:short)", "refs/heads"]),
    cfgOf(r, "gitflow.branch.master"),
    cfgOf(r, "gitflow.branch.develop"),
  ])
  const heads = new Set(headsOut.split("\n").filter(Boolean))
  const master = cfgMaster || ["master", "main"].find((b) => heads.has(b)) || "master"
  const develop = cfgDevelop || "develop"
  return { master, develop, heads }
}

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

/* --- Finish --- */

/** Generic finish (branch context menu): AVH defaults per kind — a feature/bugfix is merged
    into its base (fast-forward when it's a single commit) and deleted; a release/hotfix goes
    through the full merge + tag + back-merge sequence. */
export async function finishFlow(r: RepoHandle, name: string): Promise<void> {
  const { type, version } = flowTypeOf(name, (await flowPrefixes(r)) ?? {})
  if (type === "release" || type === "hotfix") await finishTagged(r, name, type, version)
  else await finishMerge(r, name, { noFF: false, deleteBranch: true })
}

/** Splits a full flow branch name into its configured type and suffix, with the same
    option-injection guard as the other flow entry points (fix B2). */
function flowTypeOf(name: string, prefixes: FlowPrefixes): { type: FlowKind; version: string } {
  const type = FLOW_TYPES.find((t) => prefixes[t] && name.startsWith(prefixes[t]))
  if (!type) throw new AppError("NOT_FLOW_BRANCH", name)
  const version = name.slice(prefixes[type]!.length)
  /* BRANCH only forbids `-` at the start of the full name: `feature/-D` would give
     version = '-D', which downstream commands would read as an option — fix B2 */
  if (version.startsWith("-")) throw new AppError("BAD_ARG", name)
  return { type, version }
}

/* Finish of a feature/bugfix with the banner's options. The merge path forces `--no-ff` (the
   option the banner promises); the rebase path is the one finish shape gitflow could not
   express. Locked and traced like `branchAction`'s finish. */
export async function finishFeature(r: RepoHandle, name: string, opts: FlowFinishOpts): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  const { type } = flowTypeOf(name, (await flowPrefixes(r)) ?? {})
  if (type !== "feature" && type !== "bugfix") throw new AppError("BAD_ARG", name)
  await withLock(r, `flow ${type} finish`, async () => {
    r.events.trace({ kind: "group", text: `Finish ${name}`, ts: Date.now() })
    try {
      if (opts.rebase) await finishRebase(r, name, opts.deleteBranch)
      else await finishMerge(r, name, { noFF: true, deleteBranch: opts.deleteBranch })
    } finally {
      mute(r)
    }
  })
}

interface FinishMergeOpts {
  /** Always create a merge commit; `false` = AVH's default, fast-forward when the branch
      is a single commit ahead of its base. */
  noFF: boolean
  deleteBranch: boolean
}

/* Native `git flow feature|bugfix finish`, merge path (AVH cmd_finish): merge into the base
   recorded at start, then gitflow-parity cleanup — remote branch deleted before the local one,
   recorded base dropped. Idempotent: after a merge conflict resolved and committed by hand, a
   re-run sees the branch already merged and goes straight to the cleanup (AVH does the same
   through its MERGE_BASE state file — the ancestry check makes the file unnecessary). */
async function finishMerge(r: RepoHandle, branch: string, opts: FinishMergeOpts): Promise<void> {
  const origin = await originOf(r)
  const base =
    (await cfgOf(r, `gitflow.branch.${branch}.base`)) || (await cfgOf(r, "gitflow.branch.develop")) || "develop"
  const branchRef = `refs/heads/${branch}`
  const remoteRef = `refs/remotes/${origin}/${branch}`
  const remote = await shaOf(r, remoteRef)
  if (remote && !(await isAncestor(r, remoteRef, branchRef))) throw new AppError("DIVERGED", branch)
  await requireNotBehindRemote(r, origin, base)

  const merged = await isAncestor(r, branchRef, `refs/heads/${base}`)
  await r.git(["checkout", base])
  if (!merged) {
    /* AVH fast-forwards a single-commit branch unless --no-ff: `rev-list -n2` and count */
    const single =
      !opts.noFF &&
      (await r.git(["rev-list", "-n2", `${base}..${branch}`])).split("\n").filter(Boolean).length === 1
    await r.git(["merge", single ? "--ff" : "--no-ff", branch], { timeout: OP_TIMEOUT })
  }
  if (opts.deleteBranch) {
    /* remote first, like gitflow — the local delete then never warns about an unmerged remote */
    if (remote) await r.git(["push", origin, "--delete", branch], { timeout: OP_TIMEOUT })
    await r.git(["branch", "-d", branch])
  }
  await r.git(["config", "--unset", `gitflow.branch.${branch}.base`]).catch(() => {})
}

/* Native `git flow release|hotfix finish` (AVH _finish_from_develop): merge into master, tag,
   then back-merge THE TAG into develop — the tag, not the branch, so `git describe` on develop
   stays anchored to the release (AVH lines 164-172; merging the branch instead is the drift
   that would be invisible in the graph but break describe). Every step is guarded by what
   already exists — merge by ancestry, tag by presence — so a re-run after a conflict resolved
   by hand resumes exactly where it stopped, AVH's own idempotence. A branch started from a
   non-standard base (a support branch) gets the _finish_base shape: merge + tag into that
   base only, no back-merge. */
async function finishTagged(r: RepoHandle, branch: string, kind: "release" | "hotfix", version: string): Promise<void> {
  const [origin, { master, develop, heads }] = await Promise.all([originOf(r), trunksOf(r)])
  const base = (await cfgOf(r, `gitflow.branch.${branch}.base`)) || (kind === "hotfix" ? master : develop)
  const standard = base === (kind === "hotfix" ? master : develop)
  const target = standard ? master : base
  const backmerge = standard && develop !== target && heads.has(develop) ? develop : null
  if (!heads.has(target)) throw new AppError("BAD_ARG", target)

  const tag = (await cfgOf(r, "gitflow.prefix.versiontag")) + version
  const branchRef = `refs/heads/${branch}`
  const remote = await shaOf(r, `refs/remotes/${origin}/${branch}`)
  if (remote && !(await isAncestor(r, `refs/remotes/${origin}/${branch}`, branchRef))) {
    throw new AppError("DIVERGED", branch)
  }
  await requireNotBehindRemote(r, origin, target)
  if (backmerge) await requireNotBehindRemote(r, origin, backmerge)

  const merged = await isAncestor(r, branchRef, `refs/heads/${target}`)
  const tagSha = await shaOf(r, `refs/tags/${tag}`)
  /* a leftover tag of the same name would silently mis-anchor the back-merge */
  if (tagSha && !merged) throw new AppError("EXISTS", tag)
  /* AVH refuses a hotfix with no commits ("You need some commits") — an empty merge and a
     tag pointing at master's own HEAD would be pure noise */
  if (kind === "hotfix" && !tagSha && (await shaOf(r, branchRef)) === (await shaOf(r, `refs/heads/${target}`)))
    throw new AppError("GIT_FAILED", `${branch} has no commits yet`)

  if (!merged) {
    await r.git(["checkout", target])
    await r.git(["merge", "--no-ff", branch], { timeout: OP_TIMEOUT })
  }
  /* annotated tag on the merge commit; `-m` because without a TTY `git tag -a` would want an editor */
  if (!tagSha) await r.git(["tag", "-a", tag, "-m", version, target])

  if (backmerge && !(await isAncestor(r, `refs/tags/${tag}`, `refs/heads/${backmerge}`))) {
    await r.git(["checkout", backmerge])
    await r.git(["merge", "--no-ff", tag], { timeout: OP_TIMEOUT })
  }

  /* cleanup, remote first like gitflow; never delete from under HEAD */
  const current = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
  if (current === branch) await r.git(["checkout", backmerge ?? target])
  if (remote) await r.git(["push", origin, "--delete", branch], { timeout: OP_TIMEOUT })
  await r.git(["branch", "-d", branch])
  await r.git(["config", "--unset", `gitflow.branch.${branch}.base`]).catch(() => {})
}

/* Rebase + fast-forward: the one finish shape `git flow` could not produce — without `--no-ff`
   it still merge-commits any branch more than one commit ahead of its base (checked against
   git-flow AVH 1.12.x, cmd_finish), so this path predates the native rewrite. It mirrors
   finish's own guards and cleanup: refuse when the published branch diverged from its remote
   (require_branches_equal), delete the remote branch along with the local one
   (helper_finish_cleanup), drop the recorded base (gitflow_config_remove_base_branch).
   Stricter than finishMerge on the remote check — a rebase rewrites the commits, so even a
   branch merely ahead of its remote is refused. */
async function finishRebase(r: RepoHandle, name: string, deleteBranch: boolean): Promise<void> {
  const [branchBase, develop, origin] = await Promise.all([
    cfgOf(r, `gitflow.branch.${name}.base`),
    cfgOf(r, "gitflow.branch.develop"),
    cfgOf(r, "gitflow.origin"),
  ])
  const base = branchBase || develop || "develop"
  const remoteRef = `refs/remotes/${origin || "origin"}/${name}`
  const [remote, local] = await Promise.all([
    r.git(["rev-parse", "--verify", "-q", remoteRef]).then(
      (o) => o.trim(),
      () => null
    ),
    r.git(["rev-parse", "--verify", "-q", `refs/heads/${name}`]).then((o) => o.trim()),
  ])
  if (remote && remote !== local) throw new AppError("DIVERGED", name)

  await r.git(["rebase", base, name], { timeout: OP_TIMEOUT })
  await r.git(["checkout", base])
  await r.git(["merge", "--ff-only", name], { timeout: OP_TIMEOUT })
  if (deleteBranch) {
    /* remote first, like gitflow — the local delete then never warns about an unmerged remote */
    if (remote) await r.git(["push", origin || "origin", "--delete", name], { timeout: OP_TIMEOUT })
    await r.git(["branch", "-d", name])
  }
  await r.git(["config", "--unset", `gitflow.branch.${name}.base`]).catch(() => {})
}

/* --- Start / publish --- */

/* Same option-injection guard as `finishFlow` (fix B2): the name/version comes straight from a
   text field, so a value like `-D` (or a full name resolving to one) must never reach git as
   an option. We validate the *full* branch name with the shared BRANCH filter. */
function flowSuffix(prefixes: FlowPrefixes | null, kind: FlowKind, x: string): { prefix: string; name: string } {
  const prefix = (prefixes ?? {})[kind] ?? `${kind}/`
  const name = typeof x === "string" ? x.trim() : ""
  if (!name || name.startsWith("-") || !BRANCH.test(prefix + name)) throw new AppError("BAD_ARG", x)
  return { prefix, name }
}

/* Optional start point of a `flow start`: same `-`/option-injection guard as the name (fix B2),
   and the full ref name is validated with the shared BRANCH filter. Empty or absent means
   "the kind's default trunk" — develop, master for a hotfix. */
function flowStartBase(x: string | undefined): string | null {
  const base = typeof x === "string" ? x.trim() : ""
  if (!base) return null
  if (base.startsWith("-") || !BRANCH.test(base)) throw new AppError("BAD_ARG", base)
  return base
}

/** Native `git flow <kind> start` (AVH cmd_start): record the base, branch off it. AVH's
    "one release/hotfix at a time" guard is deliberately not reproduced — parallel releases
    are a supported workflow here. */
export async function flowStart(r: RepoHandle, kind: FlowKind, x: string, base?: string): Promise<void> {
  if (!FLOW_TYPES.includes(kind)) throw new AppError("BAD_ARG", "kind")
  const { prefix, name } = flowSuffix(await flowPrefixes(r), kind, x)
  const branch = prefix + name
  const from = flowStartBase(base)
  await withLock(r, `flow ${kind} start`, async () => {
    const [origin, { master, develop, heads }] = await Promise.all([originOf(r), trunksOf(r)])
    const trunk = from ?? (kind === "hotfix" ? master : develop)
    if (!heads.has(trunk)) throw new AppError("BAD_ARG", trunk)
    if ((await shaOf(r, `refs/heads/${branch}`)) || (await shaOf(r, `refs/remotes/${origin}/${branch}`)))
      throw new AppError("EXISTS", branch)
    if (kind === "release" || kind === "hotfix") {
      /* the tag this branch will create at finish must still be free */
      const tag = (await cfgOf(r, "gitflow.prefix.versiontag")) + name
      if (await shaOf(r, `refs/tags/${tag}`)) throw new AppError("EXISTS", tag)
    }
    /* a trunk behind its remote would start the work on stale history */
    await requireNotBehindRemote(r, origin, trunk)
    await r.git(["config", `gitflow.branch.${branch}.base`, trunk])
    await r.git(["checkout", "-b", branch, trunk])
  })
}

/** Native `git flow <kind> publish` (AVH cmd_publish): push with upstream, then check the
    branch out like gitflow does. The fetch keeps the "remote already exists" check honest. */
export async function flowPublish(r: RepoHandle, kind: FlowKind, x: string): Promise<void> {
  if (!FLOW_TYPES.includes(kind)) throw new AppError("BAD_ARG", "kind")
  const { prefix, name } = flowSuffix(await flowPrefixes(r), kind, x)
  const branch = prefix + name
  await withLock(r, `flow ${kind} publish`, async () => {
    const origin = await originOf(r)
    if (!(await shaOf(r, `refs/heads/${branch}`))) throw new AppError("BAD_ARG", branch)
    await r.git(["fetch", origin], { timeout: OP_TIMEOUT })
    if (await shaOf(r, `refs/remotes/${origin}/${branch}`)) throw new AppError("EXISTS", `${origin}/${branch}`)
    await r.git(["push", "-u", origin, `${branch}:${branch}`], { timeout: OP_TIMEOUT })
    await r.git(["checkout", branch])
  })
}

/** Initialize git-flow natively: write the `gitflow.*` config from the form, then the wiring
    `git flow init -d` used to do — create the trunks that don't exist yet (from their remote
    counterpart when there is one), seed an empty repo, land on develop. */
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
    const origin = await originOf(r)
    const heads = new Set(
      (await r.git(["for-each-ref", "--format=%(refname:short)", "refs/heads"])).split("\n").filter(Boolean)
    )
    if (!heads.has(cfg.master)) {
      if (await shaOf(r, `refs/remotes/${origin}/${cfg.master}`)) {
        await r.git(["branch", cfg.master, `${origin}/${cfg.master}`])
      } else if (await shaOf(r, "HEAD")) {
        /* commits exist but the named production trunk doesn't: not ours to invent */
        throw new AppError("BAD_ARG", cfg.master)
      } else {
        /* empty repo: seed it so the trunks have something to point at, like `git flow init` */
        await r.git(["symbolic-ref", "HEAD", `refs/heads/${cfg.master}`])
        await r.git(["commit", "--allow-empty", "-m", "Initial commit"])
      }
    }
    if (!heads.has(cfg.develop)) {
      if (await shaOf(r, `refs/remotes/${origin}/${cfg.develop}`)) {
        await r.git(["branch", cfg.develop, `${origin}/${cfg.develop}`])
      } else {
        await r.git(["branch", "--no-track", cfg.develop, cfg.master])
      }
      await r.git(["checkout", cfg.develop])
    }
  })
  return flowPrefixes(r)
}
