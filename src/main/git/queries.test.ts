/* Tests for the conflict-state detection (queries.ts mergeState/conflictOp) and the abort
   that must aim at the same operation (ops.ts mergeAbort): each conflict-capable operation
   parks its own pseudo-ref, and the banner's label — like the abort's command — derives from
   which one is on disk. The rebase branch name is read from the backend's state directory,
   exercised here against a real temp dir.

   `electron` is mocked out for the same reason as ops.test.ts: queries.ts drags in repos.ts →
   state.ts, whose module scope imports `app` — none of it is exercised here. */
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {}, shell: {} }))

import type { RepoHandle } from "../repos.ts"
import { mergeAbort } from "./ops.ts"
import { conflictOp, mergeState } from "./queries.ts"

interface FakeState {
  /** pseudo-refs on disk, name → full sha (MERGE_HEAD, REBASE_HEAD, …) */
  refs?: Record<string, string>
  /** `rev-parse --abbrev-ref HEAD` — "HEAD" mid-rebase or detached */
  branch?: string
  /** branches at MERGE_HEAD (`for-each-ref --points-at`) */
  pointsAt?: string[]
  gitDir?: string
}

/** Minimal handle: `git` replays the pseudo-ref probes and records every call. */
function fakeRepo(state: FakeState = {}) {
  const calls: string[][] = []
  const git = (args: string[]) => {
    calls.push(args)
    if (args[0] === "rev-parse" && args[1] === "-q") {
      const sha = state.refs?.[args[3]]
      return sha ? Promise.resolve(sha) : Promise.reject(new Error("fatal: bad revision"))
    }
    if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") return Promise.resolve(state.branch ?? "HEAD")
    if (args[0] === "for-each-ref") return Promise.resolve((state.pointsAt ?? []).join("\n"))
    return Promise.resolve("")
  }
  const r = {
    git,
    gitDir: state.gitDir ?? "/nonexistent",
    muted: 0,
    dirty: false,
    gen: 0,
    pending: [] as string[],
    lockCount: 0,
    lockTail: Promise.resolve(),
    events: { trace: () => {}, queue: () => {} },
  }
  return { r: r as unknown as RepoHandle, calls }
}

const SHA = "a16d13e9aa16d13e9aa16d13e9aa16d13e9aa16d"

describe("mergeState: which operation is in progress, and its A/B labels", () => {
  it("no pseudo-ref on disk: no operation", async () => {
    const { r } = fakeRepo()
    assert.deepEqual(await mergeState(r), { op: null, ours: null, theirs: null })
  })

  it("merge: theirs prefers a branch pointing at MERGE_HEAD", async () => {
    const { r } = fakeRepo({ refs: { MERGE_HEAD: SHA }, branch: "main", pointsAt: ["feature/x"] })
    assert.deepEqual(await mergeState(r), { op: "merge", ours: "main", theirs: "feature/x" })
  })

  it("merge with no branch at MERGE_HEAD: theirs falls back to the short hash", async () => {
    const { r } = fakeRepo({ refs: { MERGE_HEAD: SHA }, branch: "main" })
    assert.deepEqual(await mergeState(r), { op: "merge", ours: "main", theirs: SHA.slice(0, 8) })
  })

  it("cherry-pick: detached-safe ours, short hash of the commit being applied", async () => {
    const { r } = fakeRepo({ refs: { CHERRY_PICK_HEAD: SHA }, branch: "main" })
    assert.deepEqual(await mergeState(r), { op: "cherry-pick", ours: "main", theirs: SHA.slice(0, 8) })
  })

  it("revert: same shape as cherry-pick", async () => {
    const { r } = fakeRepo({ refs: { REVERT_HEAD: SHA }, branch: "main" })
    assert.deepEqual(await mergeState(r), { op: "revert", ours: "main", theirs: SHA.slice(0, 8) })
  })

  describe("rebase (HEAD is detached: ours is null)", () => {
    let dir: string | null = null
    afterEach(() => {
      if (dir) rmSync(dir, { recursive: true, force: true })
      dir = null
    })

    it("theirs is the replayed branch, read from rebase-merge/head-name", async () => {
      dir = mkdtempSync(join(tmpdir(), "amont-test-"))
      mkdirSync(join(dir, "rebase-merge"))
      writeFileSync(join(dir, "rebase-merge", "head-name"), "refs/heads/topic\n")
      const { r } = fakeRepo({ refs: { REBASE_HEAD: SHA }, gitDir: dir })
      assert.deepEqual(await mergeState(r), { op: "rebase", ours: null, theirs: "topic" })
    })

    it("no head-name on disk: theirs falls back to the short hash", async () => {
      dir = mkdtempSync(join(tmpdir(), "amont-test-"))
      mkdirSync(join(dir, "rebase-apply"))
      const { r } = fakeRepo({ refs: { REBASE_HEAD: SHA }, gitDir: dir })
      assert.deepEqual(await mergeState(r), { op: "rebase", ours: null, theirs: SHA.slice(0, 8) })
    })

    it("wins over a leftover CHERRY_PICK_HEAD: aborting the pick alone would strand the rebase", async () => {
      dir = mkdtempSync(join(tmpdir(), "amont-test-"))
      mkdirSync(join(dir, "rebase-merge"))
      const { r } = fakeRepo({ refs: { REBASE_HEAD: SHA, CHERRY_PICK_HEAD: SHA }, gitDir: dir })
      assert.equal((await conflictOp(r))?.op, "rebase")
    })

    it("stale REBASE_HEAD without a state directory: no operation", async () => {
      const { r } = fakeRepo({ refs: { REBASE_HEAD: SHA } })
      assert.deepEqual(await mergeState(r), { op: null, ours: null, theirs: null })
    })

    it("stale REBASE_HEAD during a real cherry-pick: the pick is reported, not the ghost rebase", async () => {
      const { r } = fakeRepo({ refs: { REBASE_HEAD: SHA, CHERRY_PICK_HEAD: SHA }, branch: "main" })
      assert.deepEqual(await mergeState(r), { op: "cherry-pick", ours: "main", theirs: SHA.slice(0, 8) })
    })
  })
})

describe("mergeAbort: the command targets the operation actually on disk", () => {
  const abortCall = (calls: string[][]) => calls.find((c) => c[1] === "--abort")

  it("cherry-pick in progress: `git cherry-pick --abort`", async () => {
    const { r, calls } = fakeRepo({ refs: { CHERRY_PICK_HEAD: SHA } })
    await mergeAbort(r)
    assert.deepEqual(abortCall(calls), ["cherry-pick", "--abort"])
  })

  it("nothing in progress: falls through to `git merge --abort` (git's refusal is the guard)", async () => {
    const { r, calls } = fakeRepo()
    await mergeAbort(r)
    assert.deepEqual(abortCall(calls), ["merge", "--abort"])
  })
})
