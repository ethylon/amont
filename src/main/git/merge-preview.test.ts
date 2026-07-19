/* Tests for the merge-cascade dry-run (merge-preview.ts): statuses per branch, and the
   cascade discipline — a clean merge folds into a synthetic commit the next branch is
   previewed on, a conflicted branch is left out of the cascade, nothing but object writes
   (`commit-tree`) ever runs.

   `electron` is mocked out for the same reason as flow.test.ts: merge-preview.ts imports
   repos.ts → state.ts, whose module scope imports `app`. */
import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {} }))

import { AppError } from "../../shared/errors.ts"
import type { RepoHandle } from "../repos.ts"
import { mergePreview } from "./merge-preview.ts"

interface FakeState {
  /** local branches, name → sha */
  heads: Record<string, string>
  /** ancestry pairs "a→b": a reachable from b (shas) */
  merged?: string[]
  /** merge-tree result per "cur+sha" pair: tree OID + conflicted paths, or `fail` */
  trees?: Record<string, { tree: string; files?: string[] } | "fail">
}

function fakeRepo(state: FakeState) {
  const calls: string[][] = []
  const merged = new Set(state.merged ?? [])
  let synthetic = 0

  const git = (args: string[]): Promise<string> => {
    calls.push(args)
    const [cmd] = args
    if (cmd === "rev-parse") {
      const ref = args[3]
      const sha = ref.startsWith("refs/heads/") ? state.heads[ref.slice("refs/heads/".length)] : undefined
      return sha ? Promise.resolve(sha + "\n") : Promise.reject(new Error("unknown ref"))
    }
    if (cmd === "merge-base") {
      return merged.has(`${args[2]}→${args[3]}`) ? Promise.resolve("") : Promise.reject(new Error("not an ancestor"))
    }
    if (cmd === "merge-tree") {
      const key = `${args[4]}+${args[5]}`
      const res = state.trees?.[key]
      if (!res || res === "fail") return Promise.reject(new Error("merge-tree failed"))
      return Promise.resolve([res.tree, ...(res.files ?? [])].join("\n") + "\n")
    }
    if (cmd === "commit-tree") return Promise.resolve(`synthetic${++synthetic}\n`)
    return Promise.reject(new Error(`unexpected: git ${args.join(" ")}`))
  }

  return { r: { git } as unknown as RepoHandle, calls }
}

describe("mergePreview (merge-tree cascade dry-run)", () => {
  it("previews clean branches on top of each other through synthetic commits", async () => {
    const { r, calls } = fakeRepo({
      heads: { develop: "d1", "feature/a": "a1", "feature/b": "b1" },
      trees: { "d1+a1": { tree: "t1" }, "synthetic1+b1": { tree: "t2" } },
    })
    const res = await mergePreview(r, "develop", ["feature/a", "feature/b"])
    assert.deepEqual(res, [
      { branch: "feature/a", status: "clean", files: [] },
      { branch: "feature/b", status: "clean", files: [] },
    ])
    /* the second preview ran against the first merge's synthetic commit, not develop */
    const mergeTrees = calls.filter((c) => c[0] === "merge-tree")
    assert.deepEqual(
      mergeTrees.map((c) => c[4]),
      ["d1", "synthetic1"]
    )
    /* the synthetic commit carries both parents of the simulated merge */
    const commitTree = calls.find((c) => c[0] === "commit-tree")!
    assert.deepEqual(commitTree, ["commit-tree", "t1", "-p", "d1", "-p", "a1", "-m", "amont merge preview"])
  })

  it("reports conflicts with their paths and leaves the branch out of the cascade", async () => {
    const { r, calls } = fakeRepo({
      heads: { develop: "d1", "feature/x": "x1", "feature/y": "y1" },
      trees: { "d1+x1": { tree: "t1", files: ["src/a.ts", "src/b.ts"] }, "d1+y1": { tree: "t2" } },
    })
    const res = await mergePreview(r, "develop", ["feature/x", "feature/y"])
    assert.deepEqual(res, [
      { branch: "feature/x", status: "conflicts", files: ["src/a.ts", "src/b.ts"] },
      { branch: "feature/y", status: "clean", files: [] },
    ])
    /* y was previewed against develop itself: the conflicted x never entered the cascade */
    assert.equal(calls.filter((c) => c[0] === "commit-tree").length, 1)
  })

  it("flags an already-reachable branch as merged, without running merge-tree", async () => {
    const { r, calls } = fakeRepo({
      heads: { develop: "d1", "feature/old": "o1" },
      merged: ["o1→d1"],
    })
    assert.deepEqual(await mergePreview(r, "develop", ["feature/old"]), [
      { branch: "feature/old", status: "merged", files: [] },
    ])
    assert.equal(calls.filter((c) => c[0] === "merge-tree").length, 0)
  })

  it("degrades to unknown for a vanished branch or an unsupported merge-tree", async () => {
    const { r } = fakeRepo({
      heads: { develop: "d1", "feature/ok": "k1" },
      trees: { "d1+k1": "fail" },
    })
    assert.deepEqual(await mergePreview(r, "develop", ["feature/gone", "feature/ok"]), [
      { branch: "feature/gone", status: "unknown", files: [] },
      { branch: "feature/ok", status: "unknown", files: [] },
    ])
  })

  it("refuses a bad base, a vanished base and malformed branch lists", async () => {
    const { r } = fakeRepo({ heads: { develop: "d1" } })
    await assert.rejects(mergePreview(r, "-D", ["a"]), (e: AppError) => e.code === "BAD_ARG")
    await assert.rejects(mergePreview(r, "gone", ["a"]), (e: AppError) => e.code === "BAD_ARG")
    await assert.rejects(mergePreview(r, "develop", ["-D"]), (e: AppError) => e.code === "BAD_ARG")
    await assert.rejects(
      mergePreview(r, "develop", "feature/a" as unknown as string[]),
      (e: AppError) => e.code === "BAD_ARG"
    )
  })
})
