/* Avatar resolution (AUDIT.md §9). The GitHub-noreply → id shortcut is the part with real
   branching; `initials`/`tint` are deterministic and cheap to pin. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

const { avatarUrl, initials, tint } = await import("./avatar.ts")

describe("avatarUrl — resolution", () => {
  it("returns null for an empty email", () => {
    assert.equal(avatarUrl(""), null)
  })

  it("derives the GitHub avatar from a noreply address's numeric id", () => {
    assert.equal(avatarUrl("12345+ada@users.noreply.github.com"), "https://avatars.githubusercontent.com/u/12345?s=64")
  })

  it("normalizes case and whitespace before matching the noreply form", () => {
    assert.equal(avatarUrl("  678+Bob@Users.NoReply.GitHub.com  "), "https://avatars.githubusercontent.com/u/678?s=64")
  })

  it("resolves pinned well-known addresses to their GitHub account", () => {
    assert.equal(avatarUrl(" NoReply@Anthropic.com "), "https://avatars.githubusercontent.com/u/81847?s=64")
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
