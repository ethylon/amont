/* Tests for the runner's trace contract (exec.ts): what the console receives is what these
   assert. Integration runs against a real temporary repository, like packs.test.ts — the
   trace/telemetry behavior under real exit codes is exactly what regressed (probes traced as
   failures, exits pinned to the wrong command), so no fake child process here. */
import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "vitest"

import type { DistributiveOmit, TraceLine } from "../../shared/types.ts"
import { createGitRunner, type GitRunner } from "./exec.ts"
import type { GitFailureInfo } from "./telemetry-scrub.ts"

type Line = DistributiveOmit<TraceLine, "id">

let dir: string
let runner: GitRunner
let trace: Line[]
let failures: GitFailureInfo[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "amont-exec-"))
  trace = []
  failures = []
  runner = createGitRunner({
    path: dir,
    trace: (l) => trace.push(l),
    onFailure: (f) => failures.push(f),
    children: new Set(),
  })
  await runner.git(["init", "-q"])
  trace.length = 0
})

afterEach(() => rm(dir, { recursive: true, force: true }))

const exits = () => trace.filter((l): l is Extract<Line, { kind: "exit" }> => l.kind === "exit")
const cmds = () => trace.filter((l): l is Extract<Line, { kind: "cmd" }> => l.kind === "cmd")

describe("okCodes and the trace", () => {
  it("an absent pseudo-ref probe (exit 1 declared) resolves empty and traces a success", async () => {
    const out = await runner.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { okCodes: [1] })
    assert.equal(out, "")
    assert.deepEqual(
      exits().map((l) => l.ok),
      [true]
    )
    assert.deepEqual(failures, [])
  })

  it("the same probe without the declaration still rejects, traces ✗ and rings telemetry", async () => {
    await assert.rejects(runner.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]))
    assert.deepEqual(
      exits().map((l) => l.ok),
      [false]
    )
    assert.equal(failures.length, 1)
  })
})

describe("seq: the exit is attributable to its command", () => {
  it("numbers each command and stamps its exit with the same seq", async () => {
    await runner.git(["rev-parse", "--git-dir"])
    await runner.git(["rev-parse", "--git-dir"])
    assert.deepEqual(
      cmds().map((l) => l.seq),
      [2, 3] // the init of the fixture consumed seq 1: the counter never reuses a number
    )
    assert.deepEqual(
      exits().map((l) => l.seq),
      [2, 3]
    )
  })

  it("interleaved commands: each exit still carries the seq of its own cmd", async () => {
    /* both in flight at once, like the post-fetch refresh; completion order is theirs */
    await Promise.all([
      runner.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"], { okCodes: [1] }),
      runner.git(["rev-parse", "--git-dir"]),
    ])
    const bySeq = new Map(cmds().map((l) => [l.seq, l.text]))
    for (const e of exits()) {
      assert.equal(e.ok, true)
      assert.ok(e.seq !== undefined && bySeq.has(e.seq), `exit seq ${e.seq} has a cmd line`)
    }
    assert.equal(exits().length, 2)
  })

  it("a failing command's ✗ carries its seq too", async () => {
    await assert.rejects(runner.git(["rev-parse", "--verify", "no-such-ref"]))
    const exit = exits()[0]
    assert.equal(exit.ok, false)
    assert.equal(exit.seq, cmds()[0]?.seq)
  })
})
