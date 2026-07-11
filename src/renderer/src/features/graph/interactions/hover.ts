/* Survol du graphe (AUDIT.md §6) : nomme la branche du commit survolé via un chip fantôme posé
   dans la colonne branche quand elle est vide — sinon la ligne est déjà un tip et porte son vrai
   chip. Perf (AUDIT.md §6, item perf) : s'appuie sur `chainTip` (O(montée), sans tableau) plutôt
   que sur l'ancien `branchChain` reconstruit en entier à chaque mouseover. */

import { parseRefs } from "@/lib/commit-message"
import { laneColor } from "../constants.ts"
import { chainTip } from "../layout/chains.ts"
import type { LayoutState } from "../layout/state.ts"
import { ghostChips } from "../render/rows.ts"

/* Refs de branche posées sur une ligne, au rang parseRefs (HEAD, locales, distantes) ; la
   distante synchronisée est absorbée par sa locale. `kind` aligné sur GitRef pour que le
   sidebar retrouve sa ligne. Lues dans l'état de layout, indépendant du cache de pages. */
export const refChips = (S: LayoutState, row: number) =>
  parseRefs(S.refsOf.get(row) ?? "")
    .filter((c) => c.kind !== "tag")
    .map((c) => ({ name: c.name, kind: c.kind === "remote" ? ("remote" as const) : ("head" as const) }))

/* Branches auxquelles appartient le tip : ses refs vivantes, sinon celle que le commit de merge
   a absorbée (`mergedBy` → `from`). Sans ce repli, une branche mergée puis supprimée — la
   majorité de l'historique — n'a plus aucun nom en local et le ghost ne s'afficherait jamais. */
export function tipBranches(S: LayoutState, tip: number) {
  const own = refChips(S, tip)
  if (own.length) return own
  const mrow = S.mergedBy.get(tip)
  const src = mrow !== undefined ? (S.mergeOf.get(mrow)?.from ?? null) : null
  return src ? [{ name: src, kind: "head" as const }] : []
}

export function createHover(inner: HTMLDivElement) {
  let hovered: number | null = null
  let ghostEl: HTMLElement | null = null

  function clearGhost() {
    ghostEl?.remove()
    ghostEl = null
  }

  function clearHover() {
    hovered = null
    clearGhost()
  }

  /** `isStash` : un stash porte déjà son chip — ni chaîne à remonter, ni ghost. */
  function hoverRow(S: LayoutState, i: number, isStash: boolean) {
    if (i === hovered) return
    hovered = i
    clearGhost()
    if (isStash) return
    const tip = chainTip(S, i)
    const names = tipBranches(S, tip).map((b) => b.name)
    if (!names.length) return
    const cell = inner.querySelector<HTMLElement>(`.gg-row[data-i="${i}"] .gg-branchcell`)
    if (!cell || cell.childElementCount) return
    ghostEl = ghostChips(names, laneColor(S.laneOf[tip]))
    cell.appendChild(ghostEl)
  }

  return { hoverRow, clearHover }
}

export type HoverController = ReturnType<typeof createHover>
