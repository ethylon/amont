/* Branch chains (AUDIT.md §6): trunk climb, clean segment for the diff, and structured
   summary of what a selection belongs to. Pure, like the rest of layout/. */

import { parseRefs } from "../../../lib/commit-parse.ts"
import { branchFlow } from "../../../lib/gitflow.ts"
import { hashOfId } from "../ids.ts"
import type { LayoutState } from "./state.ts"

/* shared empty result: the overwhelming majority of rows carry no refs, and `branchRefs`
   runs once per climb step — a fresh `parseRefs("")` (split + Map + arrays) per undecorated
   row was pure allocation churn (hovering row 15 000 walked ~15k of them) */
const NO_REFS: string[] = []

/* Branch refs of a row, short name on the remote side: `origin/x` designates branch `x`.
   Segment boundaries — a branch's base is often another branch's tip (develop with no
   commit since the fork), which no topological fork signals. The detached HEAD marker and
   tags aren't among them. Read from the layout state: chains are walked without the
   commits, whose page may have been evicted. */
export const branchRefs = (S: LayoutState, row: number) => {
  const raw = S.refsOf.get(row) // decorated rows only: absent means no refs, skip the parse
  if (raw === undefined) return NO_REFS
  return parseRefs(raw)
    .filter((r) => r.kind !== "tag" && r.name !== "HEAD")
    .map((r) => (r.kind === "remote" ? r.name.slice(r.name.indexOf("/") + 1) : r.name))
}

/** Row of the tip of `i`'s chain: climbs the first-parent trunk up to the commit carrying
    the branch name (or up to an unnamed fork). O(climb), no array — replaces the old
    `branchChain(S, i)[0]`, whose building of the entire array (with quadratic `unshift`)
    only served to read its first element on every hover (AUDIT.md §6, perf item: "no more
    walking branchChain to the root on every mouseover").
    Memoized in `S.tipOf` — for `i` AND every row crossed on the way up, which all share the
    same tip: sweeping the cursor down a long chain costs O(chain) once, not O(chain) per
    hovered row. Valid for the state's lifetime (cf. layout/state.ts `tipOf`). */
export function chainTip(S: LayoutState, i: number): number {
  const hit = S.tipOf.get(i)
  if (hit !== undefined) return hit
  const path: number[] = []
  let r = i
  for (;;) {
    /* an already-memoized ancestor short-circuits the rest of the climb */
    const up0 = S.tipOf.get(r)
    if (up0 !== undefined) {
      r = up0
      break
    }
    /* we don't climb past a tip: whatever is higher belongs to a descendant
       (hovering develop's tip while a feature branch sits on top of it, linear so no fork) */
    if (branchRefs(S, r).length) break
    const kids = S.fpChildren.get(r)
    if (!kids || !kids.length) break
    /* Fork (a release, a hotfix branched here): several children have this commit as first-parent.
       The trunk is the one that keeps the lane — same lane. Without this the climb would stop at the fork, and
       a ref-less commit would lose its branch name there (e.g. a WIP right under a "Merge tag … into develop"). */
    const up = kids.length === 1 ? kids[0] : kids.find((k) => S.laneOf[k] === S.laneOf[r])
    if (up === undefined) break
    path.push(r)
    r = up
  }
  S.tipOf.set(i, r)
  for (const v of path) S.tipOf.set(v, r)
  return r
}

/** Famille gitflow d'une chaîne, `null` = travail ordinaire (feature, PR, branche libre). */
export type ChainFlow = "master" | "develop" | "hotfix" | "release" | null

const TRUNK = /^(master|main|develop)$/
const MASTER = /^(master|main)$/

/** Famille de la chaîne de `row`, par son tip : refs vivantes d'abord, sinon le nom de la
    branche absorbée par son merge (`mergedBy` → `from`) — la majorité de l'historique.
    Le tronc, lui, se lit par sa lane réservée (cf. lanes.ts `reserveTrunks`) : ici la
    classification par nom ne sert qu'aux chaînes ordinaires et au repli sans réservation.
    Stable dès la pose de la row (le merge absorbant est toujours au-dessus, donc déjà posé) :
    sûr vis-à-vis du cache de markup par chunk (render/svg.ts). Mémoïsé par tip dans `S.flowOf`. */
export function chainFlow(S: LayoutState, row: number): { flow: ChainFlow; tip: number } {
  const tip = chainTip(S, row)
  let flow = S.flowOf.get(tip)
  if (flow === undefined) {
    const names = branchRefs(S, tip)
    let name: string | null = names.find((n) => TRUNK.test(n)) ?? names[0] ?? null
    if (name === null) {
      const mrow = S.mergedBy.get(tip)
      name = mrow !== undefined ? (S.mergeOf.get(mrow)?.from ?? null) : null
    }
    if (name === null) flow = null
    else if (MASTER.test(name)) flow = "master"
    else if (name === "develop") flow = "develop"
    else {
      const kind = branchFlow(name, null)
      flow = kind === "hotfix" || kind === "release" ? kind : null
    }
    S.flowOf.set(tip, flow)
  }
  return { flow, tip }
}

/** Like `chainTip`, but bounded by the fork point or the first foreign ref, and returns the
    entire segment (descendant chain + trunk up to the boundary): used for a branch's clean diff. */
export function branchSegment(S: LayoutState, i: number) {
  /* climbed in visit order then reversed once: the old per-step `unshift` was O(k²) —
     selecting a 10k-commit branch shifted ~5×10⁷ elements for the same tip-first result */
  const rows = [i]
  let r = i
  for (;;) {
    if (branchRefs(S, r).length) break // we don't climb past a tip
    const kids = S.fpChildren.get(r)
    if (!kids || kids.length !== 1) break
    r = kids[0]
    rows.push(r)
  }
  rows.reverse()
  /* refs at the top of the segment: its lagging remote (`origin/x` set further down) doesn't cut it off */
  const own = new Set(branchRefs(S, rows[0]))
  r = i
  for (;;) {
    const pr = S.fpRow[r]
    if (pr === undefined) break
    if ((S.fpChildren.get(pr) || []).length !== 1) break // the parent is a fork: common trunk
    if (branchRefs(S, pr).some((n) => !own.has(n))) break // the parent is another branch's tip
    rows.push(pr)
    r = pr
  }
  return rows
}

/** Structured summary of the current selection: which branches its tip belongs to, and whether the
    segment has been merged. Raw data — no more prose baked into the algorithm module
    (AUDIT.md §6, item 3): React is the one that composes the displayed text (cf. detail-panel.tsx). */
export type ChainInfo =
  | { refs: string | null; merged: true; mergedInto: string | null; mergeHash: string }
  | { refs: string | null; merged: false }

export function chainInfo(S: LayoutState, rows: number[]): ChainInfo {
  const tip = rows[0]
  /* all of the tip's branches: an empty branch sitting on master shares its commits */
  const refs =
    parseRefs(S.refsOf.get(tip) ?? "")
      .filter((r) => r.kind !== "tag")
      .map((r) => r.name)
      .join(", ") || null
  const mrow = S.mergedBy.get(tip)
  if (mrow !== undefined) {
    return {
      refs,
      merged: true,
      mergedInto: S.mergeOf.get(mrow)?.to ?? null,
      mergeHash: hashOfId(S.ids, S.hashOf[mrow]),
    }
  }
  return { refs, merged: false }
}
