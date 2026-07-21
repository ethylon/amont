/* Mutating operations (AUDIT.md §4): network (fetch/pull/push, auto or manual), branch
   actions (merge/delete/pull/push/finish), checkout, stage/unstage/commit, stash.

   All of them go through the repo mutation queue (`repos.withLock`): the
   stash→checkout→pop dance used to run unlocked against autofetch before this refactor — two
   concurrent mutations on the same `.git` otherwise end up with `index.lock` files stepping on
   each other. A busy repo no longer throws BUSY at an explicit user action: the call waits its
   turn FIFO (chaining a fetch, a checkout, a push just works). Auto-fetch keeps backing off
   silently when anything runs or waits — background housekeeping must never lengthen the
   user's queue. */

import { writeFile } from "node:fs/promises"

import { AppError, decodeError } from "../../shared/errors.ts"
import { pullModeFlag } from "../../shared/settings.ts"
import type { BranchAct, OpEvent, OpName, ResetMode, StashAct, WorktreeAct } from "../../shared/types.ts"
import { assertPaths, inRepo, withLock, type RepoHandle } from "../repos.ts"
import { getSettings } from "../settings.ts"
import { captureGitError, captureOpError } from "../telemetry.ts"
import { mute } from "../watcher.ts"
import { OP_TIMEOUT } from "./exec.ts"
import { finishFlow } from "./flow.ts"
import { ALL_REFS, BRANCH, HASH } from "./parse.ts"
import { conflictOp } from "./queries.ts"

/* --- Network ---
   --progress: without a TTY git stays silent about its progress; we force it so the console streams it. */
const OPS: Record<OpName, string[]> = {
  fetch: ["fetch", "--all", "--progress"],
  pull: ["pull", "--progress"], // never run as-is: opArgs always injects the integration-mode flag
  push: ["push", "--progress"],
}
const OP_GROUP: Record<OpName, string> = { fetch: "Fetch", pull: "Pull", push: "Push" }

export const isOpName = (name: string): name is OpName => Object.hasOwn(OPS, name)

/* `--prune` on fetch and pull's integration mode (`--ff`/`--ff-only`/`--rebase`) are user
   settings (settings.ts), edited from the toolbar's options cards. Read live at call time so a
   change takes effect on the very next run, no restart. Push carries no settings-driven flag. */
const opArgs = (name: OpName): string[] => {
  if (name === "fetch" && getSettings().prune) return ["fetch", "--all", "--prune", "--progress"]
  if (name === "pull") return ["pull", pullModeFlag(getSettings().pullMode), "--progress"]
  return OPS[name]
}

/* Operation header: brackets the stream at the level of the user action (a push, a pull,
   auto-fetch, a checkout…), whereas `r.git()` only sees isolated commands. Background reads
   (status, log pages) stay without a header, which visually sets them apart. */
const groupTrace = (r: RepoHandle, text: string): void => r.events.trace({ kind: "group", text, ts: Date.now() })

/* `--progress` streams `NN%` on stderr: forward it to the renderer footer (same channel fsck uses).
   The op name tags the event so the footer can label the running action (Fetching/Pulling/Pushing). */
const reportProgress =
  (r: RepoHandle, op: OpName) =>
  (percent: number): void =>
    r.events.progress({ op, percent })

/* Tips of all refs, deduplicated and sorted: two equal snapshots = nothing moved.
   Much cheaper than the full `rev-list --all --count` we used to pay for twice per fetch.
   (The graph fingerprint — git/queries.ts `computeSnapshot` — deliberately does NOT reuse
   this: its dedup erases name-only changes the UI must repaint.) */
const refTips = (r: RepoHandle): Promise<string[]> =>
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

/* The result goes out as an event, not as an invoke return value: auto-fetch has no caller on
   the renderer side. Unlike the other mutations, this never throws — failures travel on the
   same event. An explicit click on a busy repo queues (repos.withLock) instead of erroring;
   the `start` event only fires when the op actually takes its turn, so the renderer's busy
   state tracks execution, not the click. A same-name op already running or waiting is dropped:
   two pushes back to back would be a pointless duplicate (the toolbar greys those buttons,
   this guards the menu/shortcut paths). Auto-fetch backs off whenever anything runs or waits —
   background housekeeping must never lengthen the user's queue. */
export async function runOp(r: RepoHandle, name: OpName, auto = false): Promise<void> {
  if (auto && r.lockCount > 0) return
  if (r.running === name || r.pending.includes(name)) return
  /* the only throw left in this path is withLock's queue-overflow BUSY: surface it on the
     event channel like every other failure — this function's callers never await an error */
  await withLock(r, name, async () => {
    groupTrace(r, auto ? "Auto-fetch" : OP_GROUP[name])
    r.events.op({ op: name, state: "start", auto })
    try {
      /* `changed` compares the ref-tip snapshots around the command: it catches every move the
         renderer must redraw — new commits, but also a push updating the remote-tracking ref or
         a `--prune` deleting tips, both invisible to a commit count. `added` (fetch only, the
         walk isn't free) feeds the "N new commits" badge. */
      const before = await refTips(r)
      /* stream `NN%` to the footer, like fsck (Verify) — but never for a background auto-fetch,
         which stays non-intrusive (a badge on completion, no live feed occupant). */
      await r.git(opArgs(name), { timeout: OP_TIMEOUT, onProgress: auto ? undefined : reportProgress(r, name) })
      const after = await refTips(r)
      const changed = after.join() !== before.join()
      const added = changed && name === "fetch" ? await countNew(r, before) : 0
      r.events.op({ op: name, state: "done", auto, added, changed })
    } catch (e) {
      /* Telemetry before the event, same error either way: an auto-fetch failure is silent
         for the user, this is its only exit. captureOpError filters the network noise. */
      captureOpError(name, e, auto)
      r.events.op({ op: name, state: "error", auto, ...errorPayload(e) })
    } finally {
      mute(r)
    }
  }).catch((e) => {
    captureOpError(name, e, auto)
    r.events.op({ op: name, state: "error", auto, ...errorPayload(e) })
  })
}

/* --- Branch actions (context menu) ---
   No event: the renderer triggered the action, so it's the one that reloads and displays the error. */
const BRANCH_GROUP: Record<BranchAct, string> = {
  merge: "Merge",
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

  /* We don't fetch into a checked-out branch: on HEAD, it's a pull — with the same integration
     mode as the toolbar's Pull, so the action means one thing app-wide. Elsewhere, the explicit
     refspec is fast-forward-only, and git takes the opportunity to update `refs/remotes/…` too. */
  async pull(r, name) {
    const { remote, merge } = await upstreamOf(r, name)
    const current = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
    await r.git(
      name === current
        ? ["pull", pullModeFlag(getSettings().pullMode), "--progress"]
        : ["fetch", remote, `${merge}:refs/heads/${name}`, "--progress"],
      { timeout: OP_TIMEOUT, onProgress: reportProgress(r, "pull") }
    )
  },

  /* The refspec names both sides: `git push <remote> <branch>` would push to a branch
     of the same name, even though the upstream carries a different one. */
  async push(r, name) {
    const { remote, merge } = await upstreamOf(r, name)
    await r.git(["push", remote, `refs/heads/${name}:${merge}`, "--progress"], {
      timeout: OP_TIMEOUT,
      onProgress: reportProgress(r, "push"),
    })
  },

  finish: (r, name) => finishFlow(r, name),
}

/** `git merge [--no-ff] <name>` into HEAD — the release queue's one-at-a-time merge. `--no-ff`
    keeps one merge commit per composed branch, the shape the queue promises. A conflict
    surfaces as MERGE_CONFLICT and the merge state stays for the conflict view. */
export async function mergeBranch(r: RepoHandle, name: string, noFF: boolean): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, "merge", async () => {
    groupTrace(r, `Merge ${name}`)
    try {
      await r.git(["merge", ...(noFF ? ["--no-ff"] : []), name], { timeout: OP_TIMEOUT })
    } finally {
      mute(r)
    }
  })
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

/* --- Branch deletion ---
   `-D`, not `-d`: the modal already confirms the intent, so git's refusal on an unmerged branch
   would only be a dead end for the user — the confirmed click carries out the delete regardless.
   The remote side is opt-in (`deleteRemote`): its upstream config is read first (the local delete
   removes `branch.<name>.*`), and the `push --delete` runs only after the local delete succeeds,
   so a rejected local delete never reaches the remote. */
export async function deleteBranch(r: RepoHandle, name: string, deleteRemote: boolean): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, "delete", async () => {
    groupTrace(r, `Delete ${name}`)
    try {
      const upstream = deleteRemote ? await upstreamOf(r, name) : null
      await r.git(["branch", "-D", name])
      if (upstream)
        await r.git(["push", "--progress", upstream.remote, "--delete", upstream.merge], {
          timeout: OP_TIMEOUT,
          onProgress: reportProgress(r, "push"),
        })
    } finally {
      mute(r)
    }
  })
}

/* --- Checkout ---
   The dirty tree goes to the stash and comes back after the switch. Switch refused: we put
   the tree back where we found it. `pop` in conflict: git keeps the stash entry and lays down
   its markers — we report it and don't try to recover, the user is already on the right branch.
   The body is shared with `createBranch` (checkout of the branch it just created), which runs
   it under its own lock — `withLock` doesn't nest, a second acquire would queue behind its
   own caller and deadlock. */
async function checkoutWithStash(r: RepoHandle, name: string): Promise<void> {
  const dirty = !!(await r.git(["status", "--porcelain", "-uall"])).trim()
  if (dirty) await r.git(["stash", "push", "-u", "-m", `amont: ${name}`])
  try {
    await r.git(["checkout", name])
  } catch (e) {
    /* the recovery pop can itself fail (conflict): the stash entry survives,
       and it's the checkout failure — the cause — that we surface, not the pop's
       (telemetry hears about the pop, though: an orphaned stash borders on data loss) */
    if (dirty) await r.git(["stash", "pop"]).catch((pe) => captureGitError("checkout.recovery-pop", pe))
    throw e
  } finally {
    mute(r) // HEAD moved: the renderer reloads on its own, the watcher has nothing to add
  }
  if (dirty)
    await r.git(["stash", "pop"]).catch(() => {
      throw new AppError("STASH_POP_CONFLICT", name)
    })
}

export async function checkout(r: RepoHandle, name: string): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, `checkout ${name}`, async () => {
    groupTrace(r, `Checkout ${name}`)
    await checkoutWithStash(r, name)
  })
}

/* --- Commit-anchored actions (graph context menu) ---
   All take a full SHA the renderer read off the graph. Same policy as the branch actions:
   no event — the renderer triggered the action, so it reloads and displays the error. */

/** `git branch <name> <from>`, then a stash-guarded checkout of the new branch when asked.
    The checkout failure surfaces as-is: the branch was created, only the switch failed. */
export async function createBranch(r: RepoHandle, name: string, from: string, checkout: boolean): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  if (typeof from !== "string" || !HASH.test(from)) throw new AppError("BAD_ARG", "from")
  await withLock(r, `branch ${name}`, async () => {
    groupTrace(r, `Branch ${name}`)
    try {
      await r.git(["branch", name, from])
    } finally {
      mute(r)
    }
    if (checkout) await checkoutWithStash(r, name)
  })
}

/** Lightweight tag on the given commit. */
export async function createTag(r: RepoHandle, name: string, at: string): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  if (typeof at !== "string" || !HASH.test(at)) throw new AppError("BAD_ARG", "at")
  await withLock(r, `tag ${name}`, async () => {
    groupTrace(r, `Tag ${name}`)
    try {
      await r.git(["tag", name, at])
    } finally {
      mute(r)
    }
  })
}

const RESET_MODES: readonly ResetMode[] = ["soft", "mixed", "hard"]

/** `git reset --<mode> <to>` of the current branch. The renderer's modal is the safeguard:
    by the time this runs, the user has explicitly picked soft/mixed/hard. */
export async function resetTo(r: RepoHandle, mode: ResetMode, to: string): Promise<void> {
  if (!RESET_MODES.includes(mode)) throw new AppError("BAD_ARG", "mode")
  if (typeof to !== "string" || !HASH.test(to)) throw new AppError("BAD_ARG", "to")
  await withLock(r, `reset ${mode}`, async () => {
    groupTrace(r, `Reset ${mode}`)
    try {
      await r.git(["reset", `--${mode}`, to])
    } finally {
      mute(r)
    }
  })
}

/** `git revert --no-edit <hash>`. A merge commit needs a mainline: `-m 1` reverts relative to
    the first parent — the branch the merge landed on, which is what the graph reads as "undo
    this merge". A conflict surfaces as MERGE_CONFLICT and the sequencer state stays for the
    conflict view to resolve. */
export async function revertCommit(r: RepoHandle, hash: string): Promise<void> {
  if (typeof hash !== "string" || !HASH.test(hash)) throw new AppError("BAD_ARG", "hash")
  await withLock(r, "revert", async () => {
    groupTrace(r, `Revert ${hash.slice(0, 8)}`)
    try {
      const parents = (await r.git(["rev-list", "--parents", "-n", "1", hash])).trim().split(/\s+/).length - 1
      await r.git(["revert", "--no-edit", ...(parents > 1 ? ["-m", "1"] : []), hash])
    } finally {
      mute(r)
    }
  })
}

/** `git cherry-pick <hash>` onto HEAD. Same mainline story as revertCommit: a merge commit
    needs `-m 1` to apply relative to its first parent. A conflict surfaces as MERGE_CONFLICT
    and the sequencer state stays for the conflict view to resolve. */
export async function cherryPick(r: RepoHandle, hash: string): Promise<void> {
  if (typeof hash !== "string" || !HASH.test(hash)) throw new AppError("BAD_ARG", "hash")
  await withLock(r, "cherry-pick", async () => {
    groupTrace(r, `Cherry-pick ${hash.slice(0, 8)}`)
    try {
      const parents = (await r.git(["rev-list", "--parents", "-n", "1", hash])).trim().split(/\s+/).length - 1
      await r.git(["cherry-pick", ...(parents > 1 ? ["-m", "1"] : []), hash])
    } finally {
      mute(r)
    }
  })
}

/* --- Remote-only deletions (context menus of a remote branch / a tag) ---
   Same confirmation policy as deleteBranch: the renderer's dialog carries the intent, main
   only validates and runs. */

/** `git push <remote> --delete <branch>` of a remote-tracking ref ("origin/topic"). */
export async function deleteRemoteBranch(r: RepoHandle, name: string): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  const slash = name.indexOf("/")
  if (slash <= 0 || slash === name.length - 1) throw new AppError("BAD_ARG", "name")
  const remote = name.slice(0, slash)
  const branch = name.slice(slash + 1)
  await withLock(r, `delete ${name}`, async () => {
    groupTrace(r, `Delete ${name}`)
    try {
      await r.git(["push", "--progress", remote, "--delete", branch], {
        timeout: OP_TIMEOUT,
        onProgress: reportProgress(r, "push"),
      })
    } finally {
      mute(r)
    }
  })
}

/** `git tag -d <name>`, then its remote counterpart when `remote` is given. The full
    `refs/tags/` path on the push side: a branch of the same name must never be the one
    deleted. The push only runs after the local delete succeeds. */
export async function deleteTag(r: RepoHandle, name: string, remote: string | null): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  if (remote !== null && (typeof remote !== "string" || !BRANCH.test(remote) || remote.includes("/")))
    throw new AppError("BAD_ARG", "remote")
  await withLock(r, `delete tag ${name}`, async () => {
    groupTrace(r, `Delete tag ${name}`)
    try {
      await r.git(["tag", "-d", name])
      if (remote)
        await r.git(["push", "--progress", remote, "--delete", `refs/tags/${name}`], {
          timeout: OP_TIMEOUT,
          onProgress: reportProgress(r, "push"),
        })
    } finally {
      mute(r)
    }
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

/** Puts the tree back where the operation found it. The state on disk picks the command —
    merge, rebase, cherry-pick and revert each park their own pseudo-ref (queries.conflictOp)
    and each has its own `--abort`; re-detecting here rather than trusting the renderer keeps
    the abort aimed at whatever is actually in progress. Loses manual resolutions — same
    safeguard policy as branch delete: git refuses when there's nothing to abort, nothing more. */
export async function mergeAbort(r: RepoHandle): Promise<void> {
  await withLock(r, "merge abort", async () => {
    const op = (await conflictOp(r))?.op ?? "merge"
    groupTrace(r, `Abort ${op}`)
    try {
      await r.git([op, "--abort"])
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

/** Worktree anchored on a commit: `-b <branch>` creates the new branch at `<from>` inside the
    added worktree — the graph's "create worktree from this commit" action. */
export async function worktreeAddFrom(r: RepoHandle, dir: string, branch: string, from: string): Promise<void> {
  if (typeof branch !== "string" || !BRANCH.test(branch)) throw new AppError("BAD_ARG", "name")
  if (typeof from !== "string" || !HASH.test(from)) throw new AppError("BAD_ARG", "from")
  await withLock(r, "worktree add", async () => {
    groupTrace(r, `Worktree add ${branch}`)
    try {
      await r.git(["worktree", "add", "-b", branch, dir, from], { timeout: OP_TIMEOUT })
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
