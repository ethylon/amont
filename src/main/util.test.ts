/* basename (main/util.ts): small, but the trailing-separator and mixed-separator edge cases are
   exactly where a hand-rolled path helper drifts from expectations. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { basename } from "./util.ts"

describe("basename", () => {
  it("returns the last segment of a POSIX path", () => {
    assert.equal(basename("/home/user/amont"), "amont")
    assert.equal(basename("amont"), "amont")
  })

  it("handles Windows and mixed separators", () => {
    assert.equal(basename("C:\\Users\\ada\\repo"), "repo")
    assert.equal(basename("C:/Users/ada\\repo"), "repo")
  })

  it("ignores trailing separators", () => {
    assert.equal(basename("/home/user/amont/"), "amont")
    assert.equal(basename("/home/user/amont///"), "amont")
    assert.equal(basename("repo\\"), "repo")
  })

  it("collapses a path made only of separators to an empty string", () => {
    // trailing separators stripped → "" → split → [""] → pop() → ""
    assert.equal(basename("///"), "")
  })
})
