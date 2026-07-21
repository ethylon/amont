/* Tests for the `done` payload of runOp (ops.ts): `changed` must reflect any ref-tip move —
   a push updating the remote-tracking ref, a prune-only fetch — while `added` keeps counting
   only a fetch's new commits. The renderer reloads the graph on `changed`: a `false` here
   used to leave the "commits to push" tint on after a successful push (missing-refresh bug).

   `electron` is mocked out: ops.ts drags in repos.ts → state.ts, whose module scope imports
   `app` — none of it is exercised by runOp. */
import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {} }))

import { AppError } from "../../shared/errors.ts"
import type { DistributiveOmit, OpEvent, OpName, QueueEvent } from "../../shared/types.ts"
import { withLock, type RepoHandle } from "../repos.ts"
import {
  cherryPick,
  createBranch,
  createTag,
  deleteRemoteBranch,
  deleteTag,
  resetTo,
  revertCommit,
  runOp,
} from "./ops.ts"

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
    pending: [] as string[],
    lockCount: 0,
    lockTail: Promise.resolve(),
    events: { op: (p: Emitted) => events.push(p), trace: () => {}, queue: () => {} },
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

/* opArgs reads the live settings (registry defaults here — the tests never call setSettings):
   prune on for fetch, `--ff` as pull's integration mode. Pinning the argv catches a default
   drifting away from the SETTINGS registry or a flag landing in the wrong position. */
describe("runOp argv: the settings-driven flags at their defaults", () => {
  it("fetch carries --prune (default on)", async () => {
    const { r, calls } = fakeMutRepo()
    await runOp(r, "fetch")
    assert.deepEqual(calls[1], ["fetch", "--all", "--prune", "--progress"])
  })

  it("pull carries the default integration mode (--ff)", async () => {
    const { r, calls } = fakeMutRepo()
    await runOp(r, "pull")
    assert.deepEqual(calls[1], ["pull", "--ff", "--progress"])
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
    pending: [] as string[],
    lockCount: 0,
    lockTail: Promise.resolve(),
    events: { op: () => {}, trace: () => {}, queue: () => {} },
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

  it("cherryPick applies a plain commit without a mainline", async () => {
    const { r, calls } = fakeMutRepo({ "rev-list": `${SHA} ${"b".repeat(40)}\n` })
    await cherryPick(r, SHA)
    assert.deepEqual(calls[1], ["cherry-pick", SHA])
  })

  it("cherryPick applies a merge relative to its first parent", async () => {
    const { r, calls } = fakeMutRepo({ "rev-list": `${SHA} ${"b".repeat(40)} ${"c".repeat(40)}\n` })
    await cherryPick(r, SHA)
    assert.deepEqual(calls[1], ["cherry-pick", "-m", "1", SHA])
  })
})

/* --- Mutation queue (repos.withLock) ---
   A busy repo used to throw BUSY at the second caller; mutations now wait their turn FIFO,
   with `git:queue` events narrating every transition (enqueue, start, drain). These tests pin
   the ordering, the event payloads, the failure isolation, and runOp's two special cases —
   auto-fetch back-off and same-op dedup. */
type QueueEmitted = Omit<QueueEvent, "id">

function fakeQueueRepo(before: string[] = ["aaa"], after: string[] = ["aaa"]) {
  const events: Emitted[] = []
  const queueEvents: QueueEmitted[] = []
  let snapshots = 0
  const git = (args: string[]) =>
    Promise.resolve(
      args[0] === "for-each-ref"
        ? (snapshots++ % 2 === 0 ? before : after).join("\n")
        : args[0] === "rev-list"
          ? "0"
          : ""
    )
  const r = {
    running: null as string | null,
    muted: 0,
    dirty: false,
    gen: 0,
    pending: [] as string[],
    lockCount: 0,
    lockTail: Promise.resolve(),
    events: {
      op: (p: Emitted) => events.push(p),
      trace: () => {},
      queue: (q: QueueEmitted) => queueEvents.push(q),
    },
    git,
  }
  return { r: r as unknown as RepoHandle, events, queueEvents }
}

const tick = () => new Promise<void>((res) => setImmediate(res))

describe("per-repo mutation queue (withLock)", () => {
  it("serializes two operations FIFO instead of throwing BUSY", async () => {
    const { r } = fakeQueueRepo()
    const order: string[] = []
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const p1 = withLock(r, "first", async () => {
      order.push("first:start")
      await gate
      order.push("first:end")
    })
    const p2 = withLock(r, "second", () => {
      order.push("second")
      return Promise.resolve()
    })
    await tick()
    assert.deepEqual(order, ["first:start"], "the second operation must wait for the first")
    open()
    await Promise.all([p1, p2])
    assert.deepEqual(order, ["first:start", "first:end", "second"])
  })

  it("narrates the transitions on the queue channel: enqueue, starts, drain", async () => {
    const { r, queueEvents } = fakeQueueRepo()
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const p1 = withLock(r, "first", () => gate)
    const p2 = withLock(r, "second", () => Promise.resolve())
    open()
    await Promise.all([p1, p2])
    assert.deepEqual(queueEvents, [
      { running: null, pending: ["second"] }, // enqueue, "first" not started yet (microtask)
      { running: "first", pending: ["second"] },
      { running: "second", pending: [] },
      { running: null, pending: [] }, // drained
    ])
  })

  it("a failed operation doesn't poison the ones queued behind it", async () => {
    const { r } = fakeQueueRepo()
    const p1 = withLock(r, "first", () => Promise.reject(new Error("boom")))
    const p2 = withLock(r, "second", () => Promise.resolve("ok"))
    await assert.rejects(p1, /boom/)
    assert.equal(await p2, "ok")
  })

  it("a waiter whose repo closed settles to NO_REPO instead of running", async () => {
    const { r } = fakeQueueRepo()
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const held = withLock(r, "held", () => gate)
    await tick() // let "held" actually take the lock before anything else moves
    let ran = false
    const waiter = withLock(r, "waiter", () => {
      ran = true
      return Promise.resolve()
    })
    /* the handler must be attached before the turn comes around, or the rejection counts
       as unhandled for the microtask it spends without one */
    const verdict = assert.rejects(waiter, (e: unknown) => e instanceof AppError && e.code === "NO_REPO")
    r.closed = true // what closeRepo flips while "waiter" is still in the queue
    open()
    await held
    await verdict
    assert.equal(ran, false)
  })

  it("refuses to hoard past the overflow cap (BUSY)", async () => {
    const { r } = fakeQueueRepo()
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const held = withLock(r, "held", () => gate)
    const queued = Array.from({ length: 20 }, (_, i) => withLock(r, `q${i}`, () => Promise.resolve()))
    assert.throws(
      () => withLock(r, "overflow", () => Promise.resolve()),
      (e: unknown) => e instanceof AppError && e.code === "BUSY"
    )
    open()
    await Promise.all([held, ...queued])
  })
})

describe("runOp on a busy repo: queue, back off, dedup", () => {
  it("a manual op waits its turn and only announces `start` when it runs", async () => {
    const { r, events } = fakeQueueRepo()
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const held = withLock(r, "checkout topic", () => gate)
    const op = runOp(r, "push")
    await tick()
    assert.equal(events.length, 0, "no BUSY error, no premature start")
    open()
    await Promise.all([held, op])
    assert.equal(events[0].state, "start")
    assert.equal(events.at(-1)?.state, "done")
  })

  it("auto-fetch backs off while anything runs or waits", async () => {
    const { r, events } = fakeQueueRepo()
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const held = withLock(r, "commit", () => gate)
    await runOp(r, "fetch", true)
    open()
    await held
    assert.deepEqual(events, [], "an auto-fetch must never lengthen the user's queue")
  })

  it("a duplicate of an op already running or waiting is dropped", async () => {
    const { r, events } = fakeQueueRepo()
    let open!: () => void
    const gate = new Promise<void>((res) => (open = res))
    const held = withLock(r, "commit", () => gate)
    const first = runOp(r, "push")
    const dup = runOp(r, "push")
    open()
    await Promise.all([held, first, dup])
    assert.equal(events.filter((e) => e.state === "start").length, 1)
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
