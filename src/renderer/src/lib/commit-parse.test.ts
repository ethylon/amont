/* Migrated from scripts/check-refs.ts (AUDIT.md §10, tests item): same assertions, one `it()`
   per block rather than a script that stops at the first failure. Split off from
   commit-message.test.ts (AUDIT.md §7, phase 5): this file only covers commit-parse.ts,
   see markdown.test.ts for parseMarkdown. */
import assert from "node:assert/strict"
import { afterEach, describe, it } from "vitest"

import {
  isCustomType,
  parseBody,
  parseMerge,
  parseRefs,
  parseSubject,
  prefixColorVar,
  setCustomPrefixes,
  setNeutralizedColors,
  typeColor,
  typesOfColor,
} from "./commit-parse.ts"

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
    assert.deepEqual(body("See the Co-authored-by: from the previous commit."), [
      "See the Co-authored-by: from the previous commit.",
      [],
    ])
  })
})

describe("parseMerge", () => {
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
    assert.equal(parseMerge("feat: not a merge"), null)
  })

  it("recognizes a GitHub PR merge: number in `pr`, owner/ prefix dropped, no target", () => {
    assert.deepEqual(parseMerge("Merge pull request #142 from ethylon/claude/branches-panel-separators-t4no79"), {
      from: "claude/branches-panel-separators-t4no79",
      to: null,
      pr: 142,
      noise: false,
    })
    assert.deepEqual(parseMerge("Merge pull request #12 from owner/feature/x"), {
      from: "feature/x",
      to: null,
      pr: 12,
      noise: false,
    })
  })

  it("keeps a slash-less PR source as-is, and ignores the Bitbucket Server form", () => {
    assert.equal(parseMerge("Merge pull request #5 from renovate")?.from, "renovate")
    /* "Merge pull request #N in PROJ/repo from x to y" (Bitbucket Server): not the GitHub
       format — stays plain text rather than chipping a wrong source. */
    assert.equal(parseMerge("Merge pull request #7 in PROJ/repo from feature/x to master"), null)
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
    assert.deepEqual(parseSubject("fix: débordement"), { type: "fix", label: "fix", text: "débordement" })
    assert.deepEqual(parseSubject("polish(ui): nettoyage"), { type: "polish", label: "polish · ui", text: "nettoyage" })
  })

  it('leaves any random "truc: machin" as plain text', () => {
    assert.deepEqual(parseSubject("truc: machin"), { type: null, label: null, text: "truc: machin" })
  })

  it('gives git\'s own `Revert "…"` subject the revert badge, quoting out the undone subject', () => {
    assert.deepEqual(parseSubject('Revert "feat: ajout du graphe"'), {
      type: "revert",
      label: "revert",
      text: "feat: ajout du graphe",
      revert: true,
    })
    /* a nested revert keeps the inner quotes intact */
    assert.deepEqual(parseSubject('Revert "Revert "fix: x""').text, 'Revert "fix: x"')
    /* the conventional prefix keeps its usual (non-struck) treatment */
    assert.equal(parseSubject("revert: retour arrière").revert, undefined)
    /* an unquoted or foreign "Revert…" subject stays plain text */
    assert.deepEqual(parseSubject("Reverted the thing"), { type: null, label: null, text: "Reverted the thing" })
  })
})

describe("custom prefix rules", () => {
  afterEach(() => setCustomPrefixes([])) // the registry is module state — leave it clean for others

  it("turns an unknown [TAG] into a typed 'lane' badge instead of the neutral 'other'", () => {
    setCustomPrefixes(["epic"])
    assert.deepEqual(parseSubject("[EPIC] big thing"), { type: "epic", label: "epic", text: "big thing" })
    assert.equal(typeColor("epic"), "lane") // color itself comes from a per-theme CSS var
    assert.equal(isCustomType("epic"), true)
  })

  it("gives an unknown conventional prefix a badge, keeping its scope", () => {
    setCustomPrefixes(["spike"])
    assert.deepEqual(parseSubject("spike: try it"), { type: "spike", label: "spike", text: "try it" })
    assert.deepEqual(parseSubject("spike(api): try it"), { type: "spike", label: "spike · api", text: "try it" })
    assert.equal(typeColor("spike"), "lane")
  })

  it("matches a prefix regardless of case/punctuation, in either the [TAG] or the prefix: form", () => {
    setCustomPrefixes(["Epic"])
    assert.equal(parseSubject("[epic] a").type, "epic")
    assert.equal(parseSubject("[EPIC] b").type, "epic")
    assert.equal(parseSubject("epic: c").type, "epic")
  })

  it("never overrides a built-in type (built-ins win)", () => {
    setCustomPrefixes(["feat"])
    assert.deepEqual(parseSubject("feat: x"), { type: "feat", label: "feat", text: "x" })
    assert.equal(typeColor("feat"), "success") // built-in color, not the generic lane
  })

  it("leaves a non-matching prefix as plain text", () => {
    setCustomPrefixes(["epic"])
    assert.deepEqual(parseSubject("note: nothing"), { type: null, label: null, text: "note: nothing" })
  })

  it("folds and de-dupes prefixes, dropping blanks", () => {
    setCustomPrefixes(["  ", "Epic", "[epic]"]) // blank ignored; both fold to "epic"
    assert.equal(isCustomType("epic"), true)
    assert.equal(parseSubject("[EPIC] x").type, "epic")
  })

  it("falls back to the neutral 'other' badge once its rule is cleared", () => {
    setCustomPrefixes([])
    assert.deepEqual(parseSubject("[EPIC] x"), { type: "other", label: "epic", text: "x" })
    assert.equal(isCustomType("epic"), false)
    assert.equal(typeColor("other"), "neutral")
  })

  it("builds a safe CSS custom-property name from any prefix", () => {
    assert.equal(prefixColorVar("Epic-1"), "--amont-prefix-epic1")
    assert.equal(prefixColorVar("[HOT FIX]"), "--amont-prefix-hotfix")
  })
})

describe("typesOfColor", () => {
  const HUES = [
    "success",
    "warning",
    "perf",
    "danger",
    "revert",
    "release",
    "info",
    "refactor",
    "polish",
    "beta",
    "wip",
    "plugin",
    "chore",
    "docs",
    "style",
    "ci",
    "build",
  ] as const

  it("maps each editable hue back to the single type badge it drives (Settings ▸ Colors rows)", () => {
    assert.deepEqual(typesOfColor("success"), ["feat"]) // `feature` collapses into `feat` (same icon)
    assert.deepEqual(typesOfColor("warning"), ["bugfix"])
    assert.deepEqual(typesOfColor("perf"), ["perf"])
    assert.deepEqual(typesOfColor("danger"), ["hotfix"])
    assert.deepEqual(typesOfColor("revert"), ["revert"])
    assert.deepEqual(typesOfColor("release"), ["release"])
    assert.deepEqual(typesOfColor("info"), ["test"]) // the "info" hue never labels a badge "info"
    assert.deepEqual(typesOfColor("refactor"), ["refactor"])
    assert.deepEqual(typesOfColor("polish"), ["polish"])
    // every remaining badge type carries its own hue too — none is locked out of the settings list
    for (const hue of ["beta", "wip", "plugin", "chore", "docs", "style", "ci", "build"] as const)
      assert.deepEqual(typesOfColor(hue), [hue])
  })

  it("round-trips through typeColor: every listed type actually wears that hue", () => {
    for (const hue of HUES) for (const type of typesOfColor(hue)) assert.equal(typeColor(type), hue)
  })

  it("neutralizes a deleted preset's types, and restores them once the set is cleared", () => {
    setNeutralizedColors(["warning", "success"])
    try {
      assert.equal(typeColor("bugfix"), "neutral")
      assert.equal(typeColor("feat"), "neutral")
      assert.equal(typeColor("feature"), "neutral") // the collapsed alias follows its preset
      assert.equal(typeColor("perf"), "perf") // its own preset now — deleting bugfix leaves it alone
    } finally {
      setNeutralizedColors([])
    }
    assert.equal(typeColor("bugfix"), "warning")
  })
})
