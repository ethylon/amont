/* Mutating operations (AUDIT.md §4): network (fetch/pull/push, auto or manual), branch
   actions (merge/delete/pull/push/finish), checkout, stage/unstage/commit, stash.

   All of them go through the repo mutex (`repos.withLock`, hygiene fix): the
   stash→checkout→pop dance used to run unlocked against autofetch before this refactor — two
   concurrent mutations on the same `.git` otherwise end up with `index.lock` files stepping on
   each other. Only `runOp` (network) keeps its own manual guard: auto-fetch needs to be able
   to silently back off when the repo is busy, whereas an explicit user action must throw
   (BUSY). */

import { writeFile } from "node:fs/promises"

import { AppError, decodeError } from "../../shared/errors.ts"
import type { BranchAct, OpEvent, OpName, StashAct, WorktreeAct } from "../../shared/types.ts"
import { assertPaths, inRepo, withLock, type RepoHandle } from "../repos.ts"
import { mute } from "../watcher.ts"
import { OP_TIMEOUT } from "./exec.ts"
import { finishFlow } from "./flow.ts"
import { ALL_REFS, BRANCH } from "./parse.ts"

/* --- Network ---
   --progress: without a TTY git stays silent about its progress; we force it so the console streams it. */
const OPS: Record<OpName, string[]> = {
  fetch: ["fetch", "--all", "--prune", "--progress"],
  pull: ["pull", "--ff-only", "--progress"],
  push: ["push", "--progress"],
}
const OP_GROUP: Record<OpName, string> = { fetch: "Fetch", pull: "Pull", push: "Push" }

export const isOpName = (name: string): name is OpName => Object.hasOwn(OPS, name)

/* Operation header: brackets the stream at the level of the user action (a push, a pull,
   auto-fetch, a checkout…), whereas `r.git()` only sees isolated commands. Background reads
   (status, log pages) stay without a header, which visually sets them apart. */
const groupTrace = (r: RepoHandle, text: string): void => r.events.trace({ kind: "group", text, ts: Date.now() })

/* Tips of all refs, deduplicated and sorted: two equal snapshots = nothing moved.
   Much cheaper than the full `rev-list --all --count` we used to pay for twice per fetch.
   Exported: git/queries.ts keys its ordered-hash-list cache on the same snapshot. */
export const refTips = (r: RepoHandle): Promise<string[]> =>
  r
    .git(["for-each-ref", "--format=%(objectname)", "refs/heads", "refs/remotes", "refs/tags"])
    .then((o) => [...new Set(o.split("\n").filter(Boolean))].sort())

/* Commits reachable from the current refs but not from the old tips: the "new" ones from the
   fetch. More accurate than the difference of two counts, which a `--prune` could make lie. */
const countNew = (r: RepoHandle, before: string[]): Promise<number> =>
  r
    .git(["rev-list", "--count", ...ALL_REFS, "--stdin"], { input: before.map((h) => `^${h}\n`).join("") })
    .then((o) => parseInt(o, 10))

function errorPayload(e: unknown): Pick<Extract<OpEvent, { state: "error" }>, "code" | "detail"> {
  return decodeError(e)
}

/* One per repo at a time (git sets its own locks, but two concurrent fetches on the
   same repo end up with a pointless error). The result goes out as an event, not as an
   invoke return value: auto-fetch has no caller on the renderer side. Unlike the other
   mutations, this never throws: auto-fetch needs to be able to stay quiet when the repo is busy. */
export async function runOp(r: RepoHandle, name: OpName, auto = false): Promise<void> {
  if (r.running) {
    /* never silent for an explicit click: the window between the click and the renderer's
       `busy` state is real */
    if (!auto) r.events.op({ op: name, state: "error", auto, code: "BUSY", detail: r.running })
    return
  }
  r.running = name
  groupTrace(r, auto ? "Auto-fetch" : OP_GROUP[name])
  r.events.op({ op: name, state: "start", auto })
  try {
    /* only fetch shows a counter; pull reloads the graph, push adds nothing */
    const before = name === "fetch" ? await refTips(r) : null
    await r.git(OPS[name], { timeout: OP_TIMEOUT })
    let added = 0
    if (before) {
      const after = await refTips(r)
      if (after.join() !== before.join()) added = await countNew(r, before)
    }
    r.events.op({ op: name, state: "done", auto, added })
  } catch (e) {
    r.events.op({ op: name, state: "error", auto, ...errorPayload(e) })
  } finally {
    mute(r)
    r.running = null
  }
}

/* --- Branch actions (context menu) ---
   No event: the renderer triggered the action, so it's the one that reloads and displays the error. */
const BRANCH_GROUP: Record<BranchAct, string> = {
  merge: "Merge",
  delete: "Delete",
  pull: "Pull",
  push: "Push",
  finish: "Flow finish",
}

/** The remote a branch tracks, as declared by its config. */
async function upstreamOf(r: RepoHandle, name: string): Promise<{ remote: string; merge: string }> {
  const read = (key: string) =>
    r.git(["config", "--get", `branch.${name}.${key}`]).then(
      (o) => o.trim(),
      () => ""
    )
  const [remote, merge] = await Promise.all([read("remote"), read("merge")])
  if (!remote || !merge) throw new AppError("NO_UPSTREAM", name)
  return { remote, merge }
}

const BRANCH_OPS: Record<BranchAct, (r: RepoHandle, name: string) => Promise<void>> = {
  merge: (r, name) => r.git(["merge", name], { timeout: OP_TIMEOUT }).then(() => {}),

  /* `-d`, never `-D`: git's refusal on an unmerged branch is the only safeguard
     we have — the menu doesn't ask for confirmation. The remote, though, stays untouched. */
  delete: (r, name) => r.git(["branch", "-d", name]).then(() => {}),

  /* We don't fetch into a checked-out branch: on HEAD, it's a pull. Elsewhere, the explicit
     refspec is fast-forward-only, and git takes the opportunity to update `refs/remotes/…` too. */
  async pull(r, name) {
    const { remote, merge } = await upstreamOf(r, name)
    const current = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
    await r.git(
      name === current
        ? ["pull", "--ff-only", "--progress"]
        : ["fetch", remote, `${merge}:refs/heads/${name}`, "--progress"],
      { timeout: OP_TIMEOUT }
    )
  },

  /* The refspec names both sides: `git push <remote> <branch>` would push to a branch
     of the same name, even though the upstream carries a different one. */
  async push(r, name) {
    const { remote, merge } = await upstreamOf(r, name)
    await r.git(["push", remote, `refs/heads/${name}:${merge}`, "--progress"], { timeout: OP_TIMEOUT })
  },

  finish: (r, name) => finishFlow(r, name),
}

export async function branchAction(r: RepoHandle, action: BranchAct, name: string): Promise<void> {
  if (!Object.hasOwn(BRANCH_OPS, action)) throw new AppError("BAD_ARG", "action")
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, action, async () => {
    groupTrace(r, `${BRANCH_GROUP[action]} ${name}`)
    try {
      await BRANCH_OPS[action](r, name)
    } finally {
      mute(r)
    }
  })
}

/* --- Checkout ---
   The dirty tree goes to the stash and comes back after the switch. Switch refused: we put
   the tree back where we found it. `pop` in conflict: git keeps the stash entry and lays down
   its markers — we report it and don't try to recover, the user is already on the right branch. */
export async function checkout(r: RepoHandle, name: string): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, `checkout ${name}`, async () => {
    groupTrace(r, `Checkout ${name}`)
    const dirty = !!(await r.git(["status", "--porcelain", "-uall"])).trim()
    if (dirty) await r.git(["stash", "push", "-u", "-m", `amont: ${name}`])
    try {
      await r.git(["checkout", name])
    } catch (e) {
      /* the recovery pop can itself fail (conflict): the stash entry survives,
         and it's the checkout failure — the cause — that we surface, not the pop's */
      if (dirty) await r.git(["stash", "pop"]).catch(() => {})
      throw e
    } finally {
      mute(r) // HEAD moved: the renderer reloads on its own, the watcher has nothing to add
    }
    if (dirty)
      await r.git(["stash", "pop"]).catch(() => {
        throw new AppError("STASH_POP_CONFLICT", name)
      })
  })
}

/* --- Working tree: stage/unstage/commit ---
   Paths go out over stdin, NUL-separated, rather than as argv: "stage everything" on
   thousands of files would exceed Windows' command-line length limit (~32k chars). */
const PATHSPEC = ["--pathspec-from-file=-", "--pathspec-file-nul"]

export async function stage(r: RepoHandle, paths: string[]): Promise<void> {
  assertPaths(paths)
  await withLock(r, "stage", () => r.git(["add", ...PATHSPEC], { input: paths.join("\0") }).then(() => {}))
}

export async function unstage(r: RepoHandle, paths: string[]): Promise<void> {
  assertPaths(paths)
  await withLock(r, "unstage", async () => {
    /* before the first commit there's no HEAD, so nothing to restore from:
       removing the path from the index leaves it untracked, which is the expected result. */
    const cmd = await r.git(["rev-parse", "--verify", "-q", "HEAD"]).then(
      () => ["restore", "--staged"],
      () => ["rm", "--cached", "-q"]
    )
    await r.git([...cmd, ...PATHSPEC], { input: paths.join("\0") })
  })
}

/* Partial staging (hunk or lines from the diff view): the renderer builds the sub-patch
   (diff-parse.ts) and only the index moves — never the working file. `reverse` takes the
   change out of the staged side (`git apply --cached --reverse`). Same cap as resolve: the
   patch derives from a diff the renderer already displays in full. */
const PATCH_MAX = 4 * 1024 * 1024

export async function applyPatch(r: RepoHandle, patch: string, reverse: boolean): Promise<void> {
  if (typeof patch !== "string" || !patch.trim() || patch.length > PATCH_MAX) throw new AppError("BAD_ARG", "patch")
  const args = ["apply", "--cached", ...(reverse ? ["--reverse"] : []), "--whitespace=nowarn", "-"]
  await withLock(r, "apply patch", () => r.git(args, { input: patch }).then(() => {}))
}

/** Partial discard (hunk or lines from the diff view): the same renderer-built sub-patch as
    applyPatch, but reverse-applied to the working tree alone — the index never moves. */
export async function discardPatch(r: RepoHandle, patch: string): Promise<void> {
  if (typeof patch !== "string" || !patch.trim() || patch.length > PATCH_MAX) throw new AppError("BAD_ARG", "patch")
  await withLock(r, "discard patch", () =>
    r.git(["apply", "--reverse", "--whitespace=nowarn", "-"], { input: patch }).then(() => {})
  )
}

/* --- Discard (working tree) ---
   Tracked paths go back to their index content (`git restore`); untracked paths are deleted
   (`git clean -f` — force is required, `clean.requireForce` defaults to true). Irreversible by
   nature: the renderer asks for confirmation before calling. `git clean` has no
   --pathspec-from-file (checked against git 2.51), so untracked paths travel as argv, batched
   under Windows' command-line length limit. */
const CLEAN_ARGV_MAX = 20_000

export async function discard(r: RepoHandle, paths: string[], untracked: string[]): Promise<void> {
  const valid = (a: unknown): a is string[] => Array.isArray(a) && a.every((p) => typeof p === "string" && p.length > 0)
  if (!valid(paths) || !valid(untracked) || (!paths.length && !untracked.length)) throw new AppError("BAD_ARG", "paths")
  await withLock(r, "discard", async () => {
    groupTrace(r, "Discard")
    if (paths.length) await r.git(["restore", ...PATHSPEC], { input: paths.join("\0") })
    for (let at = 0; at < untracked.length;) {
      const batch: string[] = []
      let len = 0
      while (at < untracked.length && (batch.length === 0 || len + untracked[at].length < CLEAN_ARGV_MAX)) {
        len += untracked[at].length + 1
        batch.push(untracked[at++])
      }
      await r.git(["clean", "-f", "-q", "--", ...batch])
    }
  })
}

export async function commit(r: RepoHandle, message: string, amend: boolean): Promise<void> {
  if (typeof message !== "string" || !message.trim()) throw new AppError("BAD_ARG", "message")
  await withLock(r, amend ? "amend" : "commit", async () => {
    groupTrace(r, amend ? "Amend" : "Commit")
    const args = ["commit", ...(amend ? ["--amend"] : []), "-m", message]
    await r.git(args)
    mute(r)
  })
}

/* --- Merge conflicts ---
   The merged output the user validated becomes the working file, then `git add` clears the
   path's conflict stages: that's git's own definition of "resolved". The write and the add
   stay under the mutex as a single unit — an autofetch between the two would be harmless,
   but a concurrent stage/commit would not. */
const RESOLVE_MAX = 4 * 1024 * 1024

export async function resolveConflict(r: RepoHandle, path: string, content: string): Promise<void> {
  if (typeof content !== "string" || content.length > RESOLVE_MAX) throw new AppError("BAD_ARG", "content")
  const full = inRepo(r, path)
  await withLock(r, "resolve", async () => {
    groupTrace(r, `Resolve ${path}`)
    try {
      await writeFile(full, content, "utf8")
      await r.git(["add", "--", path])
    } finally {
      mute(r)
    }
  })
}

/** Puts the tree back where the merge found it. Loses manual resolutions — same safeguard
    policy as branch delete: git refuses when there's no merge to abort, nothing more. */
export async function mergeAbort(r: RepoHandle): Promise<void> {
  await withLock(r, "merge abort", async () => {
    groupTrace(r, "Merge abort")
    try {
      await r.git(["merge", "--abort"])
    } finally {
      mute(r)
    }
  })
}

/* --- Linked worktrees ---
   `remove` without `--force`: git's refusal on a dirty or locked worktree is the safeguard,
   same policy as branch delete (`-d`, never `-D`). The path has already been resolved against
   `git worktree list` by the caller (ipc.ts → queries.resolveWorktree): normalized absolute,
   it can never be read as an option. `dir` (add) only ever comes from the system dialog. */
export async function worktreeAdd(r: RepoHandle, dir: string, branch: string): Promise<void> {
  if (typeof branch !== "string" || !BRANCH.test(branch)) throw new AppError("BAD_ARG", "name")
  await withLock(r, "worktree add", async () => {
    groupTrace(r, `Worktree add ${branch}`)
    try {
      await r.git(["worktree", "add", dir, branch], { timeout: OP_TIMEOUT })
    } finally {
      mute(r)
    }
  })
}

export async function worktreeAction(r: RepoHandle, action: WorktreeAct, path?: string): Promise<void> {
  if (action !== "remove" && action !== "prune") throw new AppError("BAD_ARG", "action")
  if (action === "remove" && !path) throw new AppError("BAD_ARG", "path")
  await withLock(r, `worktree ${action}`, async () => {
    groupTrace(r, action === "remove" ? `Worktree remove ${path}` : "Worktree prune")
    try {
      await r.git(action === "remove" ? ["worktree", "remove", path!] : ["worktree", "prune"])
    } finally {
      mute(r)
    }
  })
}

/* --- Stash ---
   apply/pop/drop target an entry by its name `stash@{N}` — indices shift after a
   drop, the renderer reloads the list after each action. push stashes the entire tree,
   untracked files included, with the given message. */
const STASH_NAME = /^stash@\{\d+\}$/
const STASH_GROUP: Record<StashAct, string> = {
  push: "Stash",
  apply: "Stash apply",
  pop: "Stash pop",
  drop: "Stash drop",
}

export async function stashAction(r: RepoHandle, action: StashAct, arg?: string): Promise<void> {
  if (!Object.hasOwn(STASH_GROUP, action)) throw new AppError("BAD_ARG", "action")
  let args: string[]
  if (action === "push") {
    const msg = typeof arg === "string" && arg.trim() ? arg.trim() : null
    args = ["stash", "push", "-u", ...(msg ? ["-m", msg] : [])]
  } else {
    if (typeof arg !== "string" || !STASH_NAME.test(arg)) throw new AppError("BAD_ARG", "name")
    args = ["stash", action, arg]
  }
  await withLock(r, action, async () => {
    groupTrace(r, action === "push" ? STASH_GROUP.push : `${STASH_GROUP[action]} ${arg}`)
    try {
      await r.git(args)
    } finally {
      mute(r)
    }
  })
}
