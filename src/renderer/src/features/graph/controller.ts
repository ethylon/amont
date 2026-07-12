/* Graph engine assembly (AUDIT.md §6): this module replays exactly the contract of
   the former `graph-canvas.ts` (same `GraphHandle`/`GraphCallbacks`, same visible behavior) by
   composing the decomposed layers — layout/ (pure), data/ (pages + ingestion), render/ (DOM),
   interactions/ (selection, hover, popover). React owns the shell
   (react/commit-graph.tsx, unchanged); this controller is a single piece: two-stage
   virtualization (SVG chunks + pinned LRU page cache), append-only streaming layout, 100% CSS
   var() theming, "React owns the selection" flow. Preserve as-is (AUDIT.md §1). */

import type { Commit, RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { scrollTextHover, scrollTextStop } from "./interactions/scroll-text.ts"
import { CHUNK, FIXED_W, LANE, laneColor, MAX_LANES, PAD, PAGE, RESIDENT, ROW, ROW_BUCKET } from "./constants.ts"
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
  /** an `api.log` call failed — surfaced once per failure episode (cf. data/loader.ts), not on
      every retry. The graph stays readable and simply shows fewer rows than the total while the
      failure lasts: it's up to the caller to decide the display (toast, status badge…). */
  onError(message: string): void
}

export type GraphHandle = {
  reset(): Promise<void>
  jumpTo(hash: string): Promise<void>
  /** `active`: row that just acted (click, ctrl-click…) — carries the keyboard cursor (roving
      tabindex, AUDIT.md §8). If omitted, the cursor doesn't move (cf. interactions/selection.ts). */
  setSelection(rows: Iterable<number>, active?: number): void
  /** `null`: no more search in progress, rows go back to their normal hue */
  setMatches(hashes: string[] | null): void
  /** row of the next result after `from` in direction `dir`, `null` if there are no more */
  nextMatch(from: number, dir: 1 | -1): Promise<number | null>
  /** rows of the given commits, loaded on demand; hashes not found are omitted */
  rowsOf(hashes: string[]): Promise<number[]>
  /** brings back into residence the commit pages covering these rows — call before setting
      an extended selection, whose detail view will read `commit(row)` synchronously */
  pin(rows: number[]): Promise<void>
  /** commit of a row, `undefined` if its cache page was evicted (cf. `pin`) */
  commit(row: number): Commit | undefined
  branchSegment(row: number): number[]
  chainInfo(rows: number[]): ChainInfo
  /** branches of the row: its own refs, otherwise those of its chain's tip, otherwise the
      branch absorbed by its merge; ordered HEAD, local, remote — empty if no name */
  branchesOf(row: number): { name: string; kind: "head" | "remote" }[]
  /** hue of the row's line, to set as `--badge-color` on branch chips */
  laneColor(row: number): string
  /** position and hue of the working-tree dot, aligned on HEAD's lane */
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

  let destroyed = false // an in-flight reset during destroy() (StrictMode double-mount) must no longer touch the DOM
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

  /* HTML row window: ~2 viewport heights, decoupled from CHUNK (AUDIT.md §6, perf item)
     — the SVG bucket stays CHUNK, expensive to mount but cheap to build; HTML
     rows (chips, avatars, scrolling text) are the opposite, so they mount over a
     window much narrower than 3 whole chunks. */
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
    if (destroyed) return // the overlay is no longer in the SVG: insertBefore would fail
    const S = loader.state
    const [c0, c1] = viewChunks()
    const need = (c1 + 1) * CHUNK
    /* sync() is only rechained if data actually arrived: on failure, no retry
       loop — the next scroll will be enough to relaunch it */
    if (need > S.next && !loader.exhausted) {
      const token = loader.token
      const before = S.next
      void loader.fetchMore().then(() => {
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

    /* HTML rows: narrower window (viewRows), bucketed at ROW_BUCKET — SVG geometry
       stays displayable as soon as layout has placed it, HTML rows need their commits: a
       cache miss reloads then re-syncs, the metro stays visible while waiting for the texts. */
    const [r0, r1] = viewRows()
    const b0 = Math.floor(r0 / ROW_BUCKET)
    const b1 = Math.floor(r1 / ROW_BUCKET)
    /* Keyboard cursor bucket (roving tabindex, AUDIT.md §8): kept mounted even outside the window —
       otherwise a mouse scroll far from the active row would make its `tabindex=0` disappear from
       the DOM and Tab would fail to catch back up to the graph until the keyboard first moved the selection. */
    const activeBucket = selectionCtl.active !== null ? Math.floor(selectionCtl.active / ROW_BUCKET) : null
    mountedRows.forEach((d, bi) => {
      if ((bi < b0 || bi > b1) && bi !== activeBucket) {
        d.remove()
        mountedRows.delete(bi)
      }
    })
    const buckets = activeBucket !== null && (activeBucket < b0 || activeBucket > b1) ? [activeBucket, b0] : [b0]
    let missing: [number, number] | null = null
    for (const from of buckets) {
      const to = from === b0 ? b1 : from
      for (let bi = from; bi <= to && bi * ROW_BUCKET < S.next; bi++) {
        if (mountedRows.has(bi)) continue
        const start = bi * ROW_BUCKET
        const end = Math.min((bi + 1) * ROW_BUCKET, S.next)
        if (loader.isResident(start, end - 1)) {
          const d = rowBucket(
            S,
            start,
            end,
            loader.commitAt,
            selectionCtl.selection,
            selectionCtl.matches,
            selectionCtl.active,
            loader.total
          )
          inner.appendChild(d)
          mountedRows.set(bi, d)
        } else missing = missing ? [Math.min(missing[0], start), Math.max(missing[1], end - 1)] : [start, end - 1]
      }
    }
    if (missing) {
      const token = loader.token
      void loader.ensureRows(missing[0], missing[1]).then((ok) => {
        evictNow()
        if (ok && token === loader.token) sync()
      })
    }

    overlay.sync(S, [c0 * CHUNK, Math.min(S.next - 1, (c1 + 1) * CHUNK - 1)], S.next * ROW)
  }

  function remount() {
    scrollTextStop() // rows leave without a mouseleave: the rAF loop stops along with them
    mountedG.forEach((g) => g.remove())
    mountedG.clear()
    mountedRows.forEach((d) => d.remove())
    mountedRows.clear()
    sync()
  }

  /* brings an already-laid-out row to the center of the screen, selects it and makes it flash;
     waits for its page to come back if it was evicted — the selection will read the commit synchronously */
  async function reveal(row: number, token: number) {
    refresh()
    board.scrollTop = row * ROW - board.clientHeight / 2
    const bi = Math.floor(row / ROW_BUCKET)
    await loader.ensureRows(bi * ROW_BUCKET, Math.min((bi + 1) * ROW_BUCKET, loader.state.next) - 1)
    evictNow()
    if (token !== loader.token || destroyed) return
    sync()
    cb.onSelect(row, false)
    const el = inner.querySelector<HTMLElement>(`.amont-row[data-i="${row}"]`)
    if (el) {
      el.classList.remove("amont-flash")
      void el.offsetWidth
      el.classList.add("amont-flash")
    }
  }

  /* Number of rows in one screen page (PageUp/PageDown, AUDIT.md §8). */
  const pageRows = () => Math.max(1, Math.floor(board.clientHeight / ROW))

  /* Keyboard cursor movement (ARIA grid, AUDIT.md §8): unlike `reveal` (a long-distance
     jump — jumpTo/nextMatch — which centers the screen and flashes), an arrow key should only
     move the scroll as much as necessary (`scrollIntoView({ block: "nearest" })`, like a native
     listbox). The target row is laid out through virtualization exactly like `reveal`
     (page then bucket guaranteed before selecting): unmounted rows get mounted along the
     way. `additive` reproduces Shift/Ctrl like ctrl-click (cf. `onClick`). */
  async function moveActive(target: number, additive: boolean) {
    const token = loader.token
    target = Math.max(0, target)
    if (target >= loader.state.next && !loader.exhausted) {
      await loader.growUntil(() => target < loader.state.next || loader.exhausted, token)
    }
    if (token !== loader.token || destroyed) return
    target = Math.min(target, Math.max(0, loader.state.next - 1))
    const bi = Math.floor(target / ROW_BUCKET)
    await loader.ensureRows(bi * ROW_BUCKET, Math.min((bi + 1) * ROW_BUCKET, loader.state.next) - 1)
    evictNow()
    if (token !== loader.token || destroyed) return
    sync()
    cb.onSelect(target, additive)
    const el = inner.querySelector<HTMLElement>(`.amont-row[data-i="${target}"]`)
    el?.scrollIntoView({ block: "nearest" })
    el?.focus({ preventScroll: true }) // the scroll was already done just above, no need for focus() to redo it its own way
  }

  function resolveRow(hash: string): number | undefined {
    const id = idOf(loader.state.ids, hash)
    return id !== undefined ? loader.state.rowOf.get(id) : undefined
  }

  /* lazy chunk (cf. layout/state.ts): `nodes[ci]` may not exist yet — `?.` avoids
     a crash if the repo grows between the `total()` estimate and actual pagination
     (AUDIT.md §6, perf item). */
  const nodeAt = (row: number) => loader.state.nodes[Math.floor(row / CHUNK)]?.[row % CHUNK]

  const rowIndex = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".amont-row")
    return el ? Number(el.dataset.i) : null
  }

  const onScroll = () => {
    popoverCtl.closeMore()
    scrollTextStop()
    hoverCtl.clearHover() // scrolling unmounts the hovered row: the ghost chip leaves with it
    sync()
  }
  const onMouseOver = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    scrollTextHover(t.closest<HTMLElement>(".amont-scrolltext"))
    const btn = t.closest<HTMLElement>(".amont-more-btn")
    if (btn) {
      popoverCtl.cancelClose()
      if (btn !== popoverCtl.openBtn) popoverCtl.openMore(btn)
    } else if (t.closest(".amont-more")) popoverCtl.cancelClose() // over the panel itself: keep it open
    const i = rowIndex(ev)
    if (i !== null) hoverCtl.hoverRow(loader.state, i, !!nodeAt(i)?.stash)
  }
  /* Leaving the button or panel toward the outside arms the close; coming back to it cancels it. */
  const onMouseOut = (ev: MouseEvent) => {
    if (!popoverCtl.openBtn) return
    const from = (ev.target as HTMLElement).closest(".amont-more-btn, .amont-more")
    if (!from) return
    const to = ev.relatedTarget as HTMLElement | null
    if (!to || !to.closest(".amont-more-btn, .amont-more")) popoverCtl.scheduleClose()
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
    /* the "+N" is toggleable by click AND by keyboard (AUDIT.md §8): Enter/Space on the button
       trigger this same `click` natively, a real button needs no separate code.
       Before this refactor the click was explicitly swallowed (hover-only opening) — hidden
       refs were unreachable without a mouse. */
    const moreBtn = t.closest<HTMLElement>(".amont-more-btn")
    if (moreBtn) {
      if (moreBtn === popoverCtl.openBtn) popoverCtl.closeMore()
      else popoverCtl.openMore(moreBtn, { focus: true })
      return
    }
    if (t.closest(".amont-more")) return // click inside the panel itself (a ref isn't clickable): nothing to do
    popoverCtl.closeMore()
    const i = rowIndex(ev)
    if (i !== null) cb.onSelect(i, ev.ctrlKey || ev.metaKey)
  }
  const onDblClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t.closest(".amont-more, .amont-more-btn")) return
    const i = rowIndex(ev)
    if (i !== null) cb.onBranchSelect(i)
  }

  /* Board keyboard navigation (AUDIT.md §8): attached to `board` (not `document`) — so it only
     reacts when focus is within the graph, with no global shortcut registry to go through.
     Ignores anything coming from the "+N" panel or its button: Escape/Enter have their own
     meaning there (cf. interactions/popover.ts), an arrow key navigates nothing there. */
  const onBoardKeyDown = (ev: KeyboardEvent) => {
    if ((ev.target as HTMLElement).closest(".amont-more, .amont-more-btn")) return
    const cur = selectionCtl.active ?? 0
    const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey
    let target: number
    switch (ev.key) {
      case "ArrowDown":
        target = cur + 1
        break
      case "ArrowUp":
        target = cur - 1
        break
      case "PageDown":
        target = cur + pageRows()
        break
      case "PageUp":
        target = cur - pageRows()
        break
      case "Home":
        target = 0
        break
      /* no known bound as long as history isn't exhausted: `moveActive` grows in
         batches until exhaustion then clamps — MAX_SAFE_INTEGER just means "as far as possible". */
      case "End":
        target = loader.exhausted ? loader.state.next - 1 : Number.MAX_SAFE_INTEGER
        break
      case "Enter":
        target = cur
        break
      default:
        return
    }
    ev.preventDefault()
    void moveActive(target, additive)
  }

  /* no throttle: sync() is a no-op when the visible chunk/bucket range hasn't changed */
  board.addEventListener("scroll", onScroll, { passive: true })
  board.addEventListener("mouseleave", onMouseLeave)
  board.addEventListener("keydown", onBoardKeyDown)
  inner.addEventListener("mouseover", onMouseOver)
  inner.addEventListener("mouseout", onMouseOut)
  inner.addEventListener("click", onClick)
  inner.addEventListener("dblclick", onDblClick)
  document.addEventListener("keydown", onKeyDown)

  /* No ResizeObserver before this refactor: `sync()` only ran on scroll/fetch, correctness
     relied on the 14,000 px slack of chunks (AUDIT.md §6, perf item) — the narrower
     row window (viewRows) makes recalibration on resize necessary. */
  const resizeObserver = new ResizeObserver(() => sync())
  resizeObserver.observe(board)

  let stashNames: string[] = []
  /* Chips are measured against the actual font. As long as Geist hasn't replaced the fallback,
     widths are wrong: a single re-run, from the persisted sources, is enough. */
  void document.fonts.ready.then(() => {
    if (!svg.isConnected || destroyed) return
    measurer.requeueAll(stashNames)
    refresh()
  })

  return {
    async reset() {
      const { stashes } = await loader.reset()
      if (destroyed) return
      const token = loader.token
      /* Render-side caches keyed on the previous layout state must be dropped now that
         loader.reset() has installed a fresh one — all in this synchronous block, so the
         sync() triggered by remount() rebuilds them against the new state. */
      overlay.reset()
      markup.reset()
      measurer.reset()
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
      /* primes the keyboard cursor on the first row if nothing has set it yet (AUDIT.md §8):
         without this, Tab would never reach the graph before a first click. No-op if a selection
         restored by `reresolveSelection` (called right after by repo-store.tsx) already did it,
         and no-op on subsequent resets (pull/checkout/stash) — the cursor already survives those as-is. */
      if (loader.state.next > 0) {
        selectionCtl.primeActive(0)
        sync()
      }
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

    setSelection(rows, active) {
      selectionCtl.setSelection(rows, active)
      evictNow()
    },

    setMatches(hashes) {
      const ids = hashes && hashes.map((h) => idOf(loader.state.ids, h)).filter((id): id is number => id !== undefined)
      selectionCtl.setMatches(ids, loader.state.hashOf)
    },

    /* sweeps rows — the graph's order — loading on demand: the next result
       may live several pages further down. */
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
      if (nodeAt(row)?.stash) return [] // a stash doesn't focus any sidebar branch
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
      scrollTextStop() // same reason as in remount: the hovered text leaves without a mouseleave
      resizeObserver.disconnect()
      board.removeEventListener("scroll", onScroll)
      board.removeEventListener("mouseleave", onMouseLeave)
      board.removeEventListener("keydown", onBoardKeyDown)
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
