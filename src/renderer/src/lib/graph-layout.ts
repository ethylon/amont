import type { Commit } from "@/lib/git"
import { parseMerge, parseRefs } from "@/lib/commit-message"

export const ROW = 28
export const LANE = 14
export const PAD = 10
export const R = 4
export const CHUNK = 500
export const PAGE = 1000

const LANES = 10

/* Les teintes vivent dans :root / .dark (cf. app.css) : un var() dans un attribut de
   présentation SVG suit le thème sans passer par une utility Tailwind. */
export const laneColor = (i: number) => `var(--lane-${i % LANES})`

export type Edge = { r1: number; l1: number; travel: number; k: number; r2?: number; l2?: number }
export type GraphNode = { row: number; lane: number; merge: boolean }

/** État de layout persistant entre les pages — le graphe se construit en streaming. */
export type LayoutState = {
  lanes: (string | null)[]
  meta: number[]
  pending: Map<string, Edge[]>
  next: number
  rowOf: Map<string, number>
  nodes: GraphNode[][]
  edges: Edge[][]
  long: Edge[]
  ms: number
  /** lane de chaque ligne */
  laneOf: number[]
  /** arête first-parent partant de chaque ligne */
  fpEdge: Edge[]
  /** hash -> lignes des enfants dont il est le first-parent */
  fpChildren: Map<string, number[]>
  /** hash -> ligne du merge qui l'a absorbé (second parent) */
  mergedBy: Map<string, number>
}

export function createState(nchunks: number): LayoutState {
  return {
    lanes: [], meta: [], pending: new Map(), next: 0,
    rowOf: new Map(),
    nodes: Array.from({ length: nchunks }, () => []),
    edges: Array.from({ length: nchunks }, () => []),
    long: [], ms: 0,
    laneOf: [],
    fpEdge: [],
    fpChildren: new Map(),
    mergedBy: new Map(),
  }
}

function alloc(S: LayoutState) {
  let i = S.lanes.indexOf(null)
  if (i < 0) {
    i = S.lanes.length
    S.lanes.push(null)
  }
  return i
}

export function layoutChunk(S: LayoutState, data: Commit[]) {
  const t0 = performance.now()
  const end = Math.min(S.next + CHUNK, data.length)
  for (let row = S.next; row < end; row++) {
    const c = data[row]
    const waiting: number[] = []
    S.lanes.forEach((h, i) => {
      if (h === c.h) waiting.push(i)
    })
    let lane = waiting.find((i) => S.meta[i] === 0) // continuité first-parent d'abord
    if (lane === undefined) lane = waiting.length ? Math.min(...waiting) : alloc(S)
    waiting.forEach((i) => {
      S.lanes[i] = null
      S.meta[i] = -1
    })

    ;(S.pending.get(c.h) || []).forEach((e) => {
      e.r2 = row
      e.l2 = lane
      const c1 = Math.floor(e.r1 / CHUNK)
      ;(c1 === Math.floor(row / CHUNK) ? S.edges[c1] : S.long).push(e)
    })
    S.pending.delete(c.h)
    S.rowOf.set(c.h, row)
    S.laneOf[row] = lane
    S.nodes[Math.floor(row / CHUNK)].push({ row, lane, merge: c.p.length > 1 })

    c.p.forEach((p, k) => {
      let travel: number
      if (k === 0) {
        // le trait first-parent reste dans son couloir jusqu'au fork : les arêtes
        // convergent sur le nœud parent au lieu de sauter dans le couloir d'à côté
        travel = lane
        S.lanes[lane] = p
        S.meta[lane] = 0
      } else {
        const e = S.lanes.indexOf(p)
        travel = e >= 0 ? e : alloc(S)
        S.lanes[travel] = p
        if (e < 0 && S.meta[travel] !== 0) S.meta[travel] = k
      }
      if (!S.pending.has(p)) S.pending.set(p, [])
      const rec: Edge = { r1: row, l1: lane, travel, k }
      S.pending.get(p)!.push(rec)
      if (k === 0) {
        S.fpEdge[row] = rec
        if (!S.fpChildren.has(p)) S.fpChildren.set(p, [])
        S.fpChildren.get(p)!.push(row)
      } else {
        S.mergedBy.set(p, row)
      }
    })
  }
  S.next = end
  S.ms += performance.now() - t0
}

export const X = (l: number) => PAD + l * LANE + LANE / 2
export const Y = (r: number) => r * ROW + ROW / 2

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

export const stroke = (e: Edge) => laneColor(e.travel)

export const edgesSvg = (list: Edge[]) =>
  list.map((e) => `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"/>`).join("")

export const nodesSvg = (list: GraphNode[]) =>
  list
    .map((n) => {
      const c = laneColor(n.lane)
      return n.merge
        ? `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.8}" fill="var(--background)" stroke="${c}" stroke-width="1.8"/>`
        : `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R}" fill="${c}" stroke="var(--background)" stroke-width="1.5"/>`
    })
    .join("")

/** Segment de branche : chaîne first-parent vers le bas, remontée le long du tronc vers le tip. */
export function branchChain(S: LayoutState, data: Commit[], i: number) {
  const rows = [i]
  let r = i
  for (;;) {
    const pr = S.rowOf.get(data[r].p[0])
    if (pr === undefined) break
    rows.push(pr)
    r = pr
  }
  r = i
  for (;;) {
    const kids = S.fpChildren.get(data[r].h)
    if (!kids || !kids.length) break
    /* Fork (une release, un hotfix branchés ici) : plusieurs enfants ont ce commit pour first-parent.
       Le tronc est celui qui garde le couloir — même lane. Sans ça la remontée s'arrête au fork, et
       un commit sans ref y perd le nom de sa branche (ex. un WIP juste sous un « Merge tag … into develop »). */
    const up = kids.length === 1 ? kids[0] : kids.find((k) => S.laneOf[k] === S.laneOf[r])
    if (up === undefined) break
    r = up
    rows.unshift(r)
  }
  return rows
}

/** Comme branchChain, mais borné au fork point : sert au diff net d'une branche. */
export function branchSegment(S: LayoutState, data: Commit[], i: number) {
  const rows = [i]
  let r = i
  for (;;) {
    const kids = S.fpChildren.get(data[r].h)
    if (!kids || kids.length !== 1) break
    r = kids[0]
    rows.unshift(r)
  }
  r = i
  for (;;) {
    const p = data[r].p[0]
    const pr = S.rowOf.get(p)
    if (pr === undefined) break
    if ((S.fpChildren.get(p) || []).length !== 1) break // le parent est un fork : tronc commun
    rows.push(pr)
    r = pr
  }
  return rows
}

export function chainInfo(S: LayoutState, data: Commit[], rows: number[]) {
  const tip = data[rows[0]]
  const ref = parseRefs(tip.r).find((r) => r.kind !== "tag")?.name ?? null
  const mrow = S.mergedBy.get(tip.h)
  if (mrow !== undefined) {
    const to = parseMerge(data[mrow].s)?.to
    return `${ref ? ref + " · " : ""}mergée${to ? " dans " + to : ""} (${data[mrow].h})`
  }
  return ref ? `${ref} · non mergée` : "segment non mergé"
}
