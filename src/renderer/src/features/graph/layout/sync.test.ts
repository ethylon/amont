/* Local/remote divergence (layout/sync.ts): the walk runs on states produced by the real
   `layoutChunk`, not on hand-built maps — refsOf/fpRow come out exactly as in production. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { createState } from "./state.ts"
import { layoutChunk } from "./lanes.ts"
import { computeSync } from "./sync.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

function laidOut(data: Commit[]) {
  const S = createState()
  layoutChunk(S, (r) => data[r], data.length)
  return S
}

describe("computeSync", () => {
  it("marks the linear ahead range, up to but excluding the upstream tip", () => {
    const S = laidOut([
      c("x1", ["x2"], "local 2", "HEAD -> refs/heads/develop"),
      c("x2", ["base"], "local 1"),
      c("base", ["old"], "shared", "refs/remotes/origin/develop"),
      c("old", [], "older"),
    ])
    const sync = computeSync(S)
    assert.ok(sync)
    assert.deepEqual([...sync.ahead].sort(), [0, 1])
    assert.equal(sync.behind.size, 0)
    assert.equal(sync.upstreamRow, 2)
    assert.equal(sync.upstream, "origin/develop")
  })

  it("splits a diverged history into ahead and behind, excluding the base", () => {
    const S = laidOut([
      c("x1", ["x2"], "local 2", "HEAD -> refs/heads/develop"),
      c("x2", ["base"], "local 1"),
      c("y1", ["y2"], "remote 2", "refs/remotes/origin/develop"),
      c("y2", ["base"], "remote 1"),
      c("base", [], "shared"),
    ])
    const sync = computeSync(S)
    assert.ok(sync)
    assert.deepEqual([...sync.ahead].sort(), [0, 1])
    assert.deepEqual([...sync.behind].sort(), [2, 3])
  })

  it("returns null when HEAD and its upstream share the row", () => {
    const S = laidOut([
      c("tip", ["old"], "synced", "HEAD -> refs/heads/develop, refs/remotes/origin/develop"),
      c("old", [], "older"),
    ])
    assert.equal(computeSync(S), null)
  })

  it("returns null without a remote-tracking ref for the HEAD branch", () => {
    const S = laidOut([
      c("tip", ["old"], "local only", "HEAD -> refs/heads/develop, refs/remotes/origin/master"),
      c("old", [], "older"),
    ])
    assert.equal(computeSync(S), null)
  })

  it("returns null rather than guessing when the chain is not laid out down to the base", () => {
    /* upstream's first-parent (missing) is beyond the laid-out window: fpRow has a hole */
    const S = laidOut([
      c("x1", ["up"], "local", "HEAD -> refs/heads/develop"),
      c("up", ["missing"], "remote tip", "refs/remotes/origin/develop"),
    ])
    const synced = computeSync(S)
    assert.deepEqual(synced && [...synced.ahead], [0], "direct ancestor: no walk past the upstream needed")
    const S2 = laidOut([
      c("x1", ["deep"], "local", "HEAD -> refs/heads/develop"),
      c("up", ["missing"], "remote tip", "refs/remotes/origin/develop"),
    ])
    assert.equal(computeSync(S2), null)
  })

  it("prefers origin over another remote carrying the same branch", () => {
    const S = laidOut([
      c("x1", ["a"], "local", "HEAD -> refs/heads/develop"),
      c("a", ["b"], "fork tip", "refs/remotes/fork/develop"),
      c("b", [], "origin tip", "refs/remotes/origin/develop"),
    ])
    const sync = computeSync(S)
    assert.ok(sync)
    assert.equal(sync.upstream, "origin/develop")
    assert.equal(sync.upstreamRow, 2)
  })
})
