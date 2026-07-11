/* Peinture des runs de focus (AUDIT.md §7, phase 5) : une des cinq préoccupations de l'ancien
   refs-sidebar.tsx monolithique, isolée et documentée telle quelle plutôt que recalculée en
   données — un repli/dépli de dossier ne rerend pas le sidebar (état interne du Collapsible),
   et l'ordre visuel réel (dossiers repliés hors flux) est le seul qui compte pour fusionner des
   contours contigus. Passer par le DOM ici reste le point le plus direct, malgré le passage des
   Collapsible en contrôlé (cf. refs-tree.tsx) : `data-lit`/`offsetParent` restent la source de
   vérité de « qui est visible, dans quel ordre, dans quelle liste ». */

/** Fusionne les contours des refs allumées visuellement contiguës : lit l'ordre DOM réel (les
    dossiers repliés sont display:none → hors flux), pas l'ordre logique de l'arbre. Deux refs ne
    se joignent que dans la même liste : un trigger de dossier n'est pas une `.amont-refrow`, donc
    deux branches de dossiers voisins seraient consécutives ici alors qu'un pli les sépare. */
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
