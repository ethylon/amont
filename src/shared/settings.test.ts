/* Tests for the settings registry's coercion (shared/settings.ts): `coerceSettings` must
   rebuild a valid object from anything — the enum kind (pullMode, the toolbar's Pull options
   card) joined the boolean/int kinds, and a persisted value outside its options must never
   reach `git pull`. `pullModeFlag` is pinned too: the mode values ARE the flag names. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { coerceSettings, pullModeFlag, SETTINGS_DEFAULTS } from "./settings.ts"

describe("coerceSettings: the enum kind (pullMode)", () => {
  it("keeps a value that belongs to the options", () => {
    assert.equal(coerceSettings({ pullMode: "ff-only" }).pullMode, "ff-only")
    assert.equal(coerceSettings({ pullMode: "rebase" }).pullMode, "rebase")
  })

  it("falls back to the default on an unknown or non-string value", () => {
    assert.equal(coerceSettings({ pullMode: "--ff" }).pullMode, "ff")
    assert.equal(coerceSettings({ pullMode: 3 }).pullMode, "ff")
    assert.equal(coerceSettings({}).pullMode, "ff")
  })

  it("defaults to fast-forward if possible", () => {
    assert.equal(SETTINGS_DEFAULTS.pullMode, "ff")
  })
})

describe("pullModeFlag", () => {
  it("maps each mode to its `git pull` flag", () => {
    assert.equal(pullModeFlag("ff"), "--ff")
    assert.equal(pullModeFlag("ff-only"), "--ff-only")
    assert.equal(pullModeFlag("rebase"), "--rebase")
  })
})
