/* Tests for the pure parsers in git/parse.ts (AUDIT.md §4/§10, tests item). The name-status -z
   tests migrate from scripts/check-files.ts (same assertions, one `it()` per block); the rest is
   new — these functions weren't tested before their extraction. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  BRANCH,
  classifyGitFailure,
  computeNextTag,
  flowVersionSuffix,
  parseFlowPrefixes,
  parseForEachRef,
  parseNameStatus,
  parsePorcelain,
  parseStashList,
} from "./parse.ts"

const NUL = "\0"

describe("parseNameStatus (--name-status -z, fix B3)", () => {
  it("returns an empty array for empty output (commit with no file)", () => {
    assert.deepEqual(parseNameStatus(""), [])
    assert.deepEqual(parseNameStatus(NUL), []) // trailing NUL alone: no phantom line
  })

  it("parses simple entries: a status, a path", () => {
    assert.deepEqual(parseNameStatus(`A${NUL}src/a.ts${NUL}M${NUL}b.md${NUL}D${NUL}c${NUL}`), [
      { st: "A", path: "src/a.ts", old: null },
      { st: "M", path: "b.md", old: null },
      { st: "D", path: "c", old: null },
    ])
  })

  it("drops a rename's similarity score, the old path precedes the new one", () => {
    assert.deepEqual(parseNameStatus(`R100${NUL}old/name.ts${NUL}new/name.ts${NUL}`), [
      { st: "R", path: "new/name.ts", old: "old/name.ts" },
    ])
  })

  it("handles a copy with the same three-field layout as a rename", () => {
    assert.deepEqual(parseNameStatus(`C75${NUL}src/base.ts${NUL}src/copy.ts${NUL}`), [
      { st: "C", path: "src/copy.ts", old: "src/base.ts" },
    ])
  })

  it("outputs the raw paths that used to shatter the old line/tab parse", () => {
    assert.deepEqual(parseNameStatus(`M${NUL}café.txt${NUL}A${NUL}with\ttab.txt${NUL}A${NUL}with\nnewline.txt${NUL}`), [
      { st: "M", path: "café.txt", old: null },
      { st: "A", path: "with\ttab.txt", old: null },
      { st: "A", path: "with\nnewline.txt", old: null },
    ])
  })

  it("keeps the three fields aligned for a rename to an exotic name", () => {
    assert.deepEqual(parseNameStatus(`R087${NUL}a b.txt${NUL}accented dir/é\tè.txt${NUL}M${NUL}next.ts${NUL}`), [
      { st: "R", path: "accented dir/é\tè.txt", old: "a b.txt" },
      { st: "M", path: "next.ts", old: null },
    ])
  })

  it("returns the complete entries of a truncated output (process killed mid-flight), without throwing", () => {
    assert.deepEqual(parseNameStatus(`M${NUL}ok.ts${NUL}R100${NUL}orphan`), [{ st: "M", path: "ok.ts", old: null }])
  })
})

describe("parsePorcelain (status --porcelain=v1 -z)", () => {
  /* each entry is `XY<space>path` in a single NUL field — X = index, Y = tree */
  const entry = (xy: string, path: string) => `${xy} ${path}`

  it("classifies staged/unstaged/untracked/conflicts", () => {
    const out =
      [
        entry("A ", "staged.ts"),
        entry(" M", "unstaged.ts"),
        entry("??", "untracked.ts"),
        entry("UU", "conflict.ts"),
      ].join(NUL) + NUL
    const wt = parsePorcelain(out)
    assert.deepEqual(wt.staged, [{ st: "A", path: "staged.ts", old: null }])
    assert.deepEqual(wt.unstaged, [{ st: "M", path: "unstaged.ts" }])
    assert.deepEqual(wt.untracked, [{ st: "?", path: "untracked.ts" }])
    assert.deepEqual(wt.conflicts, [{ st: "UU", path: "conflict.ts" }])
  })

  it("handles a file that's both staged and unstaged (MM)", () => {
    const wt = parsePorcelain(entry("MM", "both.ts") + NUL)
    assert.deepEqual(wt.staged, [{ st: "M", path: "both.ts", old: null }])
    assert.deepEqual(wt.unstaged, [{ st: "M", path: "both.ts" }])
  })

  it("consumes a rename's extra NUL field (old path, after the new one)", () => {
    const wt = parsePorcelain(entry("R ", "new.ts") + NUL + "old.ts" + NUL)
    assert.deepEqual(wt.staged, [{ st: "R", path: "new.ts", old: "old.ts" }])
  })
})

describe("parseForEachRef", () => {
  const F = "\x1f"
  const line = (
    refname: string,
    head = "",
    track = "",
    symref = "",
    upstream = "",
    oid = "aaaa000011112222333344445555666677778888",
    peeled = ""
  ) => [refname, head, track, symref, upstream, oid, peeled].join(F)

  it("classifies refs by prefix and drops origin/HEAD in favor of `base`", () => {
    const out = [
      line("refs/heads/develop", "*"),
      line("refs/remotes/origin/develop"),
      line("refs/remotes/origin/HEAD", "", "", "refs/remotes/origin/develop"),
      line("refs/tags/v1.0.0"),
    ].join("\n")
    const { refs, base } = parseForEachRef(out)
    assert.equal(base, "refs/remotes/origin/develop")
    assert.deepEqual(
      refs.map((r) => [r.kind, r.name]),
      [
        ["head", "develop"],
        ["remote", "origin/develop"],
        ["tag", "v1.0.0"],
      ]
    )
    assert.equal(refs[0].head, true)
  })

  it("extracts ahead/behind from the tracking field", () => {
    const out = line("refs/heads/topic", "", "ahead 2, behind 1")
    const [ref] = parseForEachRef(out).refs
    assert.equal(ref.ahead, 2)
    assert.equal(ref.behind, 1)
  })

  it("flags gone when the tracking field is 'gone'", () => {
    const out = line("refs/heads/old", "", "gone")
    const [ref] = parseForEachRef(out).refs
    assert.equal(ref.gone, true)
  })

  it("peels an annotated tag to its commit (*objectname)", () => {
    const peeled = "9999888877776666555544443333222211110000"
    const out = line("refs/tags/v1.0.0", "", "", "", "", "aaaa000011112222333344445555666677778888", peeled)
    const [ref] = parseForEachRef(out).refs
    assert.equal(ref.tip, peeled)
  })
})

describe("parseStashList", () => {
  const E = "\x1e",
    F = "\x1f"

  it("parses a complete entry, full SHA kept (fix B1)", () => {
    const row =
      [
        "aaaa000011112222333344445555666677778888",
        "p1 p2 p3",
        "stash@{0}",
        "2026-07-08",
        "Ada",
        "ada@x.io",
        "WIP on x",
      ].join(F) + E
    const [s] = parseStashList(row)
    assert.equal(s.h, "aaaa000011112222333344445555666677778888")
    assert.deepEqual(s.p, ["p1", "p2", "p3"])
    assert.equal(s.name, "stash@{0}")
    assert.equal(s.s, "WIP on x")
  })

  it("returns an empty array for empty output", () => {
    assert.deepEqual(parseStashList(""), [])
  })

  it("joins the subject's overflow fields with a space (past the 7th separator)", () => {
    const row =
      [
        "aaaa000011112222333344445555666677778888",
        "p1",
        "stash@{1}",
        "2026-07-08",
        "Ada",
        "ada@x.io",
        "On x:",
        "a",
      ].join(F) + E
    const [s] = parseStashList(row)
    assert.equal(s.s, "On x: a")
  })
})

describe("BRANCH (fix B2: rejects branch suffixes starting with `-`)", () => {
  it("accepts ordinary branch names, accented letters included", () => {
    for (const name of ["master", "feature/ui-graph", "release/1.2.0", "hotfix/empty-matrix", "développeur/été"])
      assert.ok(BRANCH.test(name), name)
  })

  it("rejects a name starting with `-` (git-flow option injection, B2)", () => {
    assert.ok(!BRANCH.test("-D"))
    assert.ok(!BRANCH.test("-force"))
  })

  it("rejects patterns forbidden by git (.., @{, space, tilde, caret, etc.)", () => {
    for (const name of ["a..b", "a@{b}", "a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"])
      assert.ok(!BRANCH.test(name), name)
  })
})

describe("classifyGitFailure", () => {
  it("classe un kill par timeout", () => {
    assert.deepEqual(classifyGitFailure({ exitCode: null, stdout: "", stderr: "", killedBy: "timeout" }), {
      code: "TIMEOUT",
    })
  })

  it("classe un kill par annulation explicite", () => {
    assert.deepEqual(classifyGitFailure({ exitCode: null, stdout: "", stderr: "", killedBy: "abort" }), {
      code: "ABORTED",
    })
  })

  it("classe un kill par plafond de sortie", () => {
    assert.deepEqual(classifyGitFailure({ exitCode: null, stdout: "", stderr: "", killedBy: "limit" }), {
      code: "OUTPUT_LIMIT",
    })
  })

  it("detects a merge conflict on stdout (never stderr) and returns the touched files", () => {
    const stdout =
      "Auto-merging a.ts\nCONFLICT (content): Merge conflict in a.ts\nAutomatic merge failed; fix conflicts and then commit the result.\n"
    const r = classifyGitFailure({ exitCode: 1, stdout, stderr: "", killedBy: null })
    assert.equal(r.code, "MERGE_CONFLICT")
    assert.equal(r.detail, "a.ts")
  })

  it("detects a stash pop conflict (same CONFLICT lines)", () => {
    const stdout =
      "Auto-merging b.ts\nCONFLICT (content): Merge conflict in b.ts\nThe stash entry is kept in case you need it again.\n"
    const r = classifyGitFailure({ exitCode: 1, stdout, stderr: "", killedBy: null })
    assert.equal(r.code, "MERGE_CONFLICT")
    assert.equal(r.detail, "b.ts")
  })

  it("retombe sur GIT_FAILED avec la ligne fatal:/error: et le code de sortie", () => {
    const r = classifyGitFailure({ exitCode: 128, stdout: "", stderr: "fatal: not a git repository\n", killedBy: null })
    assert.equal(r.code, "GIT_FAILED")
    assert.equal(r.detail, "not a git repository (exit 128)")
  })

  it("keeps at most 2 fatal:/error: lines, otherwise the last line", () => {
    const r = classifyGitFailure({
      exitCode: 1,
      stdout: "",
      stderr: "hint: ignored\nsomething went wrong\n",
      killedBy: null,
    })
    assert.equal(r.code, "GIT_FAILED")
    assert.equal(r.detail, "something went wrong (exit 1)")
  })
})

describe("git-flow — parseFlowPrefixes / computeNextTag / flowVersionSuffix", () => {
  it("parses the prefixes from `git config --get-regexp`", () => {
    const out = "gitflow.prefix.feature feature/\ngitflow.prefix.release release/\ngitflow.prefix.versiontag v"
    assert.deepEqual(parseFlowPrefixes(out), { feature: "feature/", release: "release/" })
  })

  it("keeps a suffix starting with `-` empty (fix B2, same guard as finish)", () => {
    assert.equal(flowVersionSuffix("release/-D", "release/"), "")
    assert.equal(flowVersionSuffix("release/1.2.0", "release/"), "1.2.0")
  })

  it("takes the version carried by the branch name if it's semver", () => {
    assert.equal(computeNextTag("release", "1.2.0", "v1.1.0"), "1.2.0")
  })

  it("bump le patch pour un hotfix, le minor pour une release, sans version explicite", () => {
    assert.equal(computeNextTag("hotfix", "", "v1.2.3"), "v1.2.4")
    assert.equal(computeNextTag("release", "", "1.2.3"), "1.3.0")
  })

  it("rend null sans version explicite ni dernier tag", () => {
    assert.equal(computeNextTag("release", "", null), null)
  })
})
