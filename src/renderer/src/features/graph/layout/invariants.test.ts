/* Test d'invariants sur fixture réelle (AUDIT.md §6/§10, item tests — "c'est lui qui verrouille
   B1"). `fixtures/repo-log.json` est l'historique réel de CE dépôt (147 commits, toutes refs),
   capturé une fois via `git log` avec le même format que `main/git/queries.ts` `logPage`, parsé
   par le vrai `parseLogPage` — pas une fixture inventée. Rejoue le layout complet et vérifie :
   `rowOf` est bijectif (verrouille B1 — deux SHA distincts ne peuvent plus jamais revendiquer la
   même ligne, contrairement à l'ancien `hkey` tronqué à 32 bits), chaque arête est résolue ou
   pending, et aucune lane n'est partagée par deux arêtes en même temps. */
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import { collapsePairs } from "./collapse.ts"
import { layoutChunk } from "./lanes.ts"
import { createState, type Edge } from "./state.ts"

const fixturePath = fileURLToPath(new URL("./fixtures/repo-log.json", import.meta.url))
const raw: Commit[] = JSON.parse(readFileSync(fixturePath, "utf8"))
const commits = collapsePairs(raw)

const S = createState()
layoutChunk(S, (r) => commits[r], commits.length)
const allEdges: Edge[] = [...S.long, ...S.edges.flatMap((es) => es ?? [])]

describe("invariants de layout — fixture réelle (147 commits, toutes refs)", () => {
  it("charge bien un historique non trivial (garde-fou de la fixture elle-même)", () => {
    assert.ok(commits.length > 50, "la fixture doit couvrir un historique substantiel")
    assert.equal(S.next, commits.length, "toutes les lignes de la fixture sont mises en page")
  })

  it("rowOf est bijectif : deux SHA distincts ne revendiquent jamais la même ligne (verrouille B1)", () => {
    const seen = new Set<number>()
    for (const [, row] of S.rowOf) {
      assert.equal(seen.has(row), false, `ligne ${row} revendiquée par plus d'un hash`)
      seen.add(row)
    }
  })

  it("chaque ligne round-trip vers elle-même via ids.ts (internId/hashOf/rowOf cohérents)", () => {
    for (let row = 0; row < S.next; row++) {
      const id = S.hashOf[row]
      assert.notEqual(id, undefined, `ligne ${row} sans id de hash`)
      assert.equal(S.rowOf.get(id), row, `rowOf(hashOf(${row})) doit revenir à ${row}`)
    }
  })

  it("chaque arête est résolue ou reste explicitement en attente — aucune ne se perd", () => {
    // par construction, une arête n'entre dans edges[]/long qu'une fois résolue (e.r2 posé,
    // cf. layoutChunk) : cette assertion documente l'invariant, pas une simple tautologie —
    // elle empêche une régression qui pousserait une arête non résolue dans ces tableaux.
    for (const e of allEdges) assert.notEqual(e.r2, undefined, "arête d'edges[]/long non résolue")
    // l'historique complet (git log --all, sans --shallow) ne laisse aucun parent hors de portée
    assert.equal(S.pending.size, 0, "aucune arête ne devrait rester pendante sur un historique complet")
  })

  it("aucune lane n'est occupée par deux arêtes indépendantes en même temps (pas de lane doublée)", () => {
    /* Deux arêtes peuvent légitimement partager une lane sur des lignes qui se chevauchent SI
       elles convergent vers le même nœud (fin commune) — un fork où plusieurs enfants tiennent
       leur première-parenté du même commit, ou le second parent d'un merge qui coupe par la lane
       d'une chaîne déjà en cours pour rejoindre son nœud cible (cf. `edgePath`, la courbe d'une
       arête adjacente ne « occupe » vraiment la lane qu'à son point d'arrivée, pas tout du long).
       Un chevauchement qui ne partage NI le début NI la fin serait, lui, une vraie double
       réservation de la même lane par deux chaînes indépendantes. */
    const byLane = new Map<number, [number, number][]>()
    for (const e of allEdges) {
      const list = byLane.get(e.travel) ?? []
      list.push([e.r1, e.r2!])
      byLane.set(e.travel, list)
    }
    for (const [lane, intervals] of byLane) {
      intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])
      for (let i = 1; i < intervals.length; i++) {
        const prev = intervals[i - 1]
        const cur = intervals[i]
        const overlaps = cur[0] < prev[1]
        const sharesEndpoint = cur[1] === prev[1] || cur[0] === prev[0]
        assert.ok(
          !overlaps || sharesEndpoint,
          `lane ${lane} : chevauchement sans nœud commun entre [${prev}] et [${cur}]`
        )
      }
    }
  })
})
