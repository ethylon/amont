/* Tests for the native git-flow sequences (flow.ts): the exact git invocations behind
   start, publish and finish, checked against git-flow AVH's own command order — merge before
   tag, the TAG (not the branch) back-merged into develop, remote branch deleted before the
   local one, recorded base dropped. Plus the guards: diverged remote refused before any
   mutation, leftover tag refused, and the idempotent resume after a hand-resolved conflict.

   `electron` is mocked out for the same reason as ops.test.ts: flow.ts drags in repos.ts →
   state.ts, whose module scope imports `app`. */
import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {} }))

import { AppError } from "../../shared/errors.ts"
import type { RepoHandle } from "../repos.ts"
import { finishFeature, finishFlow, flowInit, flowPublish, flowStart } from "./flow.ts"

const PREFIXES = [
  "gitflow.prefix.feature feature/",
  "gitflow.prefix.bugfix bugfix/",
  "gitflow.prefix.release release/",
  "gitflow.prefix.hotfix hotfix/",
].join("\n")

interface FakeState {
  /** local branches, name → sha */
  heads?: Record<string, string>
  /** remote-tracking refs, "origin/name" → sha */
  remotes?: Record<string, string>
  /** tags, name → sha */
  tags?: Record<string, string>
  /** extra `config --get` answers (gitflow.branch.<b>.base, gitflow.prefix.versiontag…) */
  cfg?: Record<string, string>
  /** ancestry pairs "<a>→<b>" (full refs as the commands pass them): a reachable from b */
  merged?: string[]
  /** `rev-parse --abbrev-ref HEAD` */
  current?: string
  /** commits in `base..branch` for the ff-vs-merge probe, keyed "base..branch" (default 2) */
  ahead?: Record<string, number>
}

/** Minimal handle: `git` replays a canned repo state and records every call — the
    assertions are about the exact command sequences. */
function fakeRepo(state: FakeState = {}) {
  const heads = state.heads ?? { master: "m1", develop: "d1" }
  const cfg: Record<string, string> = {
    "gitflow.branch.master": "master",
    "gitflow.branch.develop": "develop",
    ...state.cfg,
  }
  const merged = new Set(state.merged ?? [])
  const calls: string[][] = []

  const resolve = (ref: string): string | null => {
    if (ref === "HEAD") return state.current ? "h1" : null
    if (ref.startsWith("refs/heads/")) return heads[ref.slice("refs/heads/".length)] ?? null
    if (ref.startsWith("refs/remotes/")) return state.remotes?.[ref.slice("refs/remotes/".length)] ?? null
    if (ref.startsWith("refs/tags/")) return state.tags?.[ref.slice("refs/tags/".length)] ?? null
    return null
  }

  const git = (args: string[]) => {
    calls.push(args)
    const [cmd] = args
    if (cmd === "config" && args[1] === "--get-regexp") return Promise.resolve(PREFIXES)
    if (cmd === "config" && args[1] === "--get") {
      const v = cfg[args[2]]
      return v !== undefined ? Promise.resolve(`${v}\n`) : Promise.reject(new Error("no such key"))
    }
    if (cmd === "for-each-ref") return Promise.resolve(Object.keys(heads).join("\n"))
    if (cmd === "rev-parse" && args[1] === "--abbrev-ref") return Promise.resolve(`${state.current ?? "develop"}\n`)
    if (cmd === "rev-parse") {
      const sha = resolve(args.at(-1)!)
      return sha ? Promise.resolve(`${sha}\n`) : Promise.reject(new Error("unknown ref"))
    }
    if (cmd === "merge-base") {
      return merged.has(`${args[2]}→${args[3]}`) ? Promise.resolve("") : Promise.reject(new Error("not an ancestor"))
    }
    if (cmd === "rev-list") {
      const n = state.ahead?.[args.at(-1)!] ?? 2
      return Promise.resolve(
        Array.from({ length: Math.min(n, 2) }, (_, i) => `sha${i}`)
          .join("\n")
          .concat("\n")
      )
    }
    return Promise.resolve("")
  }
  const r = { running: null, muted: 0, dirty: false, gen: 0, events: { trace: () => {} }, git }
  return { r: r as unknown as RepoHandle, calls }
}

/** Drops the read-only preamble — `config --unset`/sets stay. */
const mutating = (calls: string[][]) =>
  calls.filter(
    ([c, a]) =>
      c !== "rev-parse" &&
      c !== "merge-base" &&
      c !== "for-each-ref" &&
      c !== "rev-list" &&
      !(c === "config" && a.startsWith("--get"))
  )

describe("flowStart: native start sequence", () => {
  it("feature: records the base and branches off develop", async () => {
    const { r, calls } = fakeRepo()
    await flowStart(r, "feature", "login")
    assert.deepEqual(mutating(calls), [
      ["config", "gitflow.branch.feature/login.base", "develop"],
      ["checkout", "-b", "feature/login", "develop"],
    ])
  })

  it("hotfix branches off master by default", async () => {
    const { r, calls } = fakeRepo()
    await flowStart(r, "hotfix", "1.0.1")
    assert.deepEqual(mutating(calls), [
      ["config", "gitflow.branch.hotfix/1.0.1.base", "master"],
      ["checkout", "-b", "hotfix/1.0.1", "master"],
    ])
  })

  it("an explicit base wins over the trunk", async () => {
    const { r, calls } = fakeRepo({ heads: { master: "m1", develop: "d1", "release/2.0.0": "r1" } })
    await flowStart(r, "bugfix", "late", "release/2.0.0")
    assert.deepEqual(mutating(calls).at(-1), ["checkout", "-b", "bugfix/late", "release/2.0.0"])
  })

  it("existing branch: EXISTS before any mutation", async () => {
    const { r, calls } = fakeRepo({ heads: { master: "m1", develop: "d1", "feature/login": "f1" } })
    await assert.rejects(flowStart(r, "feature", "login"), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "EXISTS")
      return true
    })
    assert.deepEqual(mutating(calls), [])
  })

  it("release whose finish tag already exists: EXISTS", async () => {
    const { r } = fakeRepo({ tags: { "v1.2.0": "t1" }, cfg: { "gitflow.prefix.versiontag": "v" } })
    await assert.rejects(flowStart(r, "release", "1.2.0"), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "EXISTS")
      assert.equal(e.detail, "v1.2.0")
      return true
    })
  })

  it("trunk behind its remote: DIVERGED", async () => {
    const { r, calls } = fakeRepo({ remotes: { "origin/develop": "d2" } })
    await assert.rejects(flowStart(r, "feature", "x"), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "DIVERGED")
      return true
    })
    assert.deepEqual(mutating(calls), [])
  })

  it("a second release in parallel is allowed (no AVH single-release guard)", async () => {
    const { r, calls } = fakeRepo({ heads: { master: "m1", develop: "d1", "release/1.0.0": "r1" } })
    await flowStart(r, "release", "1.1.0")
    assert.deepEqual(mutating(calls).at(-1), ["checkout", "-b", "release/1.1.0", "develop"])
  })
})

describe("flowPublish: native publish sequence", () => {
  it("fetches, pushes with upstream, checks the branch out", async () => {
    const { r, calls } = fakeRepo({ heads: { master: "m1", develop: "d1", "feature/login": "f1" } })
    await flowPublish(r, "feature", "login")
    assert.deepEqual(mutating(calls), [
      ["fetch", "origin"],
      ["push", "-u", "origin", "feature/login:feature/login"],
      ["checkout", "feature/login"],
    ])
  })

  it("already published: EXISTS, no push", async () => {
    const { r, calls } = fakeRepo({
      heads: { master: "m1", develop: "d1", "feature/login": "f1" },
      remotes: { "origin/feature/login": "f1" },
    })
    await assert.rejects(flowPublish(r, "feature", "login"), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "EXISTS")
      return true
    })
    assert.ok(!calls.some(([c]) => c === "push"))
  })
})

describe("finishFeature: native merge path", () => {
  it("merges --no-ff into develop and deletes by default", async () => {
    const { r, calls } = fakeRepo()
    await finishFeature(r, "feature/login", { rebase: false, deleteBranch: true })
    assert.deepEqual(mutating(calls), [
      ["checkout", "develop"],
      ["merge", "--no-ff", "feature/login"],
      ["branch", "-d", "feature/login"],
      ["config", "--unset", "gitflow.branch.feature/login.base"],
    ])
  })

  it("keeps the branch with the keep option", async () => {
    const { r, calls } = fakeRepo()
    await finishFeature(r, "bugfix/crash", { rebase: false, deleteBranch: false })
    assert.ok(!calls.some(([c]) => c === "branch" || c === "push"))
    assert.ok(calls.some(([c, f]) => c === "merge" && f === "--no-ff"))
  })

  it("published in-sync branch: the remote branch goes first, like gitflow's own cleanup", async () => {
    const { r, calls } = fakeRepo({
      remotes: { "origin/feature/login": "f1" },
      merged: ["refs/remotes/origin/feature/login→refs/heads/feature/login"],
    })
    await finishFeature(r, "feature/login", { rebase: false, deleteBranch: true })
    const deletes = calls.filter(([c]) => c === "push" || c === "branch")
    assert.deepEqual(deletes, [
      ["push", "origin", "--delete", "feature/login"],
      ["branch", "-d", "feature/login"],
    ])
  })

  it("diverged remote: refused before any mutation", async () => {
    const { r, calls } = fakeRepo({ remotes: { "origin/feature/login": "f2" } })
    await assert.rejects(finishFeature(r, "feature/login", { rebase: false, deleteBranch: true }), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "DIVERGED")
      return true
    })
    assert.deepEqual(mutating(calls), [])
  })

  it("resume after a hand-resolved conflict: no second merge, cleanup only", async () => {
    const { r, calls } = fakeRepo({ merged: ["refs/heads/feature/login→refs/heads/develop"] })
    await finishFeature(r, "feature/login", { rebase: false, deleteBranch: true })
    assert.ok(!calls.some(([c]) => c === "merge"))
    assert.deepEqual(mutating(calls), [
      ["checkout", "develop"],
      ["branch", "-d", "feature/login"],
      ["config", "--unset", "gitflow.branch.feature/login.base"],
    ])
  })

  it("refuses release and hotfix branches (they keep the tagged finish path)", async () => {
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
    const { r, calls } = fakeRepo({ heads: { master: "m1", develop: "d1", "feature/login": "aaa" } })
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

  it("remote merely ahead or behind: refused (rebase rewrites, strict equality required)", async () => {
    const { r, calls } = fakeRepo({
      heads: { master: "m1", develop: "d1", "feature/login": "aaa" },
      remotes: { "origin/feature/login": "bbb" },
    })
    await assert.rejects(finishFeature(r, "feature/login", { rebase: true, deleteBranch: true }), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "DIVERGED")
      return true
    })
    assert.deepEqual(mutating(calls), [])
  })
})

describe("finishFlow: release/hotfix native sequence", () => {
  const RELEASE = {
    heads: { master: "m1", develop: "d1", "release/1.2.0": "r1" },
    cfg: { "gitflow.prefix.versiontag": "v", "gitflow.branch.release/1.2.0.base": "develop" },
  }

  it("release: merge into master, tag on master, back-merge THE TAG into develop, cleanup", async () => {
    const { r, calls } = fakeRepo(RELEASE)
    await finishFlow(r, "release/1.2.0")
    assert.deepEqual(mutating(calls), [
      ["checkout", "master"],
      ["merge", "--no-ff", "release/1.2.0"],
      ["tag", "-a", "v1.2.0", "-m", "1.2.0", "master"],
      ["checkout", "develop"],
      ["merge", "--no-ff", "v1.2.0"],
      ["branch", "-d", "release/1.2.0"],
      ["config", "--unset", "gitflow.branch.release/1.2.0.base"],
    ])
  })

  it("hotfix defaults its base to master and back-merges into develop", async () => {
    const { r, calls } = fakeRepo({
      heads: { master: "m1", develop: "d1", "hotfix/1.2.1": "h1" },
      cfg: { "gitflow.prefix.versiontag": "v" },
    })
    await finishFlow(r, "hotfix/1.2.1")
    assert.deepEqual(
      mutating(calls).slice(0, 5),
      [
        ["checkout", "master"],
        ["merge", "--no-ff", "hotfix/1.2.1"],
        ["tag", "-a", "v1.2.1", "-m", "1.2.1", "master"],
        ["checkout", "develop"],
        ["merge", "--no-ff", "v1.2.1"],
      ]
    )
  })

  it("hotfix with no commits: refused, like AVH's 'You need some commits'", async () => {
    const { r, calls } = fakeRepo({
      heads: { master: "m1", develop: "d1", "hotfix/1.2.1": "m1" },
      cfg: { "gitflow.prefix.versiontag": "v" },
    })
    await assert.rejects(finishFlow(r, "hotfix/1.2.1"), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "GIT_FAILED")
      return true
    })
    assert.deepEqual(mutating(calls), [])
  })

  it("resume after a back-merge conflict resolved by hand: only the cleanup remains", async () => {
    const { r, calls } = fakeRepo({
      ...RELEASE,
      tags: { "v1.2.0": "t1" },
      merged: ["refs/heads/release/1.2.0→refs/heads/master", "refs/tags/v1.2.0→refs/heads/develop"],
    })
    await finishFlow(r, "release/1.2.0")
    assert.deepEqual(mutating(calls), [
      ["branch", "-d", "release/1.2.0"],
      ["config", "--unset", "gitflow.branch.release/1.2.0.base"],
    ])
  })

  it("a leftover tag of the same name (branch not merged): EXISTS", async () => {
    const { r, calls } = fakeRepo({ ...RELEASE, tags: { "v1.2.0": "old" } })
    await assert.rejects(finishFlow(r, "release/1.2.0"), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "EXISTS")
      assert.equal(e.detail, "v1.2.0")
      return true
    })
    assert.deepEqual(mutating(calls), [])
  })

  it("published release: remote branch deleted before the local one", async () => {
    const { r, calls } = fakeRepo({
      ...RELEASE,
      remotes: { "origin/release/1.2.0": "r1" },
      merged: ["refs/remotes/origin/release/1.2.0→refs/heads/release/1.2.0"],
    })
    await finishFlow(r, "release/1.2.0")
    const deletes = calls.filter(([c]) => c === "push" || c === "branch")
    assert.deepEqual(deletes, [
      ["push", "origin", "--delete", "release/1.2.0"],
      ["branch", "-d", "release/1.2.0"],
    ])
  })

  it("feature via the generic finish: AVH default fast-forwards a single commit", async () => {
    const { r, calls } = fakeRepo({ ahead: { "develop..feature/one": 1 } })
    await finishFlow(r, "feature/one")
    assert.ok(calls.some(([c, f]) => c === "merge" && f === "--ff"))
  })

  it("feature via the generic finish: two commits get a merge commit", async () => {
    const { r, calls } = fakeRepo({ ahead: { "develop..feature/two": 2 } })
    await finishFlow(r, "feature/two")
    assert.ok(calls.some(([c, f]) => c === "merge" && f === "--no-ff"))
  })
})

describe("flowInit: native wiring", () => {
  const CFG = {
    master: "master",
    develop: "develop",
    feature: "feature/",
    bugfix: "bugfix/",
    release: "release/",
    hotfix: "hotfix/",
    support: "support/",
    versiontag: "v",
  }

  it("both trunks present: writes the config, nothing else", async () => {
    const { r, calls } = fakeRepo({ current: "master" })
    await flowInit(r, CFG)
    assert.deepEqual(
      mutating(calls).map(([c]) => c),
      Array.from({ length: 8 }, () => "config")
    )
  })

  it("develop missing: created off master without tracking, then checked out", async () => {
    const { r, calls } = fakeRepo({ heads: { master: "m1" }, current: "master" })
    await flowInit(r, CFG)
    assert.deepEqual(mutating(calls).slice(-2), [
      ["branch", "--no-track", "develop", "master"],
      ["checkout", "develop"],
    ])
  })

  it("empty repo: seeded with an initial commit before the trunks", async () => {
    const { r, calls } = fakeRepo({ heads: {} })
    await flowInit(r, CFG)
    assert.deepEqual(mutating(calls).slice(-4), [
      ["symbolic-ref", "HEAD", "refs/heads/master"],
      ["commit", "--allow-empty", "-m", "Initial commit"],
      ["branch", "--no-track", "develop", "master"],
      ["checkout", "develop"],
    ])
  })

  it("master missing on a repo that has commits: refused, not invented", async () => {
    const { r } = fakeRepo({ heads: { trunk: "t1" }, current: "trunk" })
    await assert.rejects(flowInit(r, CFG), (e: unknown) => {
      assert.ok(e instanceof AppError)
      assert.equal(e.code, "BAD_ARG")
      assert.equal(e.detail, "master")
      return true
    })
  })
})
