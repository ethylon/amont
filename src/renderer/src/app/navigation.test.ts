import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Repo } from "@/lib/git"
import { afterClose, HOME, navKeyEquals, repoKey, transitionKind } from "./navigation.ts"

const repo = (id: number, name = `r${id}`): Repo => ({ id, path: `/repo/${name}`, name })

describe("navKeyEquals", () => {
  it("two HOME are equal", () => {
    assert.equal(navKeyEquals(HOME, HOME), true)
  })
  it("two repoKey with the same id are equal", () => {
    assert.equal(navKeyEquals(repoKey(1), repoKey(1)), true)
  })
  it("HOME and a repoKey are never equal", () => {
    assert.equal(navKeyEquals(HOME, repoKey(1)), false)
  })
  it("two repoKey with different ids are not equal", () => {
    assert.equal(navKeyEquals(repoKey(1), repoKey(2)), false)
  })
})

describe("transitionKind", () => {
  const tabs = [repo(1), repo(2), repo(3)]

  it("a key absent from the tabs opens head-on", () => {
    assert.equal(transitionKind(tabs, HOME, repoKey(42)), "open")
  })

  it("home is never 'open': it's always at position 0", () => {
    assert.equal(transitionKind(tabs, repoKey(1), HOME), "prev")
  })

  it("moving to a tab further right slides as 'next'", () => {
    assert.equal(transitionKind(tabs, repoKey(1), repoKey(3)), "next")
  })

  it("going back to a tab further left slides as 'prev'", () => {
    assert.equal(transitionKind(tabs, repoKey(3), repoKey(1)), "prev")
  })

  it("from home to the first tab: 'next'", () => {
    assert.equal(transitionKind(tabs, HOME, repoKey(1)), "next")
  })
})

describe("afterClose", () => {
  const tabs = [repo(1), repo(2), repo(3)]

  it("closing a tab that isn't active leaves the active one unchanged", () => {
    assert.deepEqual(afterClose(tabs, repoKey(2), 3), repoKey(2))
  })

  it("closing the active tab falls back to its right neighbor (same index)", () => {
    assert.deepEqual(afterClose(tabs, repoKey(1), 1), repoKey(2))
  })

  it("closing the last active tab falls back to its left neighbor", () => {
    assert.deepEqual(afterClose(tabs, repoKey(3), 3), repoKey(2))
  })

  it("closing the only active tab falls back to home", () => {
    assert.deepEqual(afterClose([repo(1)], repoKey(1), 1), HOME)
  })

  it("closing an unknown tab (already closed) is a no-op", () => {
    assert.deepEqual(afterClose(tabs, repoKey(2), 99), repoKey(2))
  })

  it("active home is never affected by a close", () => {
    assert.deepEqual(afterClose(tabs, HOME, 2), HOME)
  })
})
