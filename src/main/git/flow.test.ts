/* Tests for `finishFeature` (flow.ts): the exact git invocations behind the finish banner's
   two options. The default path must pin every flag the UI promises (`--no-ff`, `--norebase`,
   `--nosquash`, keep/delete) — a machine-level `gitflow.feature.finish.*` config would
   otherwise override the unstated ones. The rebase path is the hand-rolled sequence gitflow
   cannot express (rebase + fast-forward), with its diverged-remote guard and gitflow-parity
   cleanup (remote branch deleted, recorded base dropped).

   `electron` is mocked out for the same reason as ops.test.ts: flow.ts drags in repos.ts →
   state.ts, whose module scope imports `app`. */
import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {} }))

import { AppError } from "../../shared/errors.ts"
import type { RepoHandle } from "../repos.ts"
import { finishFeature } from "./flow.ts"

const PREFIXES = [
  "gitflow.prefix.feature feature/",
  "gitflow.prefix.bugfix bugfix/",
  "gitflow.prefix.release release/",
  "gitflow.prefix.hotfix hotfix/",
].join("\n")

/** Minimal handle: `git` replays canned config/rev-parse reads and records every call —
    the assertions are about the exact command sequences. `remote` = sha of the
    remote-tracking ref, `null` when the branch was never published. */
function fakeRepo({ remote = null as string | null, local = "aaa" } = {}) {
  const calls: string[][] = []
  const git = (args: string[]) => {
    calls.push(args)
    if (args[0] === "config" && args[1] === "--get-regexp") return Promise.resolve(PREFIXES)
    if (args[0] === "config" && args[1] === "--get") {
      if (args[2] === "gitflow.branch.develop") return Promise.resolve("develop\n")
      return Promise.reject(new Error("no such key"))
    }
    if (args[0] === "rev-parse") {
      if (args.at(-1)!.startsWith("refs/remotes/"))
        return remote ? Promise.resolve(`${remote}\n`) : Promise.reject(new Error("unknown ref"))
      return Promise.resolve(`${local}\n`)
    }
    return Promise.resolve("")
  }
  const r = { running: null, muted: 0, dirty: false, gen: 0, events: { trace: () => {} }, git }
  return { r: r as unknown as RepoHandle, calls }
}

/** Drops the read-only preamble (prefix/config/rev-parse reads) — `config --unset` stays. */
const mutating = (calls: string[][]) =>
  calls.filter(([c, a]) => c !== "rev-parse" && !(c === "config" && a.startsWith("--get")))

describe("finishFeature: gitflow-native merge path", () => {
  it("pins every promised flag and deletes by default", async () => {
    const { r, calls } = fakeRepo()
    await finishFeature(r, "feature/login", { rebase: false, deleteBranch: true })
    assert.deepEqual(calls.at(-1), [
      "flow",
      "feature",
      "finish",
      "--no-ff",
      "--norebase",
      "--nosquash",
      "--nokeep",
      "login",
    ])
  })

  it("keeps the branch with -k", async () => {
    const { r, calls } = fakeRepo()
    await finishFeature(r, "bugfix/crash", { rebase: false, deleteBranch: false })
    assert.deepEqual(calls.at(-1), ["flow", "bugfix", "finish", "--no-ff", "--norebase", "--nosquash", "-k", "crash"])
  })

  it("refuses release and hotfix branches (they keep the plain finish path)", async () => {
    const { r } = fakeRepo()
    await assert.rejects(finishFeature(r, "release/v1.2.0", { rebase: false, deleteBranch: true }), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "BAD_ARG")
      return true
    })
  })

  it("refuses a branch outside the configured prefixes", async () => {
    const { r } = fakeRepo()
    await assert.rejects(finishFeature(r, "topic/misc", { rebase: false, deleteBranch: true }), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "NOT_FLOW_BRANCH")
      return true
    })
  })
})

describe("finishFeature: rebase + fast-forward path", () => {
  it("unpublished branch: rebase, ff-only merge, local delete, base dropped — no push", async () => {
    const { r, calls } = fakeRepo()
    await finishFeature(r, "feature/login", { rebase: true, deleteBranch: true })
    assert.deepEqual(mutating(calls).slice(-5), [
      ["rebase", "develop", "feature/login"],
      ["checkout", "develop"],
      ["merge", "--ff-only", "feature/login"],
      ["branch", "-d", "feature/login"],
      ["config", "--unset", "gitflow.branch.feature/login.base"],
    ])
    assert.ok(!calls.some(([c]) => c === "push"))
  })

  it("published in-sync branch: the remote branch goes first, like gitflow's own cleanup", async () => {
    const { r, calls } = fakeRepo({ remote: "aaa", local: "aaa" })
    await finishFeature(r, "feature/login", { rebase: true, deleteBranch: true })
    const deletes = calls.filter(([c]) => c === "push" || c === "branch")
    assert.deepEqual(deletes, [
      ["push", "origin", "--delete", "feature/login"],
      ["branch", "-d", "feature/login"],
    ])
  })

  it("keep option: merged but neither branch deleted", async () => {
    const { r, calls } = fakeRepo({ remote: "aaa", local: "aaa" })
    await finishFeature(r, "feature/login", { rebase: true, deleteBranch: false })
    assert.ok(calls.some(([c, f]) => c === "merge" && f === "--ff-only"))
    assert.ok(!calls.some(([c]) => c === "push" || c === "branch"))
  })

  it("diverged remote: refused before any mutation (require_branches_equal parity)", async () => {
    const { r, calls } = fakeRepo({ remote: "bbb", local: "aaa" })
    await assert.rejects(finishFeature(r, "feature/login", { rebase: true, deleteBranch: true }), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "DIVERGED")
      return true
    })
    assert.ok(calls.every(([c]) => c === "config" || c === "rev-parse"))
  })
})
