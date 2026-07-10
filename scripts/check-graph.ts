/* Auto-contrôle du collapse release/hotfix et des segments de branche de graph-layout.ts :
   `node scripts/check-graph.ts`. Les deux motifs (paire de merges de branche, merge de tag),
   les cas qui ne doivent PAS fusionner, et les frontières de segment. */
import assert from "node:assert/strict"
import {
  branchChain, branchSegment, collapsePairs, createState, layoutChunk,
} from "../src/renderer/src/lib/graph-layout.ts"
import type { Commit } from "../src/renderer/src/lib/git.ts"

/* fonction déclarée, pas fléchée : suivie d'un bloc nu, `=> ({…})` fait trébucher tsc */
function c(h: string, p: string[], s: string, r = ""): Commit {
  return { h, p, d: "2026-01-01", a: "Ada", e: "ada@x.io", r, s }
}

/* --- Motif A : deux merges de branche, jumeaux par le tip release (2e parent commun) --- */
{
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
}

/* --- Motif A, hotfix : le nom de branche du côté master tranche release vs hotfix --- */
{
  const dev = c("d1", ["dp", "ht"], "Merge branch 'hotfix/1.2.1' into develop")
  const mas = c("m1", ["mp", "ht"], "Merge branch 'hotfix/1.2.1' into main")
  const cap = collapsePairs([dev, mas])[0]
  assert.equal(cap.cap?.flow, "hotfix")
  assert.deepEqual(cap.cap?.targets, ["main", "develop"])
}

/* --- Motif B : « Merge tag » — le 2e parent du merge develop EST le merge master --- */
{
  const dev = c("d1", ["dp", "m1"], "Merge tag 'v1.2.0' into develop")
  const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'")
  const out = collapsePairs([dev, mas])

  assert.equal(out.length, 1)
  const cap = out[0]
  assert.deepEqual(cap.p, ["dp", "mp", "rt"])
  assert.equal(cap.cap?.version, "v1.2.0", "sans tag dans les refs, le nom du tag mergé sert de version")
  assert.equal(cap.cap?.flow, "release")
}

/* --- Ce qui ne fusionne PAS --- */

// un merge de feature vers develop n'est pas un motif de version
{
  const rows = [c("d1", ["dp", "ft"], "Merge branch 'feature/x' into develop"), c("m1", ["mp", "ft"], "Merge branch 'feature/x'")]
  assert.deepEqual(collapsePairs(rows), rows)
}

// merge master plus récent que le merge develop (au-dessus dans le log) : pas une paire
{
  const mas = c("m1", ["mp", "rt"], "Merge branch 'release/1.2.0'")
  const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
  assert.deepEqual(collapsePairs([mas, dev]), [mas, dev])
}

// merge develop orphelin (le côté master est sur une autre page) : rendu tel quel
{
  const dev = c("d1", ["dp", "rt"], "Merge branch 'release/1.2.0' into develop")
  assert.deepEqual(collapsePairs([dev]), [dev])
}

// deux releases imbriquées dans la même page : chacune trouve son jumeau, pas celui de l'autre
{
  const dev2 = c("d2", ["d1", "r2"], "Merge branch 'release/1.3.0' into develop")
  const mas2 = c("m2", ["m1", "r2"], "Merge branch 'release/1.3.0'")
  const dev1 = c("d1", ["dp", "r1"], "Merge branch 'release/1.2.0' into develop")
  const mas1 = c("m1", ["mp", "r1"], "Merge branch 'release/1.2.0'")
  const out = collapsePairs([dev2, mas2, dev1, mas1])
  assert.deepEqual(out.map((x) => x.h), ["d2", "d1"])
  assert.equal(out[0].cap?.absorbed, "m2")
  assert.equal(out[1].cap?.absorbed, "m1")
}

/* --- Frontières de segment : une ref de branche coupe même sans fork topologique --- */

// une branche posée sur le tip de develop (aucun commit develop depuis le fork) : le segment
// s'arrête à develop, il ne descend pas dans le tronc (cas allix4, feature/business-refactor)
// (hash factices en hex : l'état de layout les indexe par clé entière, cf. hkey)
{
  const data = [
    c("f2", ["f1"], "wip", "HEAD -> refs/heads/feature/x"),
    c("f1", ["de"], "refactor: étape 1"),
    c("de", ["c1"], "fix filters", "refs/heads/develop, refs/remotes/origin/develop"),
    c("c1", ["c2"], "chore: bump"),
    c("c2", [], "init"),
  ]
  const S = createState(1)
  layoutChunk(S, (r) => data[r], data.length)

  assert.deepEqual(branchSegment(S, 0), [0, 1], "le segment s'arrête au tip de develop")
  assert.deepEqual(branchSegment(S, 2), [2, 3, 4], "le segment de develop descend le tronc")
  assert.equal(branchSegment(S, 2)[0], 2, "on ne grimpe pas au-dessus du tip de develop")
  assert.equal(branchChain(S, 3)[0], 2, "le survol du tronc remonte à develop, pas à la feature")
}

// la distante en retard de la même branche ne coupe pas ; celle d'une autre branche, si
{
  const data = [
    c("f2", ["f1"], "wip", "HEAD -> refs/heads/feature/x"),
    c("f1", ["de"], "refactor: étape 1", "refs/remotes/origin/feature/x"),
    c("de", ["c1"], "fix filters", "refs/remotes/origin/develop"),
    c("c1", [], "init"),
  ]
  const S = createState(1)
  layoutChunk(S, (r) => data[r], data.length)

  assert.deepEqual(branchSegment(S, 0), [0, 1], "origin/feature/x en retard reste dans le segment")
}

/* --- Stash : nœud et arête pointillés, transparent pour les chaînes de branche --- */
{
  const data = [
    c("f1", ["de"], "wip", "HEAD -> refs/heads/feature/x"),
    { ...c("5a", ["de"], "WIP on develop: aaaa fix filters"), stash: { name: "stash@{0}", untracked: null } },
    c("de", ["c1"], "fix filters", "refs/heads/develop"),
    c("c1", [], "init"),
  ]
  const S = createState(1)
  layoutChunk(S, (r) => data[r], data.length)

  assert.equal(S.nodes[0][1].stash, true, "la ligne de stash porte son marqueur de nœud")
  assert.equal(S.fpEdge[1].dash, true, "l'arête du stash vers sa base est pointillée")
  assert.equal(S.fpEdge[0].dash, undefined, "les arêtes ordinaires restent pleines")
  assert.deepEqual(S.fpChildren.get(2), [0], "le stash n'est pas un enfant first-parent") // dv = ligne 2
  assert.deepEqual(branchSegment(S, 2), [2, 3], "le stash ne coupe pas le segment de develop")
}

console.log("check-graph: ok")
