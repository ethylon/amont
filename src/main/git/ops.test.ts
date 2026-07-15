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
import { runOp } from "./ops.ts"

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
