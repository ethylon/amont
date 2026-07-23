/* Graph hover (AUDIT.md §6): names the hovered commit's branch via a ghost chip placed
   in the branch column when it's empty — otherwise the row is already a tip and carries its real
   chip. Perf (AUDIT.md §6, perf item): relies on `chainTip` (O(climb), no array) rather
   than the old `branchChain` fully rebuilt on every mouseover. */

import { parseRefs } from "@/lib/commit-parse"
import { chainTip } from "../layout/chains.ts"
import { chainColor } from "../render/svg.ts"
import type { LayoutState } from "../layout/state.ts"
import { ghostChips } from "../render/rows.ts"

/* Branch refs placed on a row, at parseRefs rank (HEAD, local, remote); a
   synced remote is absorbed by its local counterpart. `kind` aligned with GitRef so the
   sidebar can find its row. Read from the layout state, independent of the page cache.
   Undecorated rows (the vast majority) skip `parseRefs` outright — this runs on every row
   the cursor crosses (cf. `hoverRow` → tipBranches), an empty parse per hover added up. */
export const refChips = (S: LayoutState, row: number) => {
  const raw = S.refsOf.get(row)
  if (raw === undefined) return []
  return parseRefs(raw)
    .filter((c) => c.kind !== "tag")
    .map((c) => ({ name: c.name, kind: c.kind === "remote" ? ("remote" as const) : ("head" as const) }))
}

/* Branches the tip belongs to: its live refs, otherwise the one absorbed by the merge
   commit (`mergedBy` → `from`). Without this fallback, a branch merged then deleted — the
   majority of history — would have no local name left and the ghost would never show. */
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

  /** `isStash`: a stash already carries its chip — no chain to climb, no ghost. */
  function hoverRow(S: LayoutState, i: number, isStash: boolean) {
    if (i === hovered) return
    hovered = i
    clearGhost()
    if (isStash) return
    const tip = chainTip(S, i)
    const names = tipBranches(S, tip).map((b) => b.name)
    if (!names.length) return
    const cell = inner.querySelector<HTMLElement>(`.amont-row[data-i="${i}"] .amont-branchcell`)
    if (!cell || cell.childElementCount) return
    ghostEl = ghostChips(names, chainColor(S, tip))
    cell.appendChild(ghostEl)
  }

  return { hoverRow, clearHover }
}

export type HoverController = ReturnType<typeof createHover>
