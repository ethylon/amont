/* Tests for the console's exit↔cmd join (trace-lines.ts): under parallel reads the trace
   lines interleave, and both the panel's ✗ placement and the screen-reader announcement
   used to guess positionally — a late exit landed under whichever command was displayed
   last. Everything here goes through `seq`. */
import { describe, expect, it } from "vitest"

import type { TraceLine } from "@/lib/git"
import { displayOrder, lastFailure } from "@/features/console/trace-lines"

const ID = 1
const cmd = (seq: number, text: string): TraceLine => ({ id: ID, kind: "cmd", text, seq })
const out = (seq: number, text: string): TraceLine => ({ id: ID, kind: "out", text, seq })
const exit = (seq: number | undefined, ok: boolean): TraceLine => ({ id: ID, kind: "exit", ok, ms: 5, seq })

describe("displayOrder", () => {
  it("leaves a sequential run untouched", () => {
    const lines = [cmd(1, "git status"), out(1, "clean"), exit(1, false)]
    expect(displayOrder(lines)).toEqual(lines)
  })

  it("renders the ✗ under its own cmd despite interleaved lines", () => {
    /* the observed case: a *_HEAD probe fails late, after another command's lines landed —
       its ✗ used to show under `for-each-ref`, which had succeeded */
    const lines = [
      cmd(1, "git rev-parse -q --verify MERGE_HEAD"),
      cmd(2, "git for-each-ref --merged origin/master"),
      out(2, "refs/heads/done"),
      exit(1, false),
      exit(2, true),
    ]
    expect(displayOrder(lines)).toEqual([
      cmd(1, "git rev-parse -q --verify MERGE_HEAD"),
      exit(1, false),
      cmd(2, "git for-each-ref --merged origin/master"),
      out(2, "refs/heads/done"),
      exit(2, true),
    ])
  })

  it("anchors the ✗ after the failed command's last output, not right after the cmd", () => {
    const lines = [cmd(1, "git fetch"), out(1, "fatal: unable to access"), cmd(2, "git status"), exit(1, false)]
    expect(displayOrder(lines)).toEqual([
      cmd(1, "git fetch"),
      out(1, "fatal: unable to access"),
      exit(1, false),
      cmd(2, "git status"),
    ])
  })

  it("keeps line count and relative order across several moved exits", () => {
    const lines = [cmd(1, "a"), cmd(2, "b"), cmd(3, "c"), exit(2, false), exit(1, false), exit(3, true)]
    const ordered = displayOrder(lines)
    expect(ordered).toHaveLength(lines.length)
    expect(ordered).toEqual([cmd(1, "a"), exit(1, false), cmd(2, "b"), exit(2, false), cmd(3, "c"), exit(3, true)])
  })

  it("an exit whose cmd left the buffer (cap) stays in place", () => {
    const lines = [cmd(7, "git status"), exit(3, false)]
    expect(displayOrder(lines)).toEqual(lines)
  })

  it("an exit without seq (emitted outside the runner) stays in place", () => {
    const lines = [cmd(1, "git log"), exit(undefined, false)]
    expect(displayOrder(lines)).toEqual(lines)
  })
})

describe("lastFailure", () => {
  it("nothing failed: null", () => {
    expect(lastFailure([cmd(1, "git status"), exit(1, true)])).toBeNull()
  })

  it("finds the failed command by seq, not by position", () => {
    const lines = [
      cmd(1, "git rev-parse -q --verify MERGE_HEAD"),
      cmd(2, "git for-each-ref --merged origin/master"),
      exit(1, false),
    ]
    expect(lastFailure(lines)).toEqual({ cmd: "git rev-parse -q --verify MERGE_HEAD" })
  })

  it("the most recent failure wins", () => {
    const lines = [cmd(1, "git a"), exit(1, false), cmd(2, "git b"), exit(2, false)]
    expect(lastFailure(lines)).toEqual({ cmd: "git b" })
  })

  it("cmd evicted or seq absent: the failure is reported without a command", () => {
    expect(lastFailure([exit(9, false)])).toEqual({ cmd: null })
    expect(lastFailure([cmd(1, "git log"), exit(undefined, false)])).toEqual({ cmd: null })
  })
})
