/* Avatar resolution (AUDIT.md §9). The GitHub-noreply → id shortcut and the e-mail lookup are
   the parts with real branching; `initials`/`tint` are deterministic and cheap to pin. */
import assert from "node:assert/strict"
import { beforeAll, describe, it } from "vitest"

const { avatarUrl, githubEmailAvatar, initials, tint } = await import("./avatar.ts")

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

  it("falls back to Gravatar (d=404) for the id-less noreply form", () => {
    const url = avatarUrl("ada@users.noreply.github.com")!
    assert.match(url, /^https:\/\/www\.gravatar\.com\/avatar\/[0-9a-f]{64}\?s=64&d=404$/)
  })

  it("hashes the normalized email, so case/whitespace variants share one Gravatar URL", () => {
    assert.equal(avatarUrl("Ada@X.io"), avatarUrl("  ada@x.io  "))
  })
})

/* The lookup's contract with a server that never 404s: only a byte-difference against the
   placeholder — learned from the sentinel address, never pinned — separates a hit from a miss.
   The fake serves `AVATAR` to addresses it "knows" and `MISS` to everything else (the sentinel
   included), which is exactly the real endpoint's shape. */
describe("githubEmailAvatar — placeholder discrimination", () => {
  const calls: string[] = []
  beforeAll(() => {
    globalThis.fetch = ((input: string | URL) => {
      const url = String(input)
      calls.push(url)
      const email = new URL(url).searchParams.get("email")!
      if (email.endsWith("@down.io")) return Promise.reject(new TypeError("fetch failed"))
      return Promise.resolve(new Response(email.endsWith("@known.io") ? "AVATAR" : "MISS"))
    }) as typeof fetch
  })

  it("resolves an address GitHub knows to the lookup URL", async () => {
    assert.equal(
      await githubEmailAvatar(" Claude@Known.io "),
      "https://avatars.githubusercontent.com/u/e?email=claude%40known.io&s=64"
    )
  })

  it("treats the shared placeholder as a miss", async () => {
    assert.equal(await githubEmailAvatar("nobody@nowhere.io"), null)
  })

  it("asks the network once per address, sentinel included", async () => {
    await githubEmailAvatar("claude@known.io")
    await githubEmailAvatar("Claude@known.io") // normalized to the first call
    const lookups = calls.map((u) => new URL(u).searchParams.get("email"))
    assert.equal(lookups.filter((e) => e === "claude@known.io").length, 1)
    assert.equal(lookups.filter((e) => e!.endsWith(".invalid")).length, 1, "one sentinel probe per session")
  })

  it("misses quietly when offline", async () => {
    assert.equal(await githubEmailAvatar("ada@down.io"), null)
  })

  it("skips the network entirely for an empty email", async () => {
    const before = calls.length
    assert.equal(await githubEmailAvatar("  "), null)
    assert.equal(calls.length, before)
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
