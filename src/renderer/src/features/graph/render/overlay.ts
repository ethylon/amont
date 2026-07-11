/* Overlay des arêtes longues + pendantes (AUDIT.md §6, item perf) : avant ce module,
   `overlay.innerHTML = edgesSvg(S.long) + dangling` reconstruisait la sérialisation ENTIÈRE de
   toutes les arêtes longues connues à chaque page reçue — jamais virtualisé, coût cumulé en
   O(n²/PAGE) sur un gros dépôt. Ici :
   - les arêtes longues sont réparties en buckets grossiers par intervalle de lignes dès leur
     résolution (`assignNew`), ajoutées en incrémental (`insertAdjacentHTML`) au bucket déjà
     monté plutôt que de tout resérialiser ;
   - `sync()` ne monte que les buckets qui recoupent le viewport, comme les chunks SVG courts —
     l'overlay grandit avec l'historique mais son empreinte DOM reste bornée au viewport.
   Les arêtes pendantes (`S.pending`) restent reconstruites en entier à chaque appel : elles sont
   peu nombreuses (bornées par le nombre de lanes ouvertes, pas par la taille de l'historique),
   ce n'était pas l'offenseur O(n²). */

import { OVERLAY_BUCKET } from "../constants.ts"
import type { Edge, LayoutState } from "../layout/state.ts"
import { edgePath } from "./geometry.ts"
import { stroke } from "./svg.ts"

const SVG_NS = "http://www.w3.org/2000/svg"

/** Buckets grossiers touchés par une arête longue : bornés même pour une arête qui traverse tout
    l'historique, puisque `OVERLAY_BUCKET` est un multiple de CHUNK bien plus grossier. */
function bucketsOf(e: Edge): number[] {
  // toujours résolue : S.long ne reçoit une arête qu'après `e.r2 = row` (cf. layoutChunk)
  const lo = Math.floor(Math.min(e.r1, e.r2!) / OVERLAY_BUCKET)
  const hi = Math.floor(Math.max(e.r1, e.r2!) / OVERLAY_BUCKET)
  const out: number[] = []
  for (let b = lo; b <= hi; b++) out.push(b)
  return out
}

const edgeMarkup = (e: Edge) =>
  `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"${e.dash ? ' stroke-dasharray="3 3"' : ""}/>`

export function createOverlay() {
  /** monté une fois pour toutes par le contrôleur, avant les chunks SVG courts */
  const root = document.createElementNS(SVG_NS, "g")
  /** toujours monté, dernier enfant de `root` — les pendantes passent devant les longues */
  const dangling = document.createElementNS(SVG_NS, "g")
  root.appendChild(dangling)

  const buckets = new Map<number, Edge[]>()
  const mounted = new Map<number, SVGGElement>()
  /** combien de `S.long` ont déjà été répartis en buckets — S.long ne fait que grandir */
  let assignedLen = 0

  function assignNew(S: LayoutState) {
    for (; assignedLen < S.long.length; assignedLen++) {
      const e = S.long[assignedLen]
      for (const b of bucketsOf(e)) {
        if (!buckets.has(b)) buckets.set(b, [])
        buckets.get(b)!.push(e)
        const g = mounted.get(b)
        if (g) g.insertAdjacentHTML("beforeend", edgeMarkup(e)) // bucket déjà visible : append, pas de rebuild
      }
    }
  }

  /** `viewRows` : plage de lignes que le viewport recoupe actuellement (mêmes bornes que les
      chunks SVG courts, cf. controller.ts) ; `height` : hauteur totale du graphe, pour prolonger
      les arêtes encore pendantes jusqu'en bas. */
  function sync(S: LayoutState, viewRows: readonly [number, number], height: number) {
    assignNew(S)
    const b0 = Math.floor(viewRows[0] / OVERLAY_BUCKET)
    const b1 = Math.floor(viewRows[1] / OVERLAY_BUCKET)

    mounted.forEach((g, b) => {
      if (b < b0 || b > b1) {
        g.remove()
        mounted.delete(b)
      }
    })
    for (let b = b0; b <= b1; b++) {
      if (mounted.has(b)) continue
      const g = document.createElementNS(SVG_NS, "g")
      g.innerHTML = (buckets.get(b) ?? []).map(edgeMarkup).join("")
      root.insertBefore(g, dangling)
      mounted.set(b, g)
    }

    let html = ""
    S.pending.forEach((list) =>
      list.forEach((e) => {
        html += `<path d="${edgePath(e, height)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6" stroke-dasharray="2 4" opacity="0.45"/>`
      })
    )
    dangling.innerHTML = html
  }

  return { root, sync }
}
