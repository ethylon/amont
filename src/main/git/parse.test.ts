/* Tests des parseurs purs de git/parse.ts (AUDIT.md §4/§10, item tests). Le name-status -z
   migre depuis scripts/check-files.ts (mêmes assertions, un `it()` par bloc) ; le reste est
   nouveau — ces fonctions n'étaient pas testées avant leur extraction. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  BRANCH, classifyGitFailure, computeNextTag, flowVersionSuffix, parseFlowPrefixes,
  parseForEachRef, parseNameStatus, parsePorcelain, parseStashList,
} from "./parse.ts"

const NUL = "\0"

describe("parseNameStatus (--name-status -z, fix B3)", () => {
  it("rend un tableau vide sur une sortie vide (commit sans fichier)", () => {
    assert.deepEqual(parseNameStatus(""), [])
    assert.deepEqual(parseNameStatus(NUL), []) // NUL final seul : pas de ligne fantôme
  })

  it("parse les entrées simples : un statut, un chemin", () => {
    assert.deepEqual(parseNameStatus(`A${NUL}src/a.ts${NUL}M${NUL}b.md${NUL}D${NUL}c${NUL}`), [
      { st: "A", path: "src/a.ts", old: null },
      { st: "M", path: "b.md", old: null },
      { st: "D", path: "c", old: null },
    ])
  })

  it("fait tomber le score de similarité d'un rename, l'ancien chemin précède le nouveau", () => {
    assert.deepEqual(parseNameStatus(`R100${NUL}old/name.ts${NUL}new/name.ts${NUL}`), [
      { st: "R", path: "new/name.ts", old: "old/name.ts" },
    ])
  })

  it("traite une copy avec le même layout à trois champs qu'un rename", () => {
    assert.deepEqual(parseNameStatus(`C75${NUL}src/base.ts${NUL}src/copie.ts${NUL}`), [
      { st: "C", path: "src/copie.ts", old: "src/base.ts" },
    ])
  })

  it("sort les chemins bruts qui pulvérisaient l'ancien parse ligne/tab", () => {
    assert.deepEqual(parseNameStatus(`M${NUL}café.txt${NUL}A${NUL}avec\ttab.txt${NUL}A${NUL}avec\nretour.txt${NUL}`), [
      { st: "M", path: "café.txt", old: null },
      { st: "A", path: "avec\ttab.txt", old: null },
      { st: "A", path: "avec\nretour.txt", old: null },
    ])
  })

  it("garde les trois champs alignés pour un rename vers un nom exotique", () => {
    assert.deepEqual(parseNameStatus(`R087${NUL}a b.txt${NUL}dossier accentué/é\tè.txt${NUL}M${NUL}suite.ts${NUL}`), [
      { st: "R", path: "dossier accentué/é\tè.txt", old: "a b.txt" },
      { st: "M", path: "suite.ts", old: null },
    ])
  })

  it("rend les entrées complètes d'une sortie tronquée (process tué en vol), sans jeter", () => {
    assert.deepEqual(parseNameStatus(`M${NUL}ok.ts${NUL}R100${NUL}orphelin`), [
      { st: "M", path: "ok.ts", old: null },
    ])
  })
})

describe("parsePorcelain (status --porcelain=v1 -z)", () => {
  /* chaque entrée est `XY<espace>chemin` en un seul champ NUL — X = index, Y = arbre */
  const entry = (xy: string, path: string) => `${xy} ${path}`

  it("classe staged/unstaged/untracked/conflicts", () => {
    const out = [
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

  it("gère un fichier à la fois staged et unstaged (MM)", () => {
    const wt = parsePorcelain(entry("MM", "both.ts") + NUL)
    assert.deepEqual(wt.staged, [{ st: "M", path: "both.ts", old: null }])
    assert.deepEqual(wt.unstaged, [{ st: "M", path: "both.ts" }])
  })

  it("consomme le champ NUL supplémentaire d'un rename (ancien chemin, après le nouveau)", () => {
    const wt = parsePorcelain(entry("R ", "new.ts") + NUL + "old.ts" + NUL)
    assert.deepEqual(wt.staged, [{ st: "R", path: "new.ts", old: "old.ts" }])
  })
})

describe("parseForEachRef", () => {
  const F = "\x1f"
  const line = (refname: string, head = "", track = "", symref = "", upstream = "", oid = "aaaa000011112222333344445555666677778888", peeled = "") =>
    [refname, head, track, symref, upstream, oid, peeled].join(F)

  it("classe les refs par préfixe et retire origin/HEAD au profit de `base`", () => {
    const out = [
      line("refs/heads/develop", "*"),
      line("refs/remotes/origin/develop"),
      line("refs/remotes/origin/HEAD", "", "", "refs/remotes/origin/develop"),
      line("refs/tags/v1.0.0"),
    ].join("\n")
    const { refs, base } = parseForEachRef(out)
    assert.equal(base, "refs/remotes/origin/develop")
    assert.deepEqual(refs.map((r) => [r.kind, r.name]), [
      ["head", "develop"],
      ["remote", "origin/develop"],
      ["tag", "v1.0.0"],
    ])
    assert.equal(refs[0].head, true)
  })

  it("extrait ahead/behind du champ de tracking", () => {
    const out = line("refs/heads/topic", "", "ahead 2, behind 1")
    const [ref] = parseForEachRef(out).refs
    assert.equal(ref.ahead, 2)
    assert.equal(ref.behind, 1)
  })

  it("marque gone quand le tracking vaut 'gone'", () => {
    const out = line("refs/heads/old", "", "gone")
    const [ref] = parseForEachRef(out).refs
    assert.equal(ref.gone, true)
  })

  it("pèle un tag annoté vers son commit (*objectname)", () => {
    const peeled = "9999888877776666555544443333222211110000"
    const out = line("refs/tags/v1.0.0", "", "", "", "", "aaaa000011112222333344445555666677778888", peeled)
    const [ref] = parseForEachRef(out).refs
    assert.equal(ref.tip, peeled)
  })
})

describe("parseStashList", () => {
  const E = "\x1e", F = "\x1f"

  it("parse une entrée complète, SHA complet conservé (fix B1)", () => {
    const row = ["aaaa000011112222333344445555666677778888", "p1 p2 p3", "stash@{0}", "2026-07-08", "Ada", "ada@x.io", "WIP on x"].join(F) + E
    const [s] = parseStashList(row)
    assert.equal(s.h, "aaaa000011112222333344445555666677778888")
    assert.deepEqual(s.p, ["p1", "p2", "p3"])
    assert.equal(s.name, "stash@{0}")
    assert.equal(s.s, "WIP on x")
  })

  it("rend un tableau vide sur une sortie vide", () => {
    assert.deepEqual(parseStashList(""), [])
  })

  it("rejoint sur espace les champs excédentaires du sujet (au-delà du 7e séparateur)", () => {
    const row = ["aaaa000011112222333344445555666677778888", "p1", "stash@{1}", "2026-07-08", "Ada", "ada@x.io", "On x:", "a"].join(F) + E
    const [s] = parseStashList(row)
    assert.equal(s.s, "On x: a")
  })
})

describe("BRANCH (fix B2 : rejette les suffixes de branche en `-`)", () => {
  it("accepte les noms de branche usuels", () => {
    for (const name of ["master", "feature/ui-graph", "release/1.2.0", "hotfix/matrice-vide", "développeur/été"])
      assert.ok(BRANCH.test(name), name)
  })

  it("rejette un nom commençant par `-` (injection d'option git-flow, B2)", () => {
    assert.ok(!BRANCH.test("-D"))
    assert.ok(!BRANCH.test("-force"))
  })

  it("rejette les motifs interdits par git (.., @{, espace, tilde, caret, etc.)", () => {
    for (const name of ["a..b", "a@{b}", "a b", "a~b", "a^b", "a:b", "a?b", "a*b", "a[b", "a\\b"])
      assert.ok(!BRANCH.test(name), name)
  })
})

describe("classifyGitFailure", () => {
  it("classe un kill par timeout", () => {
    assert.deepEqual(classifyGitFailure({ exitCode: null, stdout: "", stderr: "", killedBy: "timeout" }), { code: "TIMEOUT" })
  })

  it("classe un kill par annulation explicite", () => {
    assert.deepEqual(classifyGitFailure({ exitCode: null, stdout: "", stderr: "", killedBy: "abort" }), { code: "ABORTED" })
  })

  it("classe un kill par plafond de sortie", () => {
    assert.deepEqual(classifyGitFailure({ exitCode: null, stdout: "", stderr: "", killedBy: "limit" }), { code: "OUTPUT_LIMIT" })
  })

  it("détecte un conflit de merge sur stdout (jamais stderr) et rend les fichiers touchés", () => {
    const stdout = "Auto-merging a.ts\nCONFLICT (content): Merge conflict in a.ts\nAutomatic merge failed; fix conflicts and then commit the result.\n"
    const r = classifyGitFailure({ exitCode: 1, stdout, stderr: "", killedBy: null })
    assert.equal(r.code, "MERGE_CONFLICT")
    assert.equal(r.detail, "a.ts")
  })

  it("détecte un conflit de stash pop (mêmes lignes CONFLICT)", () => {
    const stdout = "Auto-merging b.ts\nCONFLICT (content): Merge conflict in b.ts\nThe stash entry is kept in case you need it again.\n"
    const r = classifyGitFailure({ exitCode: 1, stdout, stderr: "", killedBy: null })
    assert.equal(r.code, "MERGE_CONFLICT")
    assert.equal(r.detail, "b.ts")
  })

  it("retombe sur GIT_FAILED avec la ligne fatal:/error: et le code de sortie", () => {
    const r = classifyGitFailure({ exitCode: 128, stdout: "", stderr: "fatal: not a git repository\n", killedBy: null })
    assert.equal(r.code, "GIT_FAILED")
    assert.equal(r.detail, "not a git repository (exit 128)")
  })

  it("garde au plus 2 lignes fatal:/error:, sinon la dernière ligne", () => {
    const r = classifyGitFailure({ exitCode: 1, stdout: "", stderr: "hint: ignoré\nsomething went wrong\n", killedBy: null })
    assert.equal(r.code, "GIT_FAILED")
    assert.equal(r.detail, "something went wrong (exit 1)")
  })
})

describe("git-flow — parseFlowPrefixes / computeNextTag / flowVersionSuffix", () => {
  it("parse les préfixes depuis `git config --get-regexp`", () => {
    const out = "gitflow.prefix.feature feature/\ngitflow.prefix.release release/\ngitflow.prefix.versiontag v"
    assert.deepEqual(parseFlowPrefixes(out), { feature: "feature/", release: "release/" })
  })

  it("garde un suffixe qui commence par `-` vide (fix B2, même garde que finish)", () => {
    assert.equal(flowVersionSuffix("release/-D", "release/"), "")
    assert.equal(flowVersionSuffix("release/1.2.0", "release/"), "1.2.0")
  })

  it("prend la version portée par le nom de branche si elle est semver", () => {
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
