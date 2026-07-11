/* Painting of focus runs (AUDIT.md §7, phase 5): one of the five concerns of the old
   monolithic refs-sidebar.tsx, isolated and documented as-is rather than recomputed as
   data — collapsing/expanding a folder doesn't rerender the sidebar (Collapsible's internal
   state), and the actual visual order (collapsed folders out of flow) is the only one that
   matters for merging contiguous outlines. Going through the DOM here remains the most direct
   approach, despite the Collapsibles becoming controlled (see refs-tree.tsx): `data-lit`/`offsetParent`
   remain the source of truth for "who is visible, in what order, in which list". */

/** Merges the outlines of visually contiguous lit refs: reads the actual DOM order (collapsed
    folders are display:none → out of flow), not the tree's logical order. Two refs only join
    within the same list: a folder trigger isn't a `.amont-refrow`, so two branches from
    neighboring folders would appear consecutive here even though a fold separates them. */
export function paintFocusRuns(root: HTMLElement | null): void {
  if (!root) return
  const rows = [...root.querySelectorAll<HTMLElement>(".amont-refrow")].filter((b) => b.offsetParent)
  const lit = rows.map((b) => b.dataset.lit === "1")
  const list = rows.map((b) => b.closest("ul"))
  rows.forEach((b, i) => {
    if (!lit[i]) return void delete b.dataset.run
    const p = i > 0 && lit[i - 1] && list[i - 1] === list[i]
    const n = i < rows.length - 1 && lit[i + 1] && list[i + 1] === list[i]
    b.dataset.run = p && n ? "mid" : p ? "end" : n ? "start" : "solo"
  })
}
