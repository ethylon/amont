/* Tests for the `done` payload of runOp (ops.ts): `changed` must reflect any ref-tip move —
   a push updating the remote-tracking ref, a prune-only fetch — while `added` keeps counting
   only a fetch's new commits. The renderer reloads the graph on `changed`: a `false` here
   used to leave the "commits to push" tint on after a successful push (missing-refresh bug).

   `electron` is mocked out: ops.ts drags in repos.ts → state.ts, whose module scope imports
   `app` — none of it is exercised by runOp. */
import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {} }))

import type { DistributiveOmit, OpEvent, OpName } from "../../shared/types.ts"
import type { RepoHandle } from "../repos.ts"
import { createBranch, createTag, deleteRemoteBranch, deleteTag, resetTo, revertCommit, runOp } from "./ops.ts"

type Emitted = DistributiveOmit<OpEvent, "id">

/** Minimal handle: `git` replays the ref-tip snapshots taken around the op and a canned
    rev-list count; the events go into `events` for inspection. */
function fakeRepo(before: string[], after: string[], newCommits = 0) {
  const events: Emitted[] = []
  let snapshots = 0
  const git = (args: string[]) =>
    Promise.resolve(
      args[0] === "for-each-ref"
        ? (snapshots++ === 0 ? before : after).join("\n")
        : args[0] === "rev-list"
          ? String(newCommits)
          : ""
    )
  const r = {
    running: null as OpName | null,
    muted: 0,
    dirty: false,
    gen: 0,
    events: { op: (p: Emitted) => events.push(p), trace: () => {} },
    git,
  }
  return { r: r as unknown as RepoHandle, events }
}

const doneEvent = (events: Emitted[]) => events.find((e) => e.state === "done")

describe("runOp `done` event: `changed` (graph reload cue) and `added` (badge counter)", () => {
  it("push that moved the remote-tracking ref: changed, nothing counted", async () => {
    const { r, events } = fakeRepo(["aaa", "bbb"], ["aaa", "ccc"])
    await runOp(r, "push")
    assert.deepEqual(doneEvent(events), { op: "push", state: "done", auto: false, added: 0, changed: true })
  })

  it("push already up to date: no move, no reload cue", async () => {
    const { r, events } = fakeRepo(["aaa", "bbb"], ["aaa", "bbb"])
    await runOp(r, "push")
    assert.deepEqual(doneEvent(events), { op: "push", state: "done", auto: false, added: 0, changed: false })
  })

  it("prune-only fetch: a tip disappeared without any new commit", async () => {
    const { r, events } = fakeRepo(["aaa", "bbb"], ["aaa"], 0)
    await runOp(r, "fetch")
    assert.deepEqual(doneEvent(events), { op: "fetch", state: "done", auto: false, added: 0, changed: true })
  })

  it("fetch that brought commits in: changed and counted", async () => {
    const { r, events } = fakeRepo(["aaa"], ["aaa", "bbb"], 3)
    await runOp(r, "fetch", true)
    assert.deepEqual(doneEvent(events), { op: "fetch", state: "done", auto: true, added: 3, changed: true })
  })

  it("pull signals its move but never counts", async () => {
    const { r, events } = fakeRepo(["aaa"], ["bbb"], 5)
    await runOp(r, "pull")
    assert.deepEqual(doneEvent(events), { op: "pull", state: "done", auto: false, added: 0, changed: true })
  })
})

/* --- Commit-anchored ops and remote-side deletions (graph/sidebar context menus) ---
   The fake records every git argv: the assertions pin the exact commands, which is where
   the option-injection guards (BRANCH/HASH validation) and the `-m 1` / `refs/tags/` details
   live. `replies` maps args[0] to a canned stdout (status for the dirty probe, rev-list for
   the parent count). */
function fakeMutRepo(replies: Record<string, string> = {}) {
  const calls: string[][] = []
  const r = {
    running: null as string | null,
    muted: 0,
    dirty: false,
    gen: 0,
    events: { op: () => {}, trace: () => {} },
    git: (args: string[]) => {
      calls.push(args)
      return Promise.resolve(replies[args[0]] ?? "")
    },
  }
  return { r: r as unknown as RepoHandle, calls }
}

const SHA = "a".repeat(40)

describe("commit-anchored ops (graph context menu)", () => {
  it("createBranch without checkout only creates the branch", async () => {
    const { r, calls } = fakeMutRepo()
    await createBranch(r, "topic", SHA, false)
    assert.deepEqual(calls, [["branch", "topic", SHA]])
  })

  it("createBranch with checkout switches to the new branch (clean tree: no stash dance)", async () => {
    const { r, calls } = fakeMutRepo({ status: "" })
    await createBranch(r, "topic", SHA, true)
    assert.deepEqual(calls, [
      ["branch", "topic", SHA],
      ["status", "--porcelain", "-uall"],
      ["checkout", "topic"],
    ])
  })

  it("createBranch rejects an option-looking name and a non-hash start point", async () => {
    const { r, calls } = fakeMutRepo()
    await assert.rejects(() => createBranch(r, "-D", SHA, false))
    await assert.rejects(() => createBranch(r, "topic", "master", false))
    assert.deepEqual(calls, [])
  })

  it("createTag tags the given commit", async () => {
    const { r, calls } = fakeMutRepo()
    await createTag(r, "v1.2.3", SHA)
    assert.deepEqual(calls, [["tag", "v1.2.3", SHA]])
  })

  it("resetTo runs the picked mode and rejects anything else", async () => {
    const { r, calls } = fakeMutRepo()
    await resetTo(r, "hard", SHA)
    assert.deepEqual(calls, [["reset", "--hard", SHA]])
    await assert.rejects(() => resetTo(r, "keep" as never, SHA))
  })

  it("revertCommit reverts a plain commit without a mainline", async () => {
    const { r, calls } = fakeMutRepo({ "rev-list": `${SHA} ${"b".repeat(40)}\n` })
    await revertCommit(r, SHA)
    assert.deepEqual(calls[1], ["revert", "--no-edit", SHA])
  })

  it("revertCommit reverts a merge relative to its first parent", async () => {
    const { r, calls } = fakeMutRepo({ "rev-list": `${SHA} ${"b".repeat(40)} ${"c".repeat(40)}\n` })
    await revertCommit(r, SHA)
    assert.deepEqual(calls[1], ["revert", "--no-edit", "-m", "1", SHA])
  })
})

describe("remote-side deletions (sidebar context menus)", () => {
  it("deleteRemoteBranch splits remote/branch at the first slash", async () => {
    const { r, calls } = fakeMutRepo()
    await deleteRemoteBranch(r, "origin/feature/x")
    assert.deepEqual(calls[0].slice(0, 2), ["push", "--progress"])
    assert.deepEqual(calls[0].slice(2), ["origin", "--delete", "feature/x"])
  })

  it("deleteRemoteBranch rejects a name without a remote prefix", async () => {
    const { r, calls } = fakeMutRepo()
    await assert.rejects(() => deleteRemoteBranch(r, "master"))
    assert.deepEqual(calls, [])
  })

  it("deleteTag deletes locally, then remotely under the full refs/tags/ path", async () => {
    const { r, calls } = fakeMutRepo()
    await deleteTag(r, "v1.0.0", "origin")
    assert.deepEqual(calls[0], ["tag", "-d", "v1.0.0"])
    assert.deepEqual(calls[1].slice(2), ["origin", "--delete", "refs/tags/v1.0.0"])
  })

  it("deleteTag without a remote stays local", async () => {
    const { r, calls } = fakeMutRepo()
    await deleteTag(r, "v1.0.0", null)
    assert.deepEqual(calls, [["tag", "-d", "v1.0.0"]])
  })

  it("deleteTag rejects a remote carrying a path or an option shape", async () => {
    const { r, calls } = fakeMutRepo()
    await assert.rejects(() => deleteTag(r, "v1.0.0", "origin/x"))
    await assert.rejects(() => deleteTag(r, "v1.0.0", "--force"))
    assert.deepEqual(calls, [])
  })
})
