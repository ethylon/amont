import { api, type Commit, type LogMode } from "@/lib/git"
import { badgeVariants } from "@/components/ui/badge"
import { MAIN_TARGETS, parseMerge, parseSubject, typeColor, type BadgeColor } from "@/lib/commit-message"
import {
  branchChain, branchSegment, chainInfo, createState, edgePath, edgesSvg, laneColor,
  layoutChunk, nodesSvg, stroke, CHUNK, PAGE, ROW, PAD, LANE, X,
  type LayoutState,
} from "@/lib/graph-layout"

/* Rendu impératif, délibérément : virtualisation par chunks de 500 lignes, montage et
   démontage direct des <g> SVG. React ne gagnerait rien à repasser par un VDOM ici, et
   perdrait le contrôle fin du scroll. React possède la coquille, pas ce canvas. */

const SVG_NS = "http://www.w3.org/2000/svg"

const ROW_CLASS =
  "gg-row grid h-7 cursor-pointer grid-cols-[64px_1fr_120px_74px_68px] items-center gap-2.5 " +
  "border-l-2 border-l-transparent pr-4.5 text-xs hover:bg-muted/60 " +
  "data-selected:border-l-primary data-selected:bg-primary/10"

const chip = (color: BadgeColor) => badgeVariants({ color, shape: "squared" })

export type Stats = { loaded: number; total: number; lanes: number; dangling: number; ms: number }

export type GraphCallbacks = {
  onSelect(row: number, additive: boolean): void
  onBranchSelect(row: number): void
  onHover(info: string | null): void
  onStats(stats: Stats): void
  onGraphWidth(px: number): void
}

export type GraphHandle = {
  reset(mode: LogMode): Promise<void>
  loadAll(): Promise<void>
  jumpTo(hash: string): Promise<void>
  setSelection(rows: Iterable<number>): void
  commit(row: number): Commit | undefined
  branchSegment(row: number): number[]
  chainInfo(rows: number[]): string
  /** position et teinte du point d'arbre de travail, aligné sur la lane de HEAD */
  headDot(headSha: string | null): { left: number; color: string } | null
  destroy(): void
}

export function createGraph(
  board: HTMLDivElement,
  inner: HTMLDivElement,
  svg: SVGSVGElement,
  cb: GraphCallbacks
): GraphHandle {
  let DATA: Commit[] = []
  let TOTAL = 0
  let NCHUNKS = 0
  let exhausted = false
  let fetching: Promise<void> | null = null
  let mode: LogMode = "all"
  let gen = 0 // invalide les fetchs en vol après un reset
  let S: LayoutState = createState(1)
  let selection = new Set<number>()
  let hoverChain: Set<number> | null = null

  const overlay = document.createElementNS(SVG_NS, "g") // long + dangling, toujours monté
  const hlG = document.createElementNS(SVG_NS, "g")
  hlG.setAttribute("class", "gg-hl")
  svg.append(overlay, hlG)

  const mountedG = new Map<number, SVGGElement>()
  const mountedRows = new Map<number, HTMLDivElement>()

  function chunkG(ci: number) {
    const g = document.createElementNS(SVG_NS, "g")
    g.innerHTML = edgesSvg(S.edges[ci]) + nodesSvg(S.nodes[ci])
    return g
  }

  function refChips(raw: string, parent: HTMLElement) {
    raw
      .split(", ")
      .filter(Boolean)
      .forEach((ref) => {
        let color: BadgeColor = "neutral"
        if (ref.startsWith("HEAD")) {
          color = "primary"
          ref = ref.replace("HEAD -> ", "")
        } else if (ref.startsWith("tag: ")) {
          color = "warning"
          ref = ref.slice(5)
        }
        const el = document.createElement("span")
        el.className = chip(color) + " max-w-42"
        el.title = ref
        const text = document.createElement("span")
        text.className = "truncate"
        text.textContent = ref
        el.appendChild(text)
        parent.appendChild(el)
      })
  }

  function rowDiv(i: number) {
    const c = DATA[i]
    const row = document.createElement("div")
    row.className = ROW_CLASS
    row.dataset.i = String(i)
    row.dataset.selected = String(selection.has(i))

    const ps = parseSubject(c.s)
    const badge = document.createElement("div")
    badge.className = "flex min-w-0"
    if (ps.label) {
      const b = document.createElement("span")
      b.className = chip(typeColor(ps.type!)) + " max-w-16 font-semibold"
      b.textContent = ps.label
      badge.appendChild(b)
    }
    row.appendChild(badge)

    const subj = document.createElement("div")
    subj.className = "flex min-w-0 items-center gap-1.5 truncate"
    if (c.r) refChips(c.r, subj)

    const mg = c.p.length > 1 ? parseMerge(c.s) : null
    if (mg) {
      if (mg.noise) row.classList.add("opacity-45")
      subj.title = c.s
      const from = document.createElement("span")
      from.className =
        chip(mg.tag ? "warning" : !mg.noise && mg.to && MAIN_TARGETS.test(mg.to) ? "primary" : "neutral") + " max-w-42"
      from.textContent = mg.from
      from.title = mg.from
      const arrow = document.createElement("span")
      arrow.className = "shrink-0 text-muted-foreground"
      arrow.textContent = "→"
      const to = document.createElement("span")
      to.className = chip("neutral") + " max-w-42"
      to.textContent = mg.to || "HEAD"
      to.title = mg.to || ""
      subj.append(from, arrow, to)
    } else {
      const s = document.createElement("span")
      s.className = "truncate"
      s.textContent = ps.text
      s.title = c.s
      subj.appendChild(s)
    }
    row.appendChild(subj)

    for (const [cls, val] of [
      ["truncate text-muted-foreground", c.a],
      ["font-mono text-muted-foreground tabular-nums", c.d],
      ["font-mono text-muted-foreground tabular-nums", c.h],
    ] as const) {
      const el = document.createElement("span")
      el.className = cls
      el.textContent = val
      row.appendChild(el)
    }
    return row
  }

  function chunkRows(ci: number) {
    const div = document.createElement("div")
    div.className = "absolute inset-x-0"
    div.style.top = ci * CHUNK * ROW + "px"
    const end = Math.min((ci + 1) * CHUNK, S.next)
    for (let i = ci * CHUNK; i < end; i++) div.appendChild(rowDiv(i))
    return div
  }

  function refresh() {
    const graphW = PAD * 2 + S.lanes.length * LANE
    const h = S.next * ROW
    svg.setAttribute("width", String(graphW))
    svg.setAttribute("height", String(h))
    svg.setAttribute("viewBox", `0 0 ${graphW} ${h}`)
    inner.style.height = h + "px"
    inner.style.minWidth = graphW + 706 + "px" // graphe + place pour les colonnes texte
    cb.onGraphWidth(graphW)

    let dangling = ""
    S.pending.forEach((list) =>
      list.forEach((e) => {
        dangling += `<path d="${edgePath(e, h)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6" stroke-dasharray="2 4" opacity="0.45"/>`
      })
    )
    overlay.innerHTML = edgesSvg(S.long) + dangling
    cb.onStats({
      loaded: S.next,
      total: TOTAL,
      lanes: S.lanes.length,
      dangling: [...S.pending.values()].reduce((n, l) => n + l.length, 0),
      ms: S.ms,
    })
  }

  async function fetchMore() {
    if (exhausted) return
    if (!fetching) {
      const g = gen
      fetching = api.log(DATA.length, PAGE, mode).then((page) => {
        if (g !== gen) return // reset entre-temps : page obsolète
        DATA.push(...page)
        if (page.length < PAGE || DATA.length >= TOTAL) exhausted = true
        fetching = null
      })
    }
    return fetching
  }

  function sync() {
    const c0 = Math.max(0, Math.floor(board.scrollTop / (CHUNK * ROW)) - 1)
    const c1 = Math.min(NCHUNKS - 1, Math.floor((board.scrollTop + board.clientHeight) / (CHUNK * ROW)) + 1)
    const need = (c1 + 1) * CHUNK
    if (S.next < Math.min(need, DATA.length)) {
      while (S.next < Math.min(need, DATA.length)) layoutChunk(S, DATA)
      refresh()
    }
    if (need > DATA.length && !exhausted) fetchMore()!.then(sync)
    mountedG.forEach((g, ci) => {
      if (ci < c0 || ci > c1) {
        g.remove()
        mountedG.delete(ci)
      }
    })
    mountedRows.forEach((d, ci) => {
      if (ci < c0 || ci > c1) {
        d.remove()
        mountedRows.delete(ci)
      }
    })
    for (let ci = c0; ci <= c1 && ci * CHUNK < S.next; ci++) {
      if (!mountedG.has(ci)) {
        const g = chunkG(ci)
        svg.insertBefore(g, overlay)
        mountedG.set(ci, g)
      }
      if (!mountedRows.has(ci)) {
        const d = chunkRows(ci)
        inner.appendChild(d)
        mountedRows.set(ci, d)
      }
    }
  }

  function remount() {
    mountedG.forEach((g) => g.remove())
    mountedG.clear()
    mountedRows.forEach((d) => d.remove())
    mountedRows.clear()
    sync()
  }

  function applySelection() {
    inner.querySelectorAll<HTMLElement>(".gg-row").forEach((r) => {
      r.dataset.selected = String(selection.has(Number(r.dataset.i)))
    })
  }

  function clearHover() {
    hoverChain = null
    hlG.innerHTML = ""
    svg.classList.remove("dim")
    cb.onHover(null)
  }

  function hoverRow(i: number) {
    if (hoverChain?.has(i)) return
    const rows = branchChain(S, DATA, i)
    hoverChain = new Set(rows)
    let sv = ""
    const nodes = rows.map((r) => {
      const e = S.fpEdge[r]
      if (e && e.r2 !== undefined)
        sv += `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="2.6"/>`
      return { row: r, lane: S.laneOf[r], merge: DATA[r].p.length > 1 }
    })
    hlG.innerHTML = sv + nodesSvg(nodes)
    svg.classList.add("dim")
    cb.onHover(chainInfo(S, DATA, rows))
  }

  const rowIndex = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".gg-row")
    return el ? Number(el.dataset.i) : null
  }

  const onScroll = () => sync()
  const onMouseOver = (ev: MouseEvent) => {
    const i = rowIndex(ev)
    if (i !== null) hoverRow(i)
  }
  const onMouseLeave = () => clearHover()
  const onClick = (ev: MouseEvent) => {
    const i = rowIndex(ev)
    if (i !== null) cb.onSelect(i, ev.ctrlKey || ev.metaKey)
  }
  const onDblClick = (ev: MouseEvent) => {
    const i = rowIndex(ev)
    if (i !== null) cb.onBranchSelect(i)
  }

  /* pas de throttle : sync() est un no-op quand la plage de chunks visibles n'a pas changé */
  board.addEventListener("scroll", onScroll, { passive: true })
  board.addEventListener("mouseleave", onMouseLeave)
  inner.addEventListener("mouseover", onMouseOver)
  inner.addEventListener("click", onClick)
  inner.addEventListener("dblclick", onDblClick)

  return {
    async reset(nextMode: LogMode) {
      gen++
      mode = nextMode
      DATA = []
      fetching = null
      TOTAL = await api.total(mode)
      exhausted = TOTAL === 0
      NCHUNKS = Math.max(1, Math.ceil(TOTAL / CHUNK))
      S = createState(NCHUNKS)
      selection = new Set()
      remount()
      board.scrollTop = 0
      clearHover()
      await fetchMore()
      layoutChunk(S, DATA)
      refresh()
      sync()
    },

    async loadAll() {
      while (!exhausted) await fetchMore()
      while (S.next < DATA.length) layoutChunk(S, DATA)
      refresh()
      remount()
    },

    async jumpTo(hash: string) {
      while (!S.rowOf.has(hash) && (S.next < DATA.length || !exhausted)) {
        if (S.next < DATA.length) layoutChunk(S, DATA)
        else await fetchMore()
      }
      const row = S.rowOf.get(hash)
      if (row === undefined) return
      refresh()
      board.scrollTop = row * ROW - board.clientHeight / 2
      sync()
      cb.onSelect(row, false)
      const el = inner.querySelector<HTMLElement>(`.gg-row[data-i="${row}"]`)
      if (el) {
        el.classList.remove("gg-flash")
        void el.offsetWidth
        el.classList.add("gg-flash")
      }
    },

    setSelection(rows) {
      selection = new Set(rows)
      applySelection()
    },

    commit: (row) => DATA[row],
    branchSegment: (row) => branchSegment(S, DATA, row),
    chainInfo: (rows) => chainInfo(S, DATA, rows),

    headDot(headSha) {
      const row = headSha === null ? undefined : S.rowOf.get(headSha)
      const lane = row === undefined ? undefined : S.laneOf[row]
      return lane === undefined ? null : { left: X(lane), color: laneColor(lane) }
    },

    destroy() {
      gen++
      board.removeEventListener("scroll", onScroll)
      board.removeEventListener("mouseleave", onMouseLeave)
      inner.removeEventListener("mouseover", onMouseOver)
      inner.removeEventListener("click", onClick)
      inner.removeEventListener("dblclick", onDblClick)
      mountedG.forEach((g) => g.remove())
      mountedRows.forEach((d) => d.remove())
      overlay.remove()
      hlG.remove()
    },
  }
}
