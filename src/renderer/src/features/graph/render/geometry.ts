/* Géométrie pure du métro (AUDIT.md §6) : position pixel d'une lane/ligne et tracé SVG d'une
   arête. Zéro DOM — ne fabrique que des nombres et des chaînes `d=`, testable par snapshot. */

import { LANE, PAD, ROW } from "../constants.ts"
import type { Edge } from "../layout/state.ts"

export const X = (l: number) => PAD + l * LANE + LANE / 2
export const Y = (r: number) => r * ROW + ROW / 2

/** Tracé SVG d'une arête. `yEnd` : hauteur totale du graphe, utilisée à la place de `Y(e.r2)`
    pour les arêtes encore en attente (`e.r2 === undefined`) — l'overlay les prolonge jusqu'en
    bas plutôt que de ne rien dessiner (cf. render/overlay.ts). */
export function edgePath(e: Edge, yEnd?: number) {
  const x1 = X(e.l1)
  const y1 = Y(e.r1)
  const xt = X(e.travel)
  const x2 = e.r2 !== undefined ? X(e.l2!) : xt
  const y2 = e.r2 !== undefined ? Y(e.r2) : yEnd!
  if (x1 === xt && xt === x2) return `M${x1} ${y1}V${y2}`
  if (e.r2 !== undefined && e.r2 - e.r1 === 1)
    return `M${x1} ${y1}C${x1} ${y1 + ROW * 0.7} ${x2} ${y2 - ROW * 0.7} ${x2} ${y2}`
  let d = `M${x1} ${y1}`
  d += x1 === xt ? `V${y1 + ROW}` : `C${x1} ${y1 + ROW * 0.9} ${xt} ${y1 + ROW * 0.1} ${xt} ${y1 + ROW}`
  d += `V${e.r2 !== undefined ? y2 - ROW : y2}`
  if (e.r2 !== undefined)
    d += xt === x2 ? `V${y2}` : `C${xt} ${y2 - ROW * 0.1} ${x2} ${y2 - ROW * 0.9} ${x2} ${y2}`
  return d
}
