/* Tests for the pure parsers in git/parse.ts (AUDIT.md §4/§10, tests item). The name-status -z
   tests migrate from scripts/check-files.ts (same assertions, one `it()` per block); the rest is
   new — these functions weren't tested before their extraction. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  BRANCH,
  classifyGitFailure,
  computeNextTag,
  flowInitConfigArgs,
  flowVersionSuffix,
  hashListCount,
  hashListSlice,
  parseCountObjects,
  parseFlowPrefixes,
  parseForEachRef,
  parseLogPage,
  parseMergeTree,
  parseNameStatus,
  parsePorcelain,
  parseProgressPercent,
  parseStashList,
  parseWorktreeList,
} from "./parse.ts"

const NUL = "\0"

describe("parseWorktreeList (worktree list --porcelain -z)", () => {
  const entry = (lines: string[]) => lines.map((l) => l + NUL).join("") + NUL

  it("returns an empty array for empty output", () => {
    assert.deepEqual(parseWorktreeList(""), [])
  })

  it("parses main worktree then a linked one on a branch", () => {
    const out =
      entry(["worktree C:/repo", "HEAD " + "a".repeat(40), "branch refs/heads/master"]) +
      entry(["worktree C:/repo-wt/feat", "HEAD " + "b".repeat(40), "branch refs/heads/feature/x"])
    assert.deepEqual(parseWorktreeList(out), [
      { path: "C:/repo", head: "a".repeat(40), branch: "master", locked: false, prunable: false },
      { path: "C:/repo-wt/feat", head: "b".repeat(40), branch: "feature/x", locked: false, prunable: false },
    ])
  })

  it("reports a detached HEAD as branch null", () => {
    const out = entry(["worktree /w", "HEAD " + "c".repeat(40), "detached"])
    assert.deepEqual(parseWorktreeList(out), [
      { path: "/w", head: "c".repeat(40), branch: null, locked: false, prunable: false },
    ])
  })

  it("drops a bare entry, keeps the linked ones", () => {
    const out = entry(["worktree /srv/repo.git", "bare"]) + entry(["worktree /w", "HEAD " + "d".repeat(40), "detached"])
    assert.deepEqual(parseWorktreeList(out), [
      { path: "/w", head: "d".repeat(40), branch: null, locked: false, prunable: false },
    ])
  })

  it("flags locked and prunable, with or without a reason", () => {
    const out =
      entry(["worktree /a", "HEAD " + "e".repeat(40), "detached", "locked"]) +
      entry([
        "worktree /b",
        "HEAD " + "f".repeat(40),
        "detached",
        "locked reason with spaces",
        "prunable gitdir file points to non-existent location",
      ])
    assert.deepEqual(parseWorktreeList(out), [
      { path: "/a", head: "e".repeat(40), branch: null, locked: true, prunable: false },
      { path: "/b", head: "f".repeat(40), branch: null, locked: true, prunable: true },
    ])
  })

  it("keeps a path containing spaces or a newline intact", () => {
    const out = entry(["worktree /w/dir with spaces\nand newline", "HEAD " + "0".repeat(40), "branch refs/heads/x"])
    assert.deepEqual(parseWorktreeList(out), [
      { path: "/w/dir with spaces\nand newline", head: "0".repeat(40), branch: "x", locked: false, prunable: false },
    ])
  })

  it("keeps complete entries from a truncated output", () => {
    const out = entry(["worktree /ok", "HEAD " + "1".repeat(40), "detached"]) + "worktree /cut" + NUL + "HEAD 2222"
    assert.deepEqual(parseWorktreeList(out), [
      { path: "/ok", head: "1".repeat(40), branch: null, locked: false, prunable: false },
      { path: "/cut", head: "2222", branch: null, locked: false, prunable: false },
    ])
  })
})
/* the two control bytes git emits between commits (RS) and fields (US) — cf. the pretty format */
const RS = "\x1e"
const US = "\x1f"

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

describe("parseLogPage (RS/US-delimited log page)", () => {
  /** one commit row: hash, parents, date, author, email, refs, subject… */
  const row = (fields: string[]) => fields.join(US)

  it("returns an empty array for empty output", () => {
    assert.deepEqual(parseLogPage(""), [])
  })

  it("parses a commit's seven fields into the Commit shape", () => {
    const out = row(["abc123", "p1 p2", "2026-01-01", "Ada", "ada@x.io", "HEAD -> main", "init"])
    assert.deepEqual(parseLogPage(out), [
      { h: "abc123", p: ["p1", "p2"], d: "2026-01-01", a: "Ada", e: "ada@x.io", r: "HEAD -> main", s: "init" },
    ])
  })

  it("splits multiple commits on the record separator and trims the hash", () => {
    const out = [
      row([" h1 ", "", "d1", "A", "a@x", "", "first"]),
      row(["h2", "h1", "d2", "B", "b@x", "", "second"]),
    ].join(RS)
    const commits = parseLogPage(out)
    assert.equal(commits.length, 2)
    assert.equal(commits[0].h, "h1", "hash trimmed")
    assert.deepEqual(commits[0].p, [], "no parents (root commit)")
    assert.deepEqual(commits[1].p, ["h1"])
  })

  it("reattaches a subject that itself contains a field separator, joined by a space", () => {
    // git doesn't filter control bytes out of %s: the extra fields fold back into the subject
    // (slice(6).join(" ")), the stray separator surfacing as a space rather than shattering the row
    const out = row(["h", "", "d", "A", "a@x", "", "sub", "ject"])
    assert.equal(parseLogPage(out)[0].s, "sub ject")
  })

  it("discards a row with too few fields (a subject-forged short line)", () => {
    const out = [row(["h", "", "d", "A", "a@x", "", "ok"]), "not enough fields"].join(RS)
    assert.deepEqual(
      parseLogPage(out).map((c) => c.h),
      ["h"]
    )
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

describe("hashListCount / hashListSlice (materialized log pagination)", () => {
  /* rev-list output: fixed-width lines, one full hash + \n each */
  const sha1 = (c: string) => c.repeat(40)
  const list = ["a", "b", "c", "d", "e"].map((c) => sha1(c) + "\n").join("")

  it("counts zero hashes for an empty output (empty repo)", () => {
    assert.equal(hashListCount(""), 0)
  })

  it("counts newline-terminated fixed-width lines", () => {
    assert.equal(hashListCount(list), 5)
  })

  it("counts sha256-width lines just as well (one object format per repo)", () => {
    const wide = ["a", "b"].map((c) => c.repeat(64) + "\n").join("")
    assert.equal(hashListCount(wide), 2)
  })

  it("still counts a lone hash without a trailing newline", () => {
    assert.equal(hashListCount(sha1("f")), 1)
  })

  it("slices the first page as whole newline-terminated hashes", () => {
    assert.equal(hashListSlice(list, 0, 2), sha1("a") + "\n" + sha1("b") + "\n")
  })

  it("slices a middle page at the right offset", () => {
    assert.equal(hashListSlice(list, 2, 2), sha1("c") + "\n" + sha1("d") + "\n")
  })

  it("clamps a page overlapping the end to the remaining hashes", () => {
    assert.equal(hashListSlice(list, 3, 10), sha1("d") + "\n" + sha1("e") + "\n")
  })

  it("returns empty past the end and for an empty list — the caller must not spawn git log", () => {
    assert.equal(hashListSlice(list, 5, 100), "")
    assert.equal(hashListSlice("", 0, 100), "")
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

describe("flowInitConfigArgs (init-config building)", () => {
  it("maps the form to gitflow.* key/value pairs in a stable order", () => {
    assert.deepEqual(
      flowInitConfigArgs({
        master: "main",
        develop: "develop",
        feature: "feature/",
        bugfix: "bugfix/",
        release: "release/",
        hotfix: "hotfix/",
        support: "support/",
        versiontag: "v",
      }),
      [
        ["gitflow.branch.master", "main"],
        ["gitflow.branch.develop", "develop"],
        ["gitflow.prefix.feature", "feature/"],
        ["gitflow.prefix.bugfix", "bugfix/"],
        ["gitflow.prefix.release", "release/"],
        ["gitflow.prefix.hotfix", "hotfix/"],
        ["gitflow.prefix.support", "support/"],
        ["gitflow.prefix.versiontag", "v"],
      ]
    )
  })

  it("passes an empty version-tag prefix straight through (no prefix is a valid choice)", () => {
    const pairs = flowInitConfigArgs({
      master: "master",
      develop: "develop",
      feature: "feature/",
      bugfix: "bugfix/",
      release: "release/",
      hotfix: "hotfix/",
      support: "support/",
      versiontag: "",
    })
    assert.deepEqual(pairs.at(-1), ["gitflow.prefix.versiontag", ""])
  })
})

describe("parseProgressPercent (maintenance progress)", () => {
  it("extracts the percentage from a git progress line", () => {
    assert.equal(parseProgressPercent("Counting objects:  45% (90/200)"), 45)
    assert.equal(parseProgressPercent("Checking objects: 100% (200/200), done."), 100)
  })

  it("takes the last percentage when a chunk carries several phases", () => {
    assert.equal(parseProgressPercent("Counting objects: 100%\rWriting objects:  30% (6/20)"), 30)
  })

  it("returns null when there is no percentage", () => {
    assert.equal(parseProgressPercent("remote: Enumerating objects"), null)
    assert.equal(parseProgressPercent(""), null)
  })

  it("rejects an out-of-range number that happens to be followed by %", () => {
    assert.equal(parseProgressPercent("173% nonsense"), null)
  })
})

describe("parseCountObjects (git count-objects -vH)", () => {
  const OUT = [
    "count: 12",
    "size: 48.00 KiB",
    "in-pack: 340",
    "packs: 1",
    "size-pack: 1.20 MiB",
    "prune-packable: 0",
    "garbage: 2",
    "size-garbage: 16.00 KiB",
  ].join("\n")

  it("parses counts as numbers and keeps human-readable sizes as strings", () => {
    assert.deepEqual(parseCountObjects(OUT), {
      count: 12,
      size: "48.00 KiB",
      inPack: 340,
      packs: 1,
      sizePack: "1.20 MiB",
      prunePackable: 0,
      garbage: 2,
      sizeGarbage: "16.00 KiB",
    })
  })

  it("falls back to zeros/'0' for missing keys, ignoring unrelated lines", () => {
    assert.deepEqual(parseCountObjects("count: 3\nsomething else\n"), {
      count: 3,
      size: "0",
      inPack: 0,
      packs: 0,
      sizePack: "0",
      prunePackable: 0,
      garbage: 0,
      sizeGarbage: "0",
    })
  })
})

describe("parseMergeTree (merge-tree --write-tree --no-messages --name-only)", () => {
  it("reads a clean merge: the tree OID alone", () => {
    assert.deepEqual(parseMergeTree("3fa53f04ad626f9b1cb43a2b18f4ab8e0a7c4e2c\n"), {
      tree: "3fa53f04ad626f9b1cb43a2b18f4ab8e0a7c4e2c",
      files: [],
    })
  })

  it("reads a conflicted merge: OID then one path per line", () => {
    const out = "3fa53f04ad626f9b1cb43a2b18f4ab8e0a7c4e2c\nsrc/api/search.ts\nsrc/store/index.ts\n"
    assert.deepEqual(parseMergeTree(out), {
      tree: "3fa53f04ad626f9b1cb43a2b18f4ab8e0a7c4e2c",
      files: ["src/api/search.ts", "src/store/index.ts"],
    })
  })

  it("deduplicates paths and survives an empty output", () => {
    assert.deepEqual(parseMergeTree("oid\na.ts\na.ts\n"), { tree: "oid", files: ["a.ts"] })
    assert.deepEqual(parseMergeTree(""), { tree: "", files: [] })
  })
})
