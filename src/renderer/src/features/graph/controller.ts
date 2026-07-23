/* Graph engine assembly (AUDIT.md §6): this module replays exactly the contract of
   the former `graph-canvas.ts` (same `GraphHandle`/`GraphCallbacks`, same visible behavior) by
   composing the decomposed layers — layout/ (pure), data/ (pages + ingestion), render/ (DOM),
   interactions/ (selection, hover, popover). React owns the shell
   (react/commit-graph.tsx, unchanged); this controller is a single piece: two-stage
   virtualization (SVG chunks + pinned LRU page cache), append-only streaming layout, 100% CSS
   var() theming, "React owns the selection" flow. Preserve as-is (AUDIT.md §1). */

import type { Commit, RepoApi } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { scrollTextHover, scrollTextStop } from "./interactions/scroll-text.tsx"
import { CHUNK, FIXED_W, LANE, MAX_LANES, PAD, PAGE, RESIDENT, ROW, ROW_BUCKET } from "./constants.ts"
import { idOf } from "./ids.ts"
import { branchSegment, chainInfo, chainTip, type ChainInfo } from "./layout/chains.ts"
import { reserveTrunks } from "./layout/lanes.ts"
import { computeSync, syncSignature, type SyncInfo } from "./layout/sync.ts"

export type { ChainInfo }
import type { Edge, GraphNode } from "./layout/state.ts"
import { createLoader } from "./data/loader.ts"
import { createOverlay } from "./render/overlay.ts"
import { chainColor, createMarkupCache, edgesSvg, nodesSvg } from "./render/svg.ts"
import { createMeasurer } from "./render/measure.ts"
import { cloud, rowBucket } from "./render/rows.ts"
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
  /** a linked-worktree chip was clicked (cf. render/rows.ts `wtChip`): open it as a new tab */
  onWorktreeOpen(path: string): void
}

export type GraphHandle = {
  /** Reloads the whole graph, double-buffered: the previous render stays painted while the
      new state loads, and the scroll position survives (clamped to the new height). */
  reset(): Promise<void>
  /** centers and flashes the row of `hash`. `select` (default true): the revealed row also becomes
      the selection — `focusRef` passes false, owning the selection itself so the jump doesn't
      clobber a multi-selection it is about to extend. */
  jumpTo(hash: string, select?: boolean): Promise<void>
  /** `active`: row that just acted (click, ctrl-click…) — carries the keyboard cursor (roving
      tabindex, AUDIT.md §8). If omitted, the cursor doesn't move (cf. interactions/selection.ts). */
  setSelection(rows: Iterable<number>, active?: number): void
  /** `null`: no more search in progress, rows go back to their normal hue */
  setMatches(hashes: string[] | null): void
  /** row of the next result after `from` in direction `dir`, `null` if there are no more */
  nextMatch(from: number, dir: 1 | -1): Promise<number | null>
  /** rows of the given commits, loaded on demand; hashes not found are omitted.
      `maxRows` bounds the on-demand loading: without it, a hash that no longer exists
      (amended/rebased away) makes the search page in the entire history before giving up. */
  rowsOf(hashes: string[], maxRows?: number): Promise<number[]>
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
  /** teinte de la chaîne de la row (tronc, flow ou rotation), pour `--badge-color` des chips */
  rowColor(row: number): string
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
  /* Couche focus du survol : dernier enfant du SVG, dessine par-dessus chunks et overlay.
     Les chunks en cache ne sont jamais restylés — le segment survolé est redessiné ici et
     le reste s'atténue via la classe amont-dim sur le SVG (cf. app.css). */
  const focusG = document.createElementNS(SVG_NS, "g")
  focusG.setAttribute("class", "amont-focus")
  svg.append(focusG)

  const selectionCtl = createSelection(inner)
  const hoverCtl = createHover(inner)
  const popoverCtl = createPopover(board, inner, (row) => loader.commitAt(row))

  const loader = createLoader({
    api,
    pageSize: PAGE,
    resident: RESIDENT,
    onPageLoaded: (commits) => {
      /* mid-reset pages feed the new layout state only: the DOM on screen still shows the
         previous graph, and everything below (scan, evict, refresh, sync) runs against
         render-side caches that reset() will swap — deferred to the swap block */
      if (resetOwner) {
        pendingScan.push(commits)
        return
      }
      measurer.scanPage(commits)
      if (matchHashes) applyMatchIds()
      /* Page boundaries drift off chunk boundaries (collapse folds shorten pages), so this
         page usually grew a chunk that was already mounted as the trailing, partially-filled
         one: its <g> was serialized against the old node/edge counts and would stay
         incomplete forever behind the `mountedG.has` gate in sync(). Evict it — the remount
         goes through the markup cache, which sees the new counts and reserializes. Only the
         chunk the page STARTS in can be stale: the ones it continues into didn't exist
         before this page, so they were never mounted. */
      if (commits.length) {
        const ci = Math.floor((loader.state.next - commits.length) / CHUNK)
        const g = mountedG.get(ci)
        if (g) {
          g.remove()
          mountedG.delete(ci)
        }
      }
      evictNow()
      /* refresh() on every ingested page, as the pre-refactor monolith did (regression fix):
         it is the only place that grows the SVG dims/viewBox and `inner` height (without it
         everything past page 1 renders clipped and the scrollbar never calibrates), drains
         the column-measurement queues fed by scanPage above, and advances the stats counter.
         Cheap — measureCols no-ops on empty queues, emitStats is rAF-coalesced — and it only
         ever GROWS heights, so the scroll position doesn't move. Per ingested page, never
         per scroll tick: scrolling alone lands here only when it actually fetched a page. */
      refresh()
      /* remounts the just-evicted trailing chunk in the same task — the fetch continuations
         (sync() chain, growUntil callers) also sync, but only once their whole run is done:
         without this, a long jump would leave a blank chunk on screen between rounds */
      sync()
    },
    onError: (err) => cb.onError(describeError(err)),
  })

  /* Search matches are kept as SHAs, never as resolved ids: a hit can point at a commit that
     hasn't been paginated yet, so its SHA isn't interned when the search returns. We resolve
     to ids against the current table on every ingested page — a deep hit lights up as soon as
     its row loads, instead of being dropped once and staying invisible. */
  let matchHashes: string[] | null = null
  function applyMatchIds() {
    const ids =
      matchHashes && matchHashes.map((h) => idOf(loader.state.ids, h)).filter((id): id is number => id !== undefined)
    selectionCtl.setMatches(ids, loader.state.hashOf)
  }

  let destroyed = false // an in-flight reset during destroy() (StrictMode double-mount) must no longer touch the DOM
  /* Double-buffered reset (refresh audit, §1/§5): while non-null, the previous DOM stays
     mounted and DOM-touching paths freeze — sync()/onPageLoaded/refresh() no-op, and
     interactions (click, keyboard, reveal) are dropped rather than resolving old row indices
     against the new half-loaded state. An owner token, not a counter: a newer reset takes
     ownership by overwriting it, and a superseded reset's cleanup (identity-guarded) can
     neither release the winner's freeze nor leave the freeze stuck after the winner swapped. */
  let resetOwner: object | null = null
  /* pages ingested while a reset holds the DOM frozen: their column scan is replayed at swap
     time, against the freshly reset measurer */
  let pendingScan: Commit[][] = []
  const mountedG = new Map<number, SVGGElement>()
  const mountedRows = new Map<number, HTMLDivElement>()
  let statsScheduled = false

  /* --- Local/remote divergence (cf. layout/sync.ts) ---
     Recomputed when the state moved (decorated refs or layout progress), applied only when
     the fingerprint changes: the SVG cache and the mounted rows carry the tint, so a change
     forces a reset + remount — same channel as a layout rebuild. */
  let syncInfo: SyncInfo | null = null
  let syncSig = ""
  let syncRefsN = -1
  let syncNext = -1
  const syncMarker = document.createElement("div")
  syncMarker.className = "amont-syncmark"
  syncMarker.setAttribute("aria-hidden", "true")
  syncMarker.style.display = "none"
  inner.appendChild(syncMarker)

  function placeSyncMarker() {
    if (!syncInfo) {
      syncMarker.style.display = "none"
      return
    }
    /* Frontier set at the top edge of the remote-tracking row: everything above it
       doesn't exist on the remote (yet). */
    syncMarker.style.display = ""
    syncMarker.style.top = syncInfo.upstreamRow * ROW + "px"
    const counts = [
      syncInfo.ahead.size && `↑${syncInfo.ahead.size}`,
      syncInfo.behind.size && `↓${syncInfo.behind.size}`,
    ]
      .filter(Boolean)
      .join(" ")
    syncMarker.textContent = ""
    const label = document.createElement("span")
    label.append(cloud(), document.createTextNode(`${syncInfo.upstream}${counts ? " · " + counts : ""}`))
    syncMarker.appendChild(label)
  }

  /** true if the divergence changed: mounted views are stale, remount already triggered. */
  function updateSync(): boolean {
    const S = loader.state
    if (S.refsOf.size === syncRefsN && S.next === syncNext) return false
    syncRefsN = S.refsOf.size
    syncNext = S.next
    const s = computeSync(S)
    const sig = syncSignature(s)
    if (sig === syncSig) return false
    syncSig = sig
    syncInfo = s
    markup.reset()
    placeSyncMarker()
    remount()
    return true
  }

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
    /* mid-reset: sizing the SVG/inner to the new half-loaded state would clip the old rows
       still painted underneath — the swap block re-runs this once consistent */
    if (resetOwner) return
    const S = loader.state
    const graphW = PAD * 2 + Math.min(S.lanes.length, MAX_LANES) * LANE
    const h = S.next * ROW
    svg.setAttribute("width", String(graphW))
    svg.setAttribute("height", String(h))
    svg.setAttribute("viewBox", `0 0 ${graphW} ${h}`)
    inner.style.height = h + "px"
    const { branch } = measurer.measureCols()
    inner.style.minWidth = graphW + FIXED_W + branch + "px"
    cb.onGraphWidth(graphW)
    cb.onBranchWidth(branch)
    emitStats()
  }

  function sync() {
    if (destroyed) return // the overlay is no longer in the SVG: insertBefore would fail
    /* reset in flight: the mounted maps still hold the previous graph's DOM while the loader
       already carries the new state — mounting against it would mix the two. The swap block
       in reset() re-runs sync() once everything is consistent. */
    if (resetOwner) return
    /* divergence changed: updateSync already remounted everything (remount → sync), stop here */
    if (updateSync()) return
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
      g.innerHTML = markup.chunkMarkup(ci, S, syncInfo)
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
            loader.total,
            syncInfo
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
    clearFocus() // rebuild ou divergence : le segment focalisé peut ne plus exister tel quel
    mountedG.forEach((g) => g.remove())
    mountedG.clear()
    mountedRows.forEach((d) => d.remove())
    mountedRows.clear()
    sync()
  }

  /* brings an already-laid-out row to the center of the screen, selects it and makes it flash;
     waits for its page to come back if it was evicted — the selection will read the commit synchronously.
     `select`: whether the revealed row also becomes the selection. `focusRef` reveals a branch tip
     without selecting it (select=false) — it owns the selection itself, and a non-additive select
     here would clobber the running multi-selection before it gets to extend it. */
  async function reveal(row: number, token: number, select = true) {
    if (resetOwner) return // mid-reset: scroll/refresh would tear the frozen old DOM — drop the jump
    refresh()
    board.scrollTop = row * ROW - board.clientHeight / 2
    const bi = Math.floor(row / ROW_BUCKET)
    await loader.ensureRows(bi * ROW_BUCKET, Math.min((bi + 1) * ROW_BUCKET, loader.state.next) - 1)
    evictNow()
    if (token !== loader.token || destroyed) return
    sync()
    if (select) cb.onSelect(row, false)
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
    if (resetOwner) return // mid-reset: the cursor would move against the new state under the old DOM
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

  /* --- Focus de chaîne au survol ---
     `focusRows` : segment de la row survolée (branchSegment), gardé tant que le curseur y
     reste — balayer une longue branche ne recalcule rien. La sérialisation est bornée au
     viewport ; le scroll re-sérialise (renderFocus) sans recalculer le segment, pour que
     la mise en avant suive une branche longue pendant qu'on la déroule. */
  let focusRows: number[] | null = null
  let focusSet: Set<number> | null = null

  function clearFocus() {
    if (!focusRows) return
    focusRows = null
    focusSet = null
    focusG.innerHTML = ""
    svg.classList.remove("amont-dim")
  }

  /** l'edge de merge qui absorbe `tip` : cherché dans le chunk de la row du merge, sinon
      parmi les edges longs — jamais recomposé de tête, le tracé doit recouvrir l'existant */
  function mergeEdgeOf(tip: number): Edge | null {
    const S = loader.state
    const mrow = S.mergedBy.get(tip)
    if (mrow === undefined) return null
    const match = (e: Edge) => e.r1 === mrow && e.r2 === tip && e.k > 0
    return S.edges[Math.floor(mrow / CHUNK)]?.find(match) ?? S.long.find(match) ?? null
  }

  function renderFocus() {
    if (!focusRows) return
    const S = loader.state
    const [c0, c1] = viewChunks()
    const lo = c0 * CHUNK
    const hi = (c1 + 1) * CHUNK - 1
    const edges: Edge[] = []
    const nodes: GraphNode[] = []
    for (const r of focusRows) {
      const e = S.fpEdge[r]
      if (e && e.r1 <= hi && (e.r2 ?? e.r1) >= lo) edges.push(e)
      if (r >= lo && r <= hi) {
        const n = nodeAt(r)
        if (n) nodes.push(n)
      }
    }
    const me = mergeEdgeOf(focusRows[0])
    if (me) edges.push(me)
    focusG.innerHTML = edgesSvg(edges, S, syncInfo) + nodesSvg(nodes, S, syncInfo)
  }

  /** un stash n'a pas de chaîne : survolé, il relâche le focus au lieu d'en ouvrir un */
  function focusRow(i: number) {
    if (focusSet?.has(i)) return
    if (nodeAt(i)?.stash) {
      clearFocus()
      return
    }
    focusRows = branchSegment(loader.state, i)
    focusSet = new Set(focusRows)
    svg.classList.add("amont-dim")
    renderFocus()
  }

  const onScroll = () => {
    popoverCtl.closeMore()
    scrollTextStop()
    hoverCtl.clearHover() // scrolling unmounts the hovered row: the ghost chip leaves with it
    sync()
    renderFocus() // le focus survit au scroll : re-sérialisé sur les nouvelles bornes du viewport
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
    if (i !== null) {
      hoverCtl.hoverRow(loader.state, i, !!nodeAt(i)?.stash)
      focusRow(i)
    } else clearFocus()
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
    clearFocus()
    scrollTextStop()
    popoverCtl.closeMore()
  }
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") popoverCtl.closeMore()
  }
  const onClick = (ev: MouseEvent) => {
    /* mid-reset the painted rows belong to the previous layout: their data-i resolved against
       the new state would select a different commit than the one clicked — drop the click */
    if (resetOwner) return
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
    const wtBtn = t.closest<HTMLElement>(".amont-wt-open")
    if (wtBtn) {
      /* the chip is an action, not a selection target: the click opens the worktree's tab
         and must not move the selection under the transition */
      popoverCtl.closeMore()
      if (wtBtn.dataset.path) cb.onWorktreeOpen(wtBtn.dataset.path)
      return
    }
    popoverCtl.closeMore()
    const i = rowIndex(ev)
    if (i !== null) cb.onSelect(i, ev.ctrlKey || ev.metaKey)
  }
  const onDblClick = (ev: MouseEvent) => {
    if (resetOwner) return // same stale data-i hazard as onClick
    const t = ev.target as HTMLElement
    if (t.closest(".amont-more, .amont-more-btn, .amont-wt-open")) return
    const i = rowIndex(ev)
    if (i !== null) cb.onBranchSelect(i)
  }

  /* Board keyboard navigation (AUDIT.md §8): attached to `board` (not `document`) — so it only
     reacts when focus is within the graph, with no global shortcut registry to go through.
     Ignores anything coming from the "+N" panel or its button: Escape/Enter have their own
     meaning there (cf. interactions/popover.ts), an arrow key navigates nothing there. */
  const onBoardKeyDown = (ev: KeyboardEvent) => {
    if (resetOwner) return // same stale-row hazard as onClick — arrows resume after the swap
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

  /* no throttle: when the visible chunk/bucket range hasn't changed, sync() only recomputes
     the ranges and skips every already-mounted chunk/bucket — and the overlay's dangling
     group is gated on `S.pendingGen` + height (cf. render/overlay.ts), so a plain scroll
     tick performs no DOM writes at all */
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
    /* Double-buffered (refresh audit, §1/§5): the previous DOM stays painted for the whole
       load — loader reset, first page, growth back to the previous scroll depth — and the
       teardown + first mount of the new graph happen in one synchronous block, so the browser
       never paints the intermediate empty state. The scroll position survives (clamped);
       the old behavior yanked the viewport to the top and left the graph blank while page 1
       was in flight. */
    async reset() {
      const me = {}
      /* takes ownership of the freeze — a superseded reset's cleanup below is identity-guarded,
         so it can neither release the winner's freeze nor leave it stuck after the swap */
      resetOwner = me
      /* loader.reset() bumps `gen` synchronously: pages a superseded reset pushed before this
         instant belong to a state that will never mount, and none can be pushed after — the
         held scans start clean for this (now-winning) reset */
      pendingScan = []
      try {
        const prevScroll = board.scrollTop
        const { stashes } = await loader.reset()
        if (destroyed || resetOwner !== me) return
        /* Lanes tronc réservées AVANT la première page : master/develop gardent leur colonne.
           refs() est le même for-each-ref que la sidebar — bon marché. En échec, layout inchangé. */
        try {
          const refs = await api.refs()
          if (destroyed || resetOwner !== me) return
          reserveTrunks(
            loader.state,
            refs
              .filter((r) => r.kind !== "tag")
              .map((r) => (r.kind === "remote" ? r.name.slice(r.name.indexOf("/") + 1) : r.name))
          )
        } catch {
          /* pas de réservation : l'allocation retombe sur le comportement historique */
        }
        const token = loader.token
        await loader.fetchMore()
        if (destroyed || resetOwner !== me) return
        /* Grow the layout (pure state, no DOM yet) until it covers the previous viewport:
           restoring the scroll must not clamp against a one-page-tall document. Capped at the
           page-cache residency budget — a viewport parked tens of thousands of rows deep must
           not turn every background reload into a full-history re-page (refresh audit follow-up);
           past the cap the restore clamps to what was regrown. */
        const needed = Math.min(prevScroll + board.clientHeight, RESIDENT * PAGE * ROW)
        if (loader.state.next * ROW < needed && !loader.exhausted) {
          await loader.growUntil(() => loader.state.next * ROW >= needed, token)
          if (destroyed || resetOwner !== me) return
        }

        /* ---- synchronous swap: render-side caches keyed on the previous layout state are
           dropped and the new graph mounts, all in this task — no intermediate paint ---- */
        overlay.reset()
        markup.reset()
        measurer.reset()
        /* sync state: starts over against the fresh LayoutState */
        syncInfo = null
        syncSig = ""
        syncRefsN = -1
        syncNext = -1
        placeSyncMarker()
        stashNames = stashes.map((s) => s.name)
        measurer.queueStashNames(stashNames)
        for (const page of pendingScan) measurer.scanPage(page)
        pendingScan = []
        if (matchHashes) applyMatchIds()
        selectionCtl.setSelection([])
        resetOwner = null
        remount()
        /* clamp the CURRENT position (re-read, not prevScroll): the old DOM stayed live and
           scrollable during the load, so this preserves any scrolling done meanwhile too */
        board.scrollTop = Math.min(board.scrollTop, Math.max(0, loader.state.next * ROW - board.clientHeight))
        hoverCtl.clearHover()
        popoverCtl.closeMore()
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
      } finally {
        if (resetOwner === me) resetOwner = null // failed/destroyed run: release the freeze it still owns
      }
    },

    async jumpTo(hash, select = true) {
      const token = loader.token
      if (resolveRow(hash) === undefined) await loader.growUntil(() => resolveRow(hash) !== undefined, token)
      const row = resolveRow(hash)
      if (row === undefined || token !== loader.token) return
      await reveal(row, token, select)
    },

    async rowsOf(hashes, maxRows) {
      const token = loader.token
      const allKnown = () => hashes.every((h) => resolveRow(h) !== undefined)
      /* capped search: a caller that knows roughly where its hashes lived (reresolveSelection
         after a reset) must not page the whole history chasing one that an amend/rebase erased */
      const capped = () => maxRows !== undefined && loader.state.next >= maxRows
      if (!allKnown()) await loader.growUntil(() => allKnown() || capped(), token)
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
      matchHashes = hashes
      applyMatchIds()
    },

    /* sweeps rows — the graph's order — loading on demand: the next result
       may live several pages further down. Guard on the SHA list, not the resolved-id set:
       when every hit is still below the loaded window the id set is empty, yet the results
       are real and growUntil below will page down to them. */
    async nextMatch(from, dir) {
      if (!matchHashes?.length) return null
      const token = loader.token
      for (let i = from + dir; i >= 0; i += dir) {
        if (i >= loader.state.next && !loader.exhausted) {
          await loader.growUntil(() => i < loader.state.next, token)
        }
        if (token !== loader.token || i >= loader.state.next) return null
        /* re-read live: growUntil above just paged in row `i`, and each ingested page
           re-resolved matchHashes into the id set (onPageLoaded), so a deep hit is now present */
        if (!selectionCtl.matches?.has(loader.state.hashOf[i])) continue
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
    rowColor: (row) => chainColor(loader.state, row),

    headDot(headSha) {
      const S = loader.state
      const id = headSha === null ? undefined : idOf(S.ids, headSha)
      const row = id === undefined ? undefined : S.rowOf.get(id)
      const lane = row === undefined ? undefined : S.laneOf[row]
      return lane === undefined ? null : { left: PAD + lane * LANE + LANE / 2, color: chainColor(S, row!) }
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
      syncMarker.remove()
      popoverCtl.destroy()
      overlay.root.remove()
      focusG.remove()
      svg.classList.remove("amont-dim")
    },
  }
}
