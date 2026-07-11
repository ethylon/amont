/* Assemblage du moteur de graphe (AUDIT.md §6) : ce module rejoue exactement le contrat de
   l'ancien `graph-canvas.ts` (mêmes `GraphHandle`/`GraphCallbacks`, même comportement visible) en
   composant les couches décomposées — layout/ (pur), data/ (pages + ingestion), render/ (DOM),
   interactions/ (sélection, survol, popover). React possède la coquille
   (react/commit-graph.tsx, inchangée) ; ce contrôleur ne fait qu'un : virtualisation à deux
   étages (chunks SVG + cache de pages LRU épinglé), layout en streaming append-only, theming
   100% var() CSS, flux « React possède la sélection ». À préserver tel quel (AUDIT.md §1). */

import type { Commit, RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { scrollTextHover, scrollTextStop } from "@/components/scroll-text"
import {
  CHUNK, FIXED_W, LANE, laneColor, MAX_LANES, PAD, PAGE, RESIDENT, ROW, ROW_BUCKET,
} from "./constants.ts"
import { idOf } from "./ids.ts"
import { branchSegment, chainInfo, chainTip, type ChainInfo } from "./layout/chains.ts"

export type { ChainInfo }
import { createLoader } from "./data/loader.ts"
import { createOverlay } from "./render/overlay.ts"
import { createMarkupCache } from "./render/svg.ts"
import { createMeasurer } from "./render/measure.ts"
import { rowBucket } from "./render/rows.ts"
import { createSelection } from "./interactions/selection.ts"
import { createHover, refChips, tipBranches } from "./interactions/hover.ts"
import { createPopover } from "./interactions/popover.ts"

export type Stats = { loaded: number; total: number; ms: number }

export type GraphCallbacks = {
  onSelect(row: number, additive: boolean): void
  onBranchSelect(row: number): void
  onStats(stats: Stats): void
  onGraphWidth(px: number): void
  onBranchWidth(px: number): void
  /** un `api.log` a échoué — remonté une fois par épisode de panne (cf. data/loader.ts), pas à
      chaque retry. Le graphe reste lisible et court simplement moins que le total tant que la
      panne dure : à l'appelant de décider de l'affichage (toast, pastille de statut…). */
  onError(message: string): void
}

export type GraphHandle = {
  reset(): Promise<void>
  jumpTo(hash: string): Promise<void>
  setSelection(rows: Iterable<number>): void
  /** `null` : plus de recherche en cours, les lignes reprennent leur teinte normale */
  setMatches(hashes: string[] | null): void
  /** ligne du prochain résultat après `from` dans le sens `dir`, `null` s'il n'y en a plus */
  nextMatch(from: number, dir: 1 | -1): Promise<number | null>
  /** lignes des commits donnés, chargées à la demande ; les hash introuvables sont omis */
  rowsOf(hashes: string[]): Promise<number[]>
  /** ramène en résidence les pages de commits couvrant ces lignes — à appeler avant de poser
      une sélection étendue, dont le détail lira `commit(row)` en synchrone */
  pin(rows: number[]): Promise<void>
  /** commit d'une ligne, `undefined` si sa page de cache a été évincée (cf. `pin`) */
  commit(row: number): Commit | undefined
  branchSegment(row: number): number[]
  chainInfo(rows: number[]): ChainInfo
  /** branches de la ligne : ses refs propres, sinon celles du tip de sa chaîne, sinon la
      branche absorbée par son merge ; ordonnées HEAD, locales, distantes — vide faute de nom */
  branchesOf(row: number): { name: string; kind: "head" | "remote" }[]
  /** teinte du trait de la ligne, à poser en `--badge-color` sur les chips de branche */
  laneColor(row: number): string
  /** position et teinte du point d'arbre de travail, aligné sur la lane de HEAD */
  headDot(headSha: string | null): { left: number; color: string } | null
  destroy(): void
}

const SVG_NS = "http://www.w3.org/2000/svg"

export function createGraph(
  board: HTMLDivElement,
  inner: HTMLDivElement,
  svg: SVGSVGElement,
  api: RepoApi,
  cb: GraphCallbacks
): GraphHandle {
  const measurer = createMeasurer(inner)
  const markup = createMarkupCache()
  const overlay = createOverlay()
  svg.append(overlay.root)

  const selectionCtl = createSelection(inner)
  const hoverCtl = createHover(inner)
  const popoverCtl = createPopover(board, inner, (row) => loader.commitAt(row))

  const loader = createLoader({
    api,
    pageSize: PAGE,
    resident: RESIDENT,
    onPageLoaded: (commits) => {
      measurer.scanPage(commits)
      evictNow()
    },
    onError: (err) => cb.onError(describeError(err)),
  })

  let destroyed = false // un reset en vol pendant destroy() (double montage StrictMode) ne doit plus toucher le DOM
  const mountedG = new Map<number, SVGGElement>()
  const mountedRows = new Map<number, HTMLDivElement>()
  let statsScheduled = false

  function evictNow() {
    const [c0, c1] = viewChunks()
    const last = Math.min(loader.state.next - 1, (c1 + 1) * CHUNK - 1)
    loader.evict(loader.state.next > 0 ? [c0 * CHUNK, last] : null, selectionCtl.selection)
  }

  const viewChunks = (): [number, number] => {
    const nchunks = Math.max(1, Math.ceil(loader.total / CHUNK))
    return [
      Math.max(0, Math.floor(board.scrollTop / (CHUNK * ROW)) - 1),
      Math.min(nchunks - 1, Math.floor((board.scrollTop + board.clientHeight) / (CHUNK * ROW)) + 1),
    ]
  }

  /* Fenêtre des lignes HTML : ~2 hauteurs de viewport, découplée de CHUNK (AUDIT.md §6, item
     perf) — le bucket SVG reste CHUNK, coûteux à monter mais bon marché à construire ; les
     lignes HTML (chips, avatars, texte défilant) sont l'inverse, elles se montent donc sur une
     fenêtre bien plus étroite que 3 chunks entiers. */
  const viewRows = (): [number, number] => {
    const margin = board.clientHeight
    return [
      Math.max(0, Math.floor((board.scrollTop - margin / 2) / ROW)),
      Math.min(loader.state.next - 1, Math.ceil((board.scrollTop + board.clientHeight + margin / 2) / ROW)),
    ]
  }

  function emitStats() {
    if (statsScheduled) return
    statsScheduled = true
    requestAnimationFrame(() => {
      statsScheduled = false
      cb.onStats({ loaded: loader.state.next, total: loader.total, ms: loader.state.ms })
    })
  }

  function refresh() {
    const S = loader.state
    const graphW = PAD * 2 + Math.min(S.lanes.length, MAX_LANES) * LANE
    const h = S.next * ROW
    svg.setAttribute("width", String(graphW))
    svg.setAttribute("height", String(h))
    svg.setAttribute("viewBox", `0 0 ${graphW} ${h}`)
    inner.style.height = h + "px"
    const { type, branch } = measurer.measureCols()
    inner.style.minWidth = graphW + FIXED_W + type + branch + "px"
    cb.onGraphWidth(graphW)
    cb.onBranchWidth(branch)
    emitStats()
  }

  function sync() {
    if (destroyed) return // l'overlay n'est plus dans le SVG : insertBefore échouerait
    const S = loader.state
    const [c0, c1] = viewChunks()
    const need = (c1 + 1) * CHUNK
    /* on ne rechaîne sync() que si des données sont arrivées : en cas d'échec, pas de boucle
       de retentative — le prochain scroll suffira à relancer */
    if (need > S.next && !loader.exhausted) {
      const token = loader.token
      const before = S.next
      loader.fetchMore().then(() => {
        if (token === loader.token && (loader.state.next > before || loader.exhausted)) sync()
      })
    }
    mountedG.forEach((g, ci) => {
      if (ci < c0 || ci > c1) {
        g.remove()
        mountedG.delete(ci)
      }
    })
    for (let ci = c0; ci <= c1 && ci * CHUNK < S.next; ci++) {
      if (mountedG.has(ci)) continue
      const g = document.createElementNS(SVG_NS, "g")
      g.innerHTML = markup.chunkMarkup(ci, S)
      svg.insertBefore(g, overlay.root)
      mountedG.set(ci, g)
    }

    /* Lignes HTML : fenêtre plus étroite (viewRows), bucketée à ROW_BUCKET — la géométrie SVG
       reste montrable dès que le layout l'a posée, les lignes HTML exigent leurs commits : un
       trou de cache se recharge puis re-sync, le métro reste visible en attendant les textes. */
    const [r0, r1] = viewRows()
    const b0 = Math.floor(r0 / ROW_BUCKET)
    const b1 = Math.floor(r1 / ROW_BUCKET)
    mountedRows.forEach((d, bi) => {
      if (bi < b0 || bi > b1) {
        d.remove()
        mountedRows.delete(bi)
      }
    })
    let missing: [number, number] | null = null
    for (let bi = b0; bi <= b1 && bi * ROW_BUCKET < S.next; bi++) {
      if (mountedRows.has(bi)) continue
      const start = bi * ROW_BUCKET
      const end = Math.min((bi + 1) * ROW_BUCKET, S.next)
      if (loader.isResident(start, end - 1)) {
        const d = rowBucket(S, start, end, loader.commitAt, selectionCtl.selection, selectionCtl.matches)
        inner.appendChild(d)
        mountedRows.set(bi, d)
      } else missing = missing ? [missing[0], end - 1] : [start, end - 1]
    }
    if (missing) {
      const token = loader.token
      loader.ensureRows(missing[0], missing[1]).then((ok) => {
        evictNow()
        if (ok && token === loader.token) sync()
      })
    }

    overlay.sync(S, [c0 * CHUNK, Math.min(S.next - 1, (c1 + 1) * CHUNK - 1)], S.next * ROW)
  }

  function remount() {
    scrollTextStop() // les lignes partent sans mouseleave : la boucle rAF s'arrête avec elles
    mountedG.forEach((g) => g.remove())
    mountedG.clear()
    mountedRows.forEach((d) => d.remove())
    mountedRows.clear()
    sync()
  }

  /* amène une ligne déjà mise en page au centre de l'écran, la sélectionne et la fait clignoter ;
     attend le retour de sa page si elle a été évincée — la sélection lira le commit en synchrone */
  async function reveal(row: number, token: number) {
    refresh()
    board.scrollTop = row * ROW - board.clientHeight / 2
    const bi = Math.floor(row / ROW_BUCKET)
    await loader.ensureRows(bi * ROW_BUCKET, Math.min((bi + 1) * ROW_BUCKET, loader.state.next) - 1)
    evictNow()
    if (token !== loader.token || destroyed) return
    sync()
    cb.onSelect(row, false)
    const el = inner.querySelector<HTMLElement>(`.gg-row[data-i="${row}"]`)
    if (el) {
      el.classList.remove("gg-flash")
      void el.offsetWidth
      el.classList.add("gg-flash")
    }
  }

  function resolveRow(hash: string): number | undefined {
    const id = idOf(loader.state.ids, hash)
    return id !== undefined ? loader.state.rowOf.get(id) : undefined
  }

  /* chunk paresseux (cf. layout/state.ts) : `nodes[ci]` peut ne pas exister encore — `?.` évite
     le crash si le dépôt grandit entre l'estimation de `total()` et la pagination réelle
     (AUDIT.md §6, item perf). */
  const nodeAt = (row: number) => loader.state.nodes[Math.floor(row / CHUNK)]?.[row % CHUNK]

  const rowIndex = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".gg-row")
    return el ? Number(el.dataset.i) : null
  }

  const onScroll = () => {
    popoverCtl.closeMore()
    scrollTextStop()
    hoverCtl.clearHover() // le scroll démonte la ligne survolée : le chip fantôme part avec elle
    sync()
  }
  const onMouseOver = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    scrollTextHover(t.closest<HTMLElement>(".gg-scrolltext"))
    const btn = t.closest<HTMLElement>(".gg-more-btn")
    if (btn) {
      popoverCtl.cancelClose()
      if (btn !== popoverCtl.openBtn) popoverCtl.openMore(btn)
    } else if (t.closest(".gg-more")) popoverCtl.cancelClose() // sur le panneau : on le garde ouvert
    const i = rowIndex(ev)
    if (i !== null) hoverCtl.hoverRow(loader.state, i, !!nodeAt(i)?.stash)
  }
  /* Quitter le bouton ou le panneau vers l'extérieur arme la fermeture ; y revenir l'annule. */
  const onMouseOut = (ev: MouseEvent) => {
    if (!popoverCtl.openBtn) return
    const from = (ev.target as HTMLElement).closest(".gg-more-btn, .gg-more")
    if (!from) return
    const to = ev.relatedTarget as HTMLElement | null
    if (!to || !to.closest(".gg-more-btn, .gg-more")) popoverCtl.scheduleClose()
  }
  const onMouseLeave = () => {
    hoverCtl.clearHover()
    scrollTextStop()
    popoverCtl.closeMore()
  }
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") popoverCtl.closeMore()
  }
  const onClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t.closest(".gg-more, .gg-more-btn")) return // le panneau s'ouvre au survol : le clic ne sélectionne pas
    popoverCtl.closeMore()
    const i = rowIndex(ev)
    if (i !== null) cb.onSelect(i, ev.ctrlKey || ev.metaKey)
  }
  const onDblClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t.closest(".gg-more, .gg-more-btn")) return
    const i = rowIndex(ev)
    if (i !== null) cb.onBranchSelect(i)
  }

  /* pas de throttle : sync() est un no-op quand la plage de chunks/buckets visibles n'a pas changé */
  board.addEventListener("scroll", onScroll, { passive: true })
  board.addEventListener("mouseleave", onMouseLeave)
  inner.addEventListener("mouseover", onMouseOver)
  inner.addEventListener("mouseout", onMouseOut)
  inner.addEventListener("click", onClick)
  inner.addEventListener("dblclick", onDblClick)
  document.addEventListener("keydown", onKeyDown)

  /* Pas de ResizeObserver avant ce refactor : `sync()` ne tournait que sur scroll/fetch, la
     correction tenait au mou de 14 000 px des chunks (AUDIT.md §6, item perf) — la fenêtre de
     lignes plus étroite (viewRows) rend la recalibration au resize nécessaire. */
  const resizeObserver = new ResizeObserver(() => sync())
  resizeObserver.observe(board)

  let stashNames: string[] = []
  /* Les chips sont mesurés à la police réelle. Tant que Geist n'a pas remplacé le fallback,
     les largeurs sont fausses : une seule reprise, depuis les sources persistées, suffit. */
  document.fonts.ready.then(() => {
    if (!svg.isConnected || destroyed) return
    measurer.requeueAll(stashNames)
    refresh()
  })

  return {
    async reset() {
      const { stashes } = await loader.reset()
      if (destroyed) return
      const token = loader.token
      stashNames = stashes.map((s) => s.name)
      measurer.queueStashNames(stashNames)
      selectionCtl.setSelection([])
      remount()
      board.scrollTop = 0
      hoverCtl.clearHover()
      popoverCtl.closeMore()
      await loader.fetchMore()
      if (token !== loader.token || destroyed) return
      evictNow()
      refresh()
      sync()
    },

    async jumpTo(hash) {
      const token = loader.token
      if (resolveRow(hash) === undefined) await loader.growUntil(() => resolveRow(hash) !== undefined, token)
      const row = resolveRow(hash)
      if (row === undefined || token !== loader.token) return
      await reveal(row, token)
    },

    async rowsOf(hashes) {
      const token = loader.token
      const allKnown = () => hashes.every((h) => resolveRow(h) !== undefined)
      if (!allKnown()) await loader.growUntil(allKnown, token)
      const rows: number[] = []
      for (const h of hashes) {
        const r = resolveRow(h)
        if (r !== undefined) rows.push(r)
      }
      return rows
    },

    async pin(rows) {
      if (!rows.length) return
      await loader.ensureRows(Math.min(...rows), Math.max(...rows))
      evictNow()
    },

    setSelection(rows) {
      selectionCtl.setSelection(rows)
      evictNow()
    },

    setMatches(hashes) {
      const ids = hashes && hashes.map((h) => idOf(loader.state.ids, h)).filter((id): id is number => id !== undefined)
      selectionCtl.setMatches(ids, loader.state.hashOf)
    },

    /* balaye les lignes — l'ordre du graphe — en chargeant à la demande : le résultat suivant
       peut vivre plusieurs pages plus bas. */
    async nextMatch(from, dir) {
      if (!selectionCtl.matches?.size) return null
      const token = loader.token
      for (let i = from + dir; i >= 0; i += dir) {
        if (i >= loader.state.next && !loader.exhausted) {
          await loader.growUntil(() => i < loader.state.next, token)
        }
        if (token !== loader.token || i >= loader.state.next) return null
        if (!selectionCtl.matches.has(loader.state.hashOf[i])) continue
        await reveal(i, token)
        return i
      }
      return null
    },

    commit: (row) => loader.commitAt(row),
    branchSegment: (row) => branchSegment(loader.state, row),
    chainInfo: (rows) => chainInfo(loader.state, rows),
    branchesOf: (row) => {
      if (nodeAt(row)?.stash) return [] // un stash ne focalise aucune branche du sidebar
      const own = refChips(loader.state, row)
      return own.length ? own : tipBranches(loader.state, chainTip(loader.state, row))
    },
    laneColor: (row) => laneColor(loader.state.laneOf[row]),

    headDot(headSha) {
      const S = loader.state
      const id = headSha === null ? undefined : idOf(S.ids, headSha)
      const row = id === undefined ? undefined : S.rowOf.get(id)
      const lane = row === undefined ? undefined : S.laneOf[row]
      return lane === undefined ? null : { left: PAD + lane * LANE + LANE / 2, color: laneColor(lane) }
    },

    destroy() {
      destroyed = true
      loader.destroy()
      scrollTextStop() // même raison qu'à remount : le texte survolé part sans mouseleave
      resizeObserver.disconnect()
      board.removeEventListener("scroll", onScroll)
      board.removeEventListener("mouseleave", onMouseLeave)
      inner.removeEventListener("mouseover", onMouseOver)
      inner.removeEventListener("mouseout", onMouseOut)
      inner.removeEventListener("click", onClick)
      inner.removeEventListener("dblclick", onDblClick)
      document.removeEventListener("keydown", onKeyDown)
      mountedG.forEach((g) => g.remove())
      mountedRows.forEach((d) => d.remove())
      popoverCtl.destroy()
      overlay.root.remove()
    },
  }
}
