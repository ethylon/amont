/* Migrated from scripts/check-refs.ts (AUDIT.md §10, tests item): same assertions, one `it()`
   per block rather than a script that stops at the first failure. Split off from
   commit-message.test.ts (AUDIT.md §7, phase 5): this file only covers commit-parse.ts,
   see markdown.test.ts for parseMarkdown. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { mergeSource, parseBody, parseMerge, parseRefs, parseSubject } from "./commit-parse.ts"

/** "master*" = remote merged into the local branch */
const fmt = (raw: string) => parseRefs(raw).map((r) => r.name + (r.remotes.length ? "*" : ""))
const eq = (raw: string, expected: string[]) => assert.deepEqual(fmt(raw), expected, raw)

describe("parseRefs", () => {
  it("merges local + its remote into a single chip; origin/HEAD disappears", () => {
    eq("HEAD -> refs/heads/master, refs/remotes/origin/master, refs/remotes/origin/HEAD", ["master*"])
  })

  it("renders a remote with no local branch as a standalone chip, full name", () => {
    eq("refs/remotes/origin/topic", ["origin/topic"])
  })

  it("distinguishes a local named like a remote from that remote (two same-named chips)", () => {
    /* A local literally named "origin/topic" is not the "topic" remote of "origin":
       two refs, two chips, same-named on screen — the ambiguity is git's own. */
    eq("refs/heads/origin/topic, refs/remotes/origin/topic", ["origin/topic", "origin/topic"])
  })

  it("aligns several remotes onto the same local", () => {
    eq("refs/heads/main, refs/remotes/origin/main, refs/remotes/upstream/main", ["main*"])
  })

  it("does not merge a local and the remote of a branch absent from the commit", () => {
    eq("refs/heads/develop, refs/remotes/origin/master", ["develop", "origin/master"])
  })

  it("sorts HEAD, branch, remote, tag regardless of git's order", () => {
    eq("tag: refs/tags/v1, refs/remotes/origin/topic, refs/heads/develop", ["develop", "origin/topic", "v1"])
  })

  it("keeps git's order at equal rank (stable sort)", () => {
    eq("tag: refs/tags/b, tag: refs/tags/a", ["b", "a"])
  })

  it("shows detached HEAD", () => {
    eq("HEAD, refs/heads/master", ["HEAD", "master"])
  })

  it("recognizes the remote by prefix, not segment count (branch with slashes)", () => {
    eq("refs/heads/feature/ui/graph, refs/remotes/origin/feature/ui/graph", ["feature/ui/graph*"])
  })

  it("renders an empty array for a commit with no ref", () => {
    eq("", [])
  })

  it("only triggers the +N fallback on actual overflow (budget invariant)", () => {
    const BUDGET = 2
    for (const raw of [
      "",
      "refs/heads/master",
      "tag: refs/tags/v1, tag: refs/tags/v2",
      "tag: refs/tags/a, tag: refs/tags/b, tag: refs/tags/c, tag: refs/tags/d",
    ]) {
      const refs = parseRefs(raw)
      const shown = refs.slice(0, BUDGET)
      const hidden = refs.slice(BUDGET)
      assert.ok(!hidden.length || shown.length, `"+N" orphaned: ${raw}`)
      assert.ok(!hidden.length || refs.length > BUDGET, `fallback without overflow: ${raw}`)
    }
  })
})

describe("parseBody", () => {
  const body = (raw: string) => {
    const b = parseBody(raw)
    return [b.text, b.coAuthors.map((a) => `${a.name}|${a.email}`)] as const
  }

  it("renders the body as-is with no trailer", () => {
    assert.deepEqual(body("Corps.\n"), ["Corps.", []])
    assert.deepEqual(body(""), ["", []])
  })

  it("extracts co-author trailers, case-insensitive on the field name", () => {
    assert.deepEqual(body("Corps.\n\nCo-authored-by: Ada Lovelace <ada@x.io>\nCo-Authored-By: Alan <alan@x.io>\n"), [
      "Corps.",
      ["Ada Lovelace|ada@x.io", "Alan|alan@x.io"],
    ])
  })

  it("accepts a trailer with no body, and a trailer with no email", () => {
    assert.deepEqual(body("Co-authored-by: Ada <ada@x.io>"), ["", ["Ada|ada@x.io"]])
    assert.deepEqual(body("Co-authored-by: Ada"), ["", ["Ada|"]])
  })

  it("renders a malformed trailer back into the body rather than an anonymous co-author", () => {
    assert.deepEqual(body("Co-authored-by:"), ["Co-authored-by:", []])
  })

  it("does not mistake a plain-text mention for a trailer", () => {
    assert.deepEqual(body("Voir le Co-authored-by: du commit d'avant."), [
      "Voir le Co-authored-by: du commit d'avant.",
      [],
    ])
  })
})

describe("parseMerge / mergeSource", () => {
  it("extracts source and target of a branch merge", () => {
    assert.deepEqual(parseMerge("Merge branch 'feature/x' into develop"), {
      from: "feature/x",
      to: "develop",
      noise: false,
    })
    assert.deepEqual(parseMerge("Merge branch 'hotfix/1.2.1'"), { from: "hotfix/1.2.1", to: null, noise: false })
  })

  it("flags sync merges (remote-tracking, 'x' of <url>) as noise", () => {
    assert.deepEqual(parseMerge("Merge remote-tracking branch 'origin/develop' into develop"), {
      from: "origin/develop",
      to: "develop",
      noise: true,
    })
    assert.deepEqual(parseMerge("Merge branch 'master' of https://forge/depot.git into master"), {
      from: "master",
      to: "master",
      noise: true,
    })
  })

  it("recognizes a tag merge", () => {
    assert.deepEqual(parseMerge("Merge tag 'v1.2.0' into develop"), {
      from: "v1.2.0",
      to: "develop",
      tag: true,
      noise: false,
    })
  })

  it("renders null for a subject that isn't a merge", () => {
    assert.equal(parseMerge("feat: pas un merge"), null)
  })

  it("extracts the source branch of a GitHub PR merge (the owner/ prefix is dropped)", () => {
    assert.equal(mergeSource("Merge pull request #12 from owner/feature/x"), "feature/x")
    assert.equal(mergeSource("Merge branch 'release/2.0'"), "release/2.0")
    assert.equal(mergeSource("chore: rien"), null)
  })
})

describe("parseSubject", () => {
  it("recognizes the type badge, the alias table, and Conventional Commits", () => {
    assert.deepEqual(parseSubject("[FEATURE] ajout du graphe"), {
      type: "feat",
      label: "feat",
      text: "ajout du graphe",
    })
    assert.deepEqual(parseSubject("[HOTFIX] vite"), { type: "hotfix", label: "hotfix", text: "vite" })
    assert.deepEqual(parseSubject("[Machin] chose"), { type: "other", label: "machin", text: "chose" })
    assert.deepEqual(parseSubject("feat(graph): lanes"), { type: "feat", label: "feat · graph", text: "lanes" })
    assert.deepEqual(parseSubject("fix: débordement"), { type: "bugfix", label: "bugfix", text: "débordement" })
  })

  it('leaves any random "truc: machin" as plain text', () => {
    assert.deepEqual(parseSubject("truc: machin"), { type: null, label: null, text: "truc: machin" })
  })
})
