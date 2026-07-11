/* Pure metro geometry (AUDIT.md §6): pixel position of a lane/row and SVG path of an
   edge. Zero DOM — only produces numbers and `d=` strings, snapshot-testable. */

import { LANE, PAD, ROW } from "../constants.ts"
import type { Edge } from "../layout/state.ts"

export const X = (l: number) => PAD + l * LANE + LANE / 2
export const Y = (r: number) => r * ROW + ROW / 2

/** SVG path of an edge. `yEnd`: total height of the graph, used instead of `Y(e.r2)`
    for edges still pending (`e.r2 === undefined`) — the overlay extends them all the way
    down rather than drawing nothing (cf. render/overlay.ts). */
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
  if (e.r2 !== undefined) d += xt === x2 ? `V${y2}` : `C${xt} ${y2 - ROW * 0.1} ${x2} ${y2 - ROW * 0.9} ${x2} ${y2}`
  return d
}
