/* Chaînes de branche (AUDIT.md §6) : remontée du tronc, segment net pour le diff, et résumé
   structuré de ce à quoi une sélection appartient. Pur, comme le reste de layout/. */

import { parseRefs } from "../../../lib/commit-message.ts"
import { hashOfId } from "../ids.ts"
import type { LayoutState } from "./state.ts"

/* Refs de branche d'une ligne, nom court côté remote : `origin/x` désigne la branche `x`.
   Frontières de segment — la base d'une branche est souvent le tip d'une autre (develop sans
   commit depuis le fork), qu'aucun fork topologique ne signale. Le marqueur HEAD détaché et
   les tags n'en sont pas. Lues dans l'état de layout : les chaînes se parcourent sans les
   commits, dont la page a pu être évincée. */
export const branchRefs = (S: LayoutState, row: number) =>
  parseRefs(S.refsOf.get(row) ?? "")
    .filter((r) => r.kind !== "tag" && r.name !== "HEAD")
    .map((r) => (r.kind === "remote" ? r.name.slice(r.name.indexOf("/") + 1) : r.name))

/** Ligne du tip de la chaîne de `i` : remonte le tronc first-parent jusqu'au commit qui porte
    le nom de branche (ou jusqu'à un fork sans nom). O(montée), sans tableau — remplace l'ancien
    `branchChain(S, i)[0]`, dont la construction du tableau entier (avec `unshift` quadratique)
    ne servait qu'à lire son premier élément à chaque survol (AUDIT.md §6, item perf : « fini le
    branchChain jusqu'à la racine à chaque mouseover »). */
export function chainTip(S: LayoutState, i: number): number {
  let r = i
  for (;;) {
    /* on ne grimpe pas au-dessus d'un tip : ce qui est plus haut appartient à une descendante
       (hover du tip de develop quand une feature est posée dessus, linéaire donc sans fork) */
    if (branchRefs(S, r).length) break
    const kids = S.fpChildren.get(r)
    if (!kids || !kids.length) break
    /* Fork (une release, un hotfix branchés ici) : plusieurs enfants ont ce commit pour first-parent.
       Le tronc est celui qui garde le couloir — même lane. Sans ça la remontée s'arrête au fork, et
       un commit sans ref y perd le nom de sa branche (ex. un WIP juste sous un « Merge tag … into develop »). */
    const up = kids.length === 1 ? kids[0] : kids.find((k) => S.laneOf[k] === S.laneOf[r])
    if (up === undefined) break
    r = up
  }
  return r
}

/** Comme `chainTip`, mais borné au fork point ou à la première ref étrangère, et rend le segment
    entier (chaîne descendante + tronc jusqu'à la frontière) : sert au diff net d'une branche. */
export function branchSegment(S: LayoutState, i: number) {
  const rows = [i]
  let r = i
  for (;;) {
    if (branchRefs(S, r).length) break // on ne grimpe pas au-dessus d'un tip
    const kids = S.fpChildren.get(r)
    if (!kids || kids.length !== 1) break
    r = kids[0]
    rows.unshift(r)
  }
  /* les refs du haut du segment : sa distante en retard (`origin/x` posé plus bas) ne coupe pas */
  const own = new Set(branchRefs(S, rows[0]))
  r = i
  for (;;) {
    const pr = S.fpRow[r]
    if (pr === undefined) break
    if ((S.fpChildren.get(pr) || []).length !== 1) break // le parent est un fork : tronc commun
    if (branchRefs(S, pr).some((n) => !own.has(n))) break // le parent est le tip d'une autre branche
    rows.push(pr)
    r = pr
  }
  return rows
}

/** Résumé structuré de la sélection courante : à quelles branches son tip appartient, et si le
    segment a été mergé. Données brutes — plus de prose française dans le module d'algorithme
    (AUDIT.md §6, item 3) : c'est React qui compose le texte affiché (cf. detail-panel.tsx). */
export type ChainInfo =
  | { refs: string | null; merged: true; mergedInto: string | null; mergeHash: string }
  | { refs: string | null; merged: false }

export function chainInfo(S: LayoutState, rows: number[]): ChainInfo {
  const tip = rows[0]
  /* toutes les branches du tip : une branche vide posée sur master partage ses commits */
  const refs = parseRefs(S.refsOf.get(tip) ?? "").filter((r) => r.kind !== "tag").map((r) => r.name).join(", ") || null
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
