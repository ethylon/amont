import type { Commit } from "@/lib/git"
/* relatif avec extension, pas l'alias `@/` : scripts/check-graph.ts importe ce module sous
   Node (type stripping), qui ne connaît ni l'alias ni la résolution sans extension */
import { mergeFlow, parseMerge, parseRefs, SEMVER, type FlowKind, type ParsedMerge } from "./commit-message.ts"

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

export type Edge = {
  r1: number; l1: number; travel: number; k: number; r2?: number; l2?: number
  /** arête de stash : tracée en pointillés — un instantané suspendu, pas de l'historique */
  dash?: boolean
}
export type GraphNode = { row: number; lane: number; merge: boolean; cap?: FlowKind; stash?: boolean }

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
    /* Une capsule répond pour deux hashes : le sien (côté develop) et le merge master absorbé.
       Fermer les deux lanes ici fait converger la lane master sur le nœud = le pont du métro. */
    const heads = c.cap ? [c.h, c.cap.absorbed] : [c.h]
    const waiting: number[] = []
    S.lanes.forEach((h, i) => {
      if (h !== null && heads.includes(h)) waiting.push(i)
    })
    let lane = waiting.find((i) => S.meta[i] === 0) // continuité first-parent d'abord
    if (lane === undefined) lane = waiting.length ? Math.min(...waiting) : alloc(S)
    waiting.forEach((i) => {
      S.lanes[i] = null
      S.meta[i] = -1
    })

    for (const hh of heads) {
      ;(S.pending.get(hh) || []).forEach((e) => {
        e.r2 = row
        e.l2 = lane
        const c1 = Math.floor(e.r1 / CHUNK)
        ;(c1 === Math.floor(row / CHUNK) ? S.edges[c1] : S.long).push(e)
      })
      S.pending.delete(hh)
      S.rowOf.set(hh, row)
    }
    S.laneOf[row] = lane
    S.nodes[Math.floor(row / CHUNK)].push({
      row, lane, merge: c.p.length > 1, cap: c.cap?.flow, stash: !!c.stash,
    })

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
      if (c.stash) rec.dash = true
      S.pending.get(p)!.push(rec)
      if (k === 0) {
        S.fpEdge[row] = rec
        /* un stash n'est pas un enfant de branche : l'inscrire ici ferait passer son commit
           de base pour un fork et couperait les segments (cf. branchSegment) */
        if (!c.stash) {
          if (!S.fpChildren.has(p)) S.fpChildren.set(p, [])
          S.fpChildren.get(p)!.push(row)
        }
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
  list
    .map((e) =>
      `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"${e.dash ? ' stroke-dasharray="3 3"' : ""}/>`)
    .join("")

export const nodesSvg = (list: GraphNode[]) =>
  list
    .map((n) => {
      const c = laneColor(n.lane)
      if (n.stash) {
        /* Anneau pointillé, même grammaire que le point d'arbre de travail : un état
           suspendu, pas un commit d'historique. */
        return `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.4}" fill="var(--background)" stroke="${c}" stroke-width="1.5" stroke-dasharray="2.4 2.2"/>`
      }
      if (n.cap) {
        /* Losange du jalon : la release/hotfix atterrit ici, teinte du flow, pas de la lane. */
        const col = n.cap === "hotfix" ? "var(--destructive)" : "var(--release)"
        const x = X(n.lane), y = Y(n.row), r = R + 1.5
        return `<path d="M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z" fill="${col}" stroke="var(--background)" stroke-width="1.5"/>`
      }
      return n.merge
        ? `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - 0.8}" fill="var(--background)" stroke="${c}" stroke-width="1.8"/>`
        : `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R}" fill="${c}" stroke="var(--background)" stroke-width="1.5"/>`
    })
    .join("")

/* Refs de branche d'une ligne, nom court côté remote : `origin/x` désigne la branche `x`.
   Frontières de segment — la base d'une branche est souvent le tip d'une autre (develop sans
   commit depuis le fork), qu'aucun fork topologique ne signale. Le marqueur HEAD détaché et
   les tags n'en sont pas. */
const branchRefs = (c: Commit) =>
  parseRefs(c.r)
    .filter((r) => r.kind !== "tag" && r.name !== "HEAD")
    .map((r) => (r.kind === "remote" ? r.name.slice(r.name.indexOf("/") + 1) : r.name))

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
    /* on ne grimpe pas au-dessus d'un tip : ce qui est plus haut appartient à une descendante
       (hover du tip de develop quand une feature est posée dessus, linéaire donc sans fork) */
    if (branchRefs(data[r]).length) break
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

/** Comme branchChain, mais borné au fork point ou à la première ref étrangère :
    sert au diff net d'une branche. */
export function branchSegment(S: LayoutState, data: Commit[], i: number) {
  const rows = [i]
  let r = i
  for (;;) {
    if (branchRefs(data[r]).length) break // on ne grimpe pas au-dessus d'un tip
    const kids = S.fpChildren.get(data[r].h)
    if (!kids || kids.length !== 1) break
    r = kids[0]
    rows.unshift(r)
  }
  /* les refs du haut du segment : sa distante en retard (`origin/x` posé plus bas) ne coupe pas */
  const own = new Set(branchRefs(data[rows[0]]))
  r = i
  for (;;) {
    const p = data[r].p[0]
    const pr = S.rowOf.get(p)
    if (pr === undefined) break
    if ((S.fpChildren.get(p) || []).length !== 1) break // le parent est un fork : tronc commun
    if (branchRefs(data[pr]).some((n) => !own.has(n))) break // le parent est le tip d'une autre branche
    rows.push(pr)
    r = pr
  }
  return rows
}

export function chainInfo(S: LayoutState, data: Commit[], rows: number[]) {
  const tip = data[rows[0]]
  /* toutes les branches du tip : une branche vide posée sur master partage ses commits */
  const ref = parseRefs(tip.r).filter((r) => r.kind !== "tag").map((r) => r.name).join(", ") || null
  const mrow = S.mergedBy.get(tip.h)
  if (mrow !== undefined) {
    const to = parseMerge(data[mrow].s)?.to
    return `${ref ? ref + " · " : ""}mergée${to ? " dans " + to : ""} (${data[mrow].h})`
  }
  return ref ? `${ref} · non mergée` : "segment non mergé"
}

/* --- Collapse release/hotfix ---
   Une release/hotfix gitflow atterrit en deux merges — un côté master, un côté develop. On les
   fusionne en une « capsule » : un commit synthétique multi-parents [develop-prev, master-prev,
   tip-release] que le métro dessine tel quel — le nœud enjambe les deux lanes. Le survivant garde
   le hash du merge develop (la ligne du haut) ; le merge master, retiré, laisse son hash dans
   `cap.absorbed`, que `layoutChunk` continue de résoudre — donc aucune arête ne pend, quelle que
   soit la distance entre les deux merges. */

const MASTER = /^(master|main)$/
const masterSide = (m: ParsedMerge) => !m.to || MASTER.test(m.to)

function semverTag(refs: string): string | null {
  return parseRefs(refs).find((r) => r.kind === "tag" && SEMVER.test(r.name))?.name ?? null
}

/* ponytail: appariement page par page — une paire à cheval sur deux pages de log reste en 2 lignes.
   Rare (les deux merges naissent à la seconde près d'un `git flow finish`), non régressif. */
export function collapsePairs(commits: Commit[]): Commit[] {
  const at = new Map(commits.map((c, i) => [c.h, i]))
  const drop = new Set<number>()
  const out: Commit[] = []
  for (let i = 0; i < commits.length; i++) {
    if (drop.has(i)) continue
    out.push(capsuleAt(commits, i, at, drop) ?? commits[i])
  }
  return out
}

function capsuleAt(commits: Commit[], i: number, at: Map<string, number>, drop: Set<number>): Commit | null {
  const d = commits[i]
  if (d.p.length < 2) return null
  const md = parseMerge(d.s)
  if (!md || md.to !== "develop" || !mergeFlow(md)) return null // la ligne survivante : le merge develop

  let mi: number | undefined
  if (md.tag) mi = at.get(d.p[1]) // pattern B : « merge tag » — le tag pointe le merge master
  else
    for (let j = i + 1; j < commits.length; j++) {
      // pattern A : deux merges de branche, jumeaux par le tip release (2e parent commun)
      const m = commits[j]
      if (drop.has(j) || m.p.length < 2) continue
      const mm = parseMerge(m.s)
      if (mm && masterSide(mm) && mm.from === md.from && m.p[1] === d.p[1]) mi = j
      if (mi !== undefined) break
    }
  if (mi === undefined || mi <= i || drop.has(mi)) return null // le merge master est plus vieux : en dessous

  const m = commits[mi]
  const mm = parseMerge(m.s)
  const flow = mm ? mergeFlow(mm) : null // le côté master (nom de branche) tranche release vs hotfix
  if (!mm || !masterSide(mm) || !flow) return null

  drop.add(mi)
  const p = [...new Set([d.p[0], m.p[0], m.p[1]])]
  const r = [d.r, m.r].filter(Boolean).join(", ")
  return {
    ...m,
    h: d.h,
    p,
    r,
    cap: { absorbed: m.h, version: semverTag(r) ?? (md.tag ? md.from : null), from: mm.from, flow, targets: [mm.to || "master", md.to] },
  }
}
