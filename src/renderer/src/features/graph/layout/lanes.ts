/* Allocateur de lanes et topologie d'arêtes (AUDIT.md §6) : le cœur du layout streaming
   append-only. Prend une fenêtre de commits déjà repliée (collapse.ts) et progresse d'exactement
   `CHUNK` lignes par appel, en construisant lanes/arêtes/métadonnées de chaîne au fil de l'eau —
   jamais de second passage sur une ligne déjà posée. Pur : aucune dépendance DOM/pixel/CSS,
   exécutable sous Node (cf. lanes.test.ts). */

import type { Commit } from "../../../../../shared/types.ts"
import { mergeSource, parseMerge } from "../../../lib/commit-message.ts"
import { CHUNK } from "../constants.ts"
import { internId } from "../ids.ts"
import { chunkOf, type Edge, type LayoutState } from "./state.ts"

function alloc(S: LayoutState) {
  let i = S.lanes.indexOf(null)
  if (i < 0) {
    i = S.lanes.length
    S.lanes.push(null)
  }
  return i
}

/** Met en page jusqu'à `CHUNK` lignes de plus (ou jusqu'à `total`, si plus proche). `at(row)`
    résout le commit d'une ligne — le contrôleur le sert depuis le cache de pages, chargé au fil
    de la pagination ; `layoutChunk` ne connaît que des indices de ligne. */
export function layoutChunk(S: LayoutState, at: (row: number) => Commit, total: number) {
  const t0 = performance.now()
  const end = Math.min(S.next + CHUNK, total)
  for (let row = S.next; row < end; row++) {
    const c = at(row)
    /* Une capsule répond pour deux hashes : le sien (côté develop) et le merge master absorbé.
       Fermer les deux lanes ici fait converger la lane master sur le nœud = le pont du métro. */
    const heads = c.cap ? [c.h, c.cap.absorbed] : [c.h]
    const waiting: number[] = []
    S.lanes.forEach((h, i) => {
      if (h !== null && heads.includes(h)) waiting.push(i)
    })
    let lane = waiting.find((i) => S.meta[i] === 0) // continuité first-parent d'abord
    if (lane === undefined) lane = waiting.length ? Math.min(...waiting) : alloc(S)
    waiting.forEach((i) => {
      S.lanes[i] = null
      S.meta[i] = -1
    })

    for (const hh of heads) {
      /* Les chaînes de branche se consultent par le hash survivant : les enfants et merges
         accrochés au hash absorbé d'une capsule restent hors des index de chaîne, comme quand
         ils étaient clés par hash. Seule la géométrie (arêtes, fpRow) traverse la capsule. */
      const own = hh === c.h
      ;(S.pending.get(hh) || []).forEach((e) => {
        e.r2 = row
        e.l2 = lane
        const c1 = Math.floor(e.r1 / CHUNK)
        ;(c1 === Math.floor(row / CHUNK) ? chunkOf(S.edges, c1) : S.long).push(e)
        if (e.k === 0) {
          S.fpRow[e.r1] = row
          /* un stash n'est pas un enfant de branche : l'inscrire ici ferait passer son commit
             de base pour un fork et couperait les segments (cf. chains.ts branchSegment) */
          if (own && !e.dash) {
            if (!S.fpChildren.has(row)) S.fpChildren.set(row, [])
            S.fpChildren.get(row)!.push(e.r1)
          }
        } else if (own) S.mergedBy.set(row, e.r1)
      })
      S.pending.delete(hh)
      S.rowOf.set(internId(S.ids, hh), row)
    }
    S.hashOf[row] = internId(S.ids, c.h)
    if (c.r) S.refsOf.set(row, c.r)
    if (c.p.length > 1) {
      const mg = parseMerge(c.s)
      if (mg) S.mergeOf.set(row, mg)
      else {
        const src = mergeSource(c.s) // PR GitHub : une source sans forme « Merge branch »
        if (src) S.mergeOf.set(row, { from: src, to: null, noise: false })
      }
    }
    S.laneOf[row] = lane
    chunkOf(S.nodes, Math.floor(row / CHUNK)).push({
      row, lane, merge: c.p.length > 1, cap: c.cap?.flow, stash: !!c.stash,
    })

    c.p.forEach((p, k) => {
      let travel: number
      if (k === 0) {
        // le trait first-parent reste dans son couloir jusqu'au fork : les arêtes
        // convergent sur le nœud parent au lieu de sauter dans le couloir d'à côté
        travel = lane
        S.lanes[lane] = p
        S.meta[lane] = 0
      } else {
        const e = S.lanes.indexOf(p)
        travel = e >= 0 ? e : alloc(S)
        S.lanes[travel] = p
        if (e < 0 && S.meta[travel] !== 0) S.meta[travel] = k
      }
      if (!S.pending.has(p)) S.pending.set(p, [])
      const rec: Edge = { r1: row, l1: lane, travel, k }
      if (c.stash) rec.dash = true
      S.pending.get(p)!.push(rec)
      if (k === 0) S.fpEdge[row] = rec
    })
  }
  S.next = end
  S.ms += performance.now() - t0
}
