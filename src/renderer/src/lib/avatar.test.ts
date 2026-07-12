/* Avatar resolution (AUDIT.md §9). The privacy default (network off) and the GitHub-noreply →
   id shortcut are the parts with real branching; `initials`/`tint` are deterministic and cheap to
   pin. Runs under node, so localStorage — which prefs.ts reads through — is stubbed in memory. */
import assert from "node:assert/strict"
import { beforeEach, describe, it } from "vitest"

/* prefs.ts touches localStorage lazily (inside get/set), so an in-memory stub set before the
   first call is enough — no need to intercept the module import. */
const store = new Map<string, string>()
globalThis.localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0,
}

const { avatarUrl, initials, tint, setAvatarsEnabled } = await import("./avatar.ts")

beforeEach(() => store.clear())

describe("avatarUrl — privacy gate", () => {
  it("returns null while network avatars are off (the default)", () => {
    assert.equal(avatarUrl("ada@x.io"), null)
  })

  it("returns null for an empty email even when enabled", () => {
    setAvatarsEnabled(true)
    assert.equal(avatarUrl(""), null)
  })
})

describe("avatarUrl — resolution when enabled", () => {
  beforeEach(() => setAvatarsEnabled(true))

  it("derives the GitHub avatar from a noreply address's numeric id", () => {
    assert.equal(avatarUrl("12345+ada@users.noreply.github.com"), "https://avatars.githubusercontent.com/u/12345?s=64")
  })

  it("normalizes case and whitespace before matching the noreply form", () => {
    assert.equal(avatarUrl("  678+Bob@Users.NoReply.GitHub.com  "), "https://avatars.githubusercontent.com/u/678?s=64")
  })

  it("falls back to Gravatar (d=404) for the id-less noreply form", () => {
    const url = avatarUrl("ada@users.noreply.github.com")!
    assert.match(url, /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?s=64&d=404$/)
  })

  it("hashes the normalized email, so case/whitespace variants share one Gravatar URL", () => {
    assert.equal(avatarUrl("Ada@X.io"), avatarUrl("  ada@x.io  "))
  })
})

describe("initials", () => {
  it("takes the first letter of the first two words, uppercased", () => {
    assert.equal(initials("Ada Lovelace"), "AL")
    assert.equal(initials("grace brewster hopper"), "GB")
  })

  it("handles a single word and collapses extra whitespace", () => {
    assert.equal(initials("Ada"), "A")
    assert.equal(initials("  Ada   Lovelace  "), "AL")
  })
})

describe("tint", () => {
  it("is a deterministic lane-palette var keyed on the email", () => {
    const c = tint("Ada", "ada@x.io")
    assert.match(c, /^var\(--lane-\d+\)$/)
    assert.equal(tint("Anyone", "ada@x.io"), c, "same email → same tint regardless of name")
  })

  it("keys on the name when the email is empty", () => {
    assert.equal(tint("Ada", ""), tint("Ada", ""))
  })
})
