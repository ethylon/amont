/* Lane allocator and edge topology (AUDIT.md §6): the core of the append-only streaming
   layout. Takes a window of already-folded commits (collapse.ts) and advances exactly
   `CHUNK` rows per call, building lanes/edges/chain metadata on the fly —
   never a second pass over an already-laid-out row. Pure: no DOM/pixel/CSS dependency,
   runnable under Node (cf. lanes.test.ts). */

import type { Commit } from "../../../../../shared/types.ts"
import { parseMerge, parseRefs } from "../../../lib/commit-parse.ts"
import { CHUNK } from "../constants.ts"
import { internId } from "../ids.ts"
import { chunkOf, type Edge, type LayoutState } from "./state.ts"

function alloc(S: LayoutState) {
  let i = S.lanes.indexOf(null, S.reserved)
  if (i < 0) {
    i = S.lanes.length
    S.lanes.push(null)
  }
  return i
}

const MASTER = /^(master|main)$/

/** Réserve les lanes de tête pour le tronc : master/main en 0, develop ensuite. À appeler
    sur un état vierge, avant le premier `layoutChunk` — `names` sont les refs du repo en
    forme courte (remote déjà raccourci). Sans tronc détecté, layout inchangé. */
export function reserveTrunks(S: LayoutState, names: string[]) {
  const claim = (matched: string[]) => {
    if (!matched.length) return
    const lane = S.reserved++
    for (const n of matched) S.trunkLanes.set(n, lane)
    S.lanes.push(null)
    S.meta.push(-1)
  }
  const uniq = [...new Set(names)]
  claim(uniq.filter((n) => MASTER.test(n)))
  claim(uniq.filter((n) => n === "develop"))
}

/** Lane réservée que la row réclame, si elle est décorée d'une ref de tronc. */
function trunkLaneOf(S: LayoutState, refs: string): number | undefined {
  if (!S.trunkLanes.size || !refs) return undefined
  for (const ref of parseRefs(refs)) {
    if (ref.kind === "tag") continue
    const name = ref.kind === "remote" ? ref.name.slice(ref.name.indexOf("/") + 1) : ref.name
    const lane = S.trunkLanes.get(name)
    if (lane !== undefined) return lane
  }
  return undefined
}

/** Lays out up to `CHUNK` more rows (or up to `total`, if closer). `at(row)`
    resolves a row's commit — the controller serves it from the page cache, loaded as
    pagination progresses; `layoutChunk` only knows row indices. */
export function layoutChunk(S: LayoutState, at: (row: number) => Commit, total: number) {
  const t0 = performance.now()
  const end = Math.min(S.next + CHUNK, total)
  /* tracked over the whole chunk, bumped once at the end: the dangling-edge overlay only
     needs to know "did S.pending move since my last rebuild", not how many times */
  let pendingMoved = false
  for (let row = S.next; row < end; row++) {
    const c = at(row)
    /* A capsule answers for two hashes: its own (develop side) and the absorbed master merge.
       Closing both lanes here makes the master lane converge on the node = the metro's bridge. */
    const heads = c.cap ? [c.h, c.cap.absorbed] : [c.h]
    const waiting: number[] = []
    S.lanes.forEach((h, i) => {
      if (h !== null && heads.includes(h)) waiting.push(i)
    })
    /* Le tronc décoré réclame sa lane réservée (libre ou déjà en attente sur elle) : master
       et develop gardent leur colonne quelle que soit l'activité au-dessus de leur tip. */
    const tl = trunkLaneOf(S, c.r)
    let lane = tl !== undefined && (S.lanes[tl] === null || waiting.includes(tl)) ? tl : undefined
    /* Seuls des edges du tronc entrent en lane réservée (claim décoré, réouverture capsule) :
       si l'une attend cette row, la row est le tronc — avant même la continuité premier-parent,
       sinon un hotfix forké du tronc lui volerait sa colonne à leur ancêtre commun. */
    if (lane === undefined) lane = waiting.find((i) => i < S.reserved)
    if (lane === undefined) lane = waiting.find((i) => S.meta[i] === 0) // first-parent continuity takes priority
    if (lane === undefined) lane = waiting.length ? Math.min(...waiting) : alloc(S)
    waiting.forEach((i) => {
      S.lanes[i] = null
      S.meta[i] = -1
    })

    for (const hh of heads) {
      /* Branch chains are looked up by the surviving hash: children and merges
         hanging off a capsule's absorbed hash stay outside the chain indices, just as when
         they were keyed by hash. Only the geometry (edges, fpRow) crosses the capsule. */
      const own = hh === c.h
      ;(S.pending.get(hh) || []).forEach((e) => {
        e.r2 = row
        e.l2 = lane
        const c1 = Math.floor(e.r1 / CHUNK)
        ;(c1 === Math.floor(row / CHUNK) ? chunkOf(S.edges, c1) : S.long).push(e)
        if (e.k === 0) {
          S.fpRow[e.r1] = row
          /* a stash isn't a branch child: registering it here would make its base commit
             look like a fork and would cut segments (cf. chains.ts branchSegment) */
          if (own && !e.dash) {
            if (!S.fpChildren.has(row)) S.fpChildren.set(row, [])
            S.fpChildren.get(row)!.push(e.r1)
          }
        } else if (own) S.mergedBy.set(row, e.r1)
      })
      if (S.pending.delete(hh)) pendingMoved = true
      S.rowOf.set(internId(S.ids, hh), row)
    }
    S.hashOf[row] = internId(S.ids, c.h)
    if (c.r) S.refsOf.set(row, c.r)
    if (c.p.length > 1) {
      const mg = parseMerge(c.s) // covers gitflow, tag and GitHub PR forms alike
      if (mg) S.mergeOf.set(row, mg)
    }
    S.laneOf[row] = lane
    chunkOf(S.nodes, Math.floor(row / CHUNK)).push({
      row,
      lane,
      merge: c.p.length > 1,
      cap: c.cap?.flow,
      stash: !!c.stash,
    })

    c.p.forEach((p, k) => {
      let travel: number
      if (k === 0) {
        // the first-parent line stays in its lane until the fork: edges
        // converge on the parent node instead of jumping into the neighboring lane
        travel = lane
        S.lanes[lane] = p
        S.meta[lane] = 0
      } else {
        let e = S.lanes.indexOf(p)
        /* Parent master d'une capsule : la lane tronc vient d'être fermée par le nœud —
           la rouvrir ici, sinon master repartirait sur une lane quelconque après chaque
           release/hotfix et la colonne réservée resterait vide. */
        if (e < 0 && c.cap && k === 1) {
          const tl = S.trunkLanes.get(c.cap.targets[0])
          if (tl !== undefined && S.lanes[tl] === null) e = tl
        }
        travel = e >= 0 ? e : alloc(S)
        S.lanes[travel] = p
        if (e < 0 && S.meta[travel] !== 0) S.meta[travel] = k
      }
      if (!S.pending.has(p)) S.pending.set(p, [])
      const rec: Edge = { r1: row, l1: lane, travel, k }
      if (c.stash) rec.dash = true
      S.pending.get(p)!.push(rec)
      pendingMoved = true
      if (k === 0) S.fpEdge[row] = rec
    })
  }
  if (pendingMoved) S.pendingGen++
  S.next = end
  S.ms += performance.now() - t0
}
