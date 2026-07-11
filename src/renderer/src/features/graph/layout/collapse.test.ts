/* Migré depuis lib/graph-layout.test.ts (AUDIT.md §6/§10, item tests) : mêmes cas pour
   `collapsePairs`, y compris la paire à cheval sur deux pages de log (dernier test), qui verrouille
   la limitation documentée dans collapse.ts (« appariement page par page »). */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { collapsePairs, foldStashes } from "./collapse.ts"

function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

describe("collapsePairs", () => {
  it("fusionne deux merges de branche, jumeaux par le tip release (2e parent commun)", () => {
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    const mid = c("x1", ["y1"], "feat: entre les deux") // la paire n'est pas forcément adjacente
    const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'", "tag: refs/tags/v1.2.0")
    const out = collapsePairs([dev, mid, mas])

    assert.equal(out.length, 2, "la paire fusionne en une capsule")
    const cap = out[0]
    assert.equal(cap.h, "d1", "le merge develop survit")
    assert.deepEqual(cap.p, ["dp", "mp", "rt"], "parents des deux merges, tip release inclus")
    assert.equal(cap.cap?.absorbed, "m1", "le merge master reste résolu via absorbed")
    assert.equal(cap.cap?.flow, "release")
    assert.equal(cap.cap?.version, "v1.2.0", "le tag semver du côté master donne la version")
    assert.deepEqual(cap.cap?.targets, ["master", "develop"])
    assert.equal(out[1].h, "x1", "le commit intercalé reste en place")
  })

  it("tranche release vs hotfix via le nom de branche du côté master", () => {
    const dev = c("d1", ["dp", "ht"], "Merge branch 'hotfix/1.2.1' into develop")
    const mas = c("m1", ["mp", "ht"], "Merge branch 'hotfix/1.2.1' into main")
    const cap = collapsePairs([dev, mas])[0]
    assert.equal(cap.cap?.flow, "hotfix")
    assert.deepEqual(cap.cap?.targets, ["main", "develop"])
  })

  it("reconnaît le motif « Merge tag » (le 2e parent du merge develop EST le merge master)", () => {
    const dev = c("d1", ["dp", "m1"], "Merge tag 'v1.2.0' into develop")
    const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'")
    const out = collapsePairs([dev, mas])

    assert.equal(out.length, 1)
    const cap = out[0]
    assert.deepEqual(cap.p, ["dp", "mp", "rt"])
    assert.equal(cap.cap?.version, "v1.2.0", "sans tag dans les refs, le nom du tag mergé sert de version")
    assert.equal(cap.cap?.flow, "release")
  })

  it("ne fusionne pas un merge de feature vers develop (pas un motif de version)", () => {
    const rows = [c("d1", ["dp", "ft"], "Merge branch 'feature/x' into develop"), c("m1", ["mp", "ft"], "Merge branch 'feature/x'")]
    assert.deepEqual(collapsePairs(rows), rows)
  })

  it("ne fusionne pas si le merge master est plus récent que le merge develop", () => {
    const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'")
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    assert.deepEqual(collapsePairs([mas, dev]), [mas, dev])
  })

  it("rend un merge develop orphelin tel quel (le côté master est sur une autre page)", () => {
    /* verrouille la limitation documentée dans collapse.ts : l'appariement se fait
       page par page, une paire à cheval sur deux pages de log reste en 2 lignes. */
    const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
    assert.deepEqual(collapsePairs([dev]), [dev])
  })

  it("apparie deux releases imbriquées dans la même page, chacune avec son jumeau", () => {
    const dev2 = c("d2", ["d1", "r2"], "Merge branch 'release/1.3.0' into develop")
    const mas2 = c("m2", ["m1", "r2"], "Merge branch 'release/1.3.0'")
    const dev1 = c("d1", ["dp", "r1"], "Merge branch 'release/1.2.0' into develop")
    const mas1 = c("m1", ["mp", "r1"], "Merge branch 'release/1.2.0'")
    const out = collapsePairs([dev2, mas2, dev1, mas1])
    assert.deepEqual(out.map((x) => x.h), ["d2", "d1"])
    assert.equal(out[0].cap?.absorbed, "m2")
    assert.equal(out[1].cap?.absorbed, "m1")
  })
})

describe("foldStashes", () => {
  it("replie une entrée de stash en nœud simple et retire sa plomberie", () => {
    const page = [
      c("ee1", ["a1", "ee2", "ee3"], "On develop: calibrage"),
      c("ee2", ["a1"], "index on develop: a1"),
      c("ee3", [], "untracked files on develop: a1"),
      c("a1", ["a0"], "feat: base"),
    ]
    const stashOf = new Map([["ee1", "stash@{0}"]])
    const plumbing = new Set(["ee2", "ee3"])
    const out = foldStashes(page, stashOf, plumbing)

    assert.deepEqual(out.map((c) => c.h), ["ee1", "a1"], "la plomberie (index, non suivis) disparaît")
    assert.deepEqual(out[0].p, ["a1"], "seul le parent de base survit")
    assert.deepEqual(out[0].stash, { name: "stash@{0}", untracked: "ee3" })
  })

  it("rend la page inchangée quand aucun stash n'est connu", () => {
    const page = [c("a1", ["a0"], "feat: base")]
    assert.equal(foldStashes(page, new Map(), new Set()), page)
  })
})
