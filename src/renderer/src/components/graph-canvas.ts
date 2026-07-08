import { CloudIcon } from "@hugeicons/core-free-icons"

import { type Commit, type RepoApi } from "@/lib/git"
import { avatarUrl, initials, tint } from "@/lib/avatar"
import { iconEl } from "@/lib/utils"
import { badgeSeparator, badgeVariants } from "@/components/ui/badge"
import {
  BACKUP_WIP, MAIN_TARGETS, parseMerge, parseRefs, parseSubject, refColor, typeColor,
  type BadgeColor, type RefChip,
} from "@/lib/commit-message"
import {
  branchChain, branchSegment, chainInfo, createState, edgePath, edgesSvg, laneColor,
  layoutChunk, nodesSvg, stroke, CHUNK, PAGE, ROW, PAD, LANE, X,
  type LayoutState,
} from "@/lib/graph-layout"

/* Rendu impératif, délibérément : virtualisation par chunks de 500 lignes, montage et
   démontage direct des <g> SVG. React ne gagnerait rien à repasser par un VDOM ici, et
   perdrait le contrôle fin du scroll. React possède la coquille, pas ce canvas. */

const SVG_NS = "http://www.w3.org/2000/svg"

/* Les tags ont leur colonne, à droite du sujet : leur nombre ne déplace plus le texte du commit.
   Type et tags sont dimensionnés sur le contenu chargé (cf. `measureCols`) et tombent à 0 quand
   le dépôt n'en a aucun. Leur gouttière est du vide en fin de piste, pas un `gap` ni un padding :
   l'un survivrait à une piste nulle, l'autre lui imposerait un plancher (`box-sizing: border-box`).
   Les colonnes qui ne s'effacent jamais, elles, portent la leur en `pe-2.5`. */
const ROW_CLASS =
  "gg-row grid h-7 cursor-pointer grid-cols-[var(--gg-type,0px)_1fr_var(--gg-tag,0px)_130px_84px_68px] " +
  "items-center border-l-2 border-l-transparent pr-4.5 text-xs hover:bg-muted/60 " +
  "data-selected:border-l-primary data-selected:bg-primary/10"

/** gouttière d'une colonne, `pe-2.5` ou vide de fin de piste */
const GAP = 10
/** `gap-1.5` entre le dernier tag et son "+N" */
const CHIP_GAP = 6
const TYPE_MAX = "max-w-24"
const TAG_MAX = "max-w-30"
/** pl du graphe + sujet (min) + auteur + date + hash + pr-4.5, gouttières comprises */
const FIXED_W = 12 + 320 + 130 + 84 + 68 + 18

const chip = (color: BadgeColor) => badgeVariants({ color, shape: "squared" })
const cloud = () => iconEl(CloudIcon, "shrink-0")

/* Jumeau impératif de `<Avatar>` : l'image recouvre le monogramme, un 404 la retire.
   Une ligne du graphe n'est jamais recyclée — la retirer suffit, rien ne la remontera. */
function avatarEl(name: string, email: string) {
  const el = document.createElement("span")
  el.className =
    "relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full " +
    "text-[0.5rem] font-medium text-background"
  el.style.background = tint(name, email)
  el.textContent = initials(name)

  const src = avatarUrl(email)
  if (src) {
    const img = document.createElement("img")
    img.src = src
    img.alt = ""
    img.className = "absolute inset-0 size-full"
    img.onerror = () => img.remove()
    el.appendChild(img)
  }
  return el
}

/* Au-delà du budget de sa colonne, le reste d'un groupe tient dans un "+N" qui déplie la liste
   entière. Rien n'est perdu — le panneau de détail liste aussi toutes les refs de la sélection.

   Le repli est décidé par le seul débordement, jamais par le contenu du chip : replier une ref
   isolée ne gagnerait pas un pixel, et un "+N" sans chip devant n'annonce rien. Ces seuils
   garantissent les deux — `slice(0, n>0)` d'une liste non vide ne l'est pas non plus. */
const HEAD_BUDGET = 2
/* ponytail: budget fixe à 1 — la colonne fait la largeur du tag le plus long, deux tags courts
   y tiendraient donc, mais le savoir demanderait de mesurer chaque ligne. Compter, pas mesurer. */
const TAG_BUDGET = 1

/** Surface flottante du projet (cf. `dialog`, `command`). */
const MORE_CLASS =
  "gg-more absolute z-20 hidden w-max max-w-72 flex-col items-start gap-1 rounded-xl " +
  "bg-popover p-1.5 text-popover-foreground ring-1 ring-foreground/10"

export type Stats = { loaded: number; total: number; ms: number }

export type GraphCallbacks = {
  onSelect(row: number, additive: boolean): void
  onBranchSelect(row: number): void
  onHover(info: string | null): void
  onStats(stats: Stats): void
  onGraphWidth(px: number): void
}

export type GraphHandle = {
  reset(): Promise<void>
  jumpTo(hash: string): Promise<void>
  setSelection(rows: Iterable<number>): void
  /** `null` : plus de recherche en cours, les lignes reprennent leur teinte normale */
  setMatches(hashes: string[] | null): void
  /** ligne du prochain résultat après `from` dans le sens `dir`, `null` s'il n'y en a plus */
  nextMatch(from: number, dir: 1 | -1): Promise<number | null>
  commit(row: number): Commit | undefined
  branchSegment(row: number): number[]
  chainInfo(rows: number[]): string
  /** teinte du trait de la ligne, à poser en `--badge-color` sur les chips de branche */
  laneColor(row: number): string
  /** position et teinte du point d'arbre de travail, aligné sur la lane de HEAD */
  headDot(headSha: string | null): { left: number; color: string } | null
  destroy(): void
}

export function createGraph(
  board: HTMLDivElement,
  inner: HTMLDivElement,
  svg: SVGSVGElement,
  api: RepoApi,
  cb: GraphCallbacks
): GraphHandle {
  let DATA: Commit[] = []
  let TOTAL = 0
  let NCHUNKS = 0
  let exhausted = false
  let fetching: Promise<void> | null = null
  let gen = 0 // invalide les fetchs en vol après un reset
  let S: LayoutState = createState(1)
  let selection = new Set<number>()
  let matches: Set<string> | null = null
  let hoverChain: Set<number> | null = null

  const overlay = document.createElementNS(SVG_NS, "g") // long + dangling, toujours monté
  const hlG = document.createElementNS(SVG_NS, "g")
  hlG.setAttribute("class", "gg-hl")
  svg.append(overlay, hlG)

  /* Déplier une ligne coûterait sa hauteur : `Y(r) = r * ROW + ROW/2` place tous les nœuds et
     toutes les arêtes du SVG, et `ROW` sert aussi de pas au mapping scroll → chunk. Le panneau
     recouvre les lignes du dessous au lieu de les pousser : la géométrie du graphe ne bouge pas.
     Enfant de `inner`, il suit le scroll ; z-20 le met au-dessus du SVG (z-1). */
  const more = document.createElement("div")
  more.className = MORE_CLASS
  inner.appendChild(more)
  let openBtn: HTMLElement | null = null

  const mountedG = new Map<number, SVGGElement>()
  const mountedRows = new Map<number, HTMLDivElement>()

  function closeMore() {
    if (!openBtn) return
    openBtn.setAttribute("aria-expanded", "false")
    openBtn = null
    more.classList.replace("flex", "hidden")
  }

  function openMore(btn: HTMLElement) {
    closeMore()
    const row = btn.closest<HTMLElement>(".gg-row")!
    const c = DATA[Number(row.dataset.i)]
    const tags = btn.dataset.tags === "true"
    const refs = parseRefs(c.r).filter((r) => (r.kind === "tag") === tags)
    more.replaceChildren(...refs.map((r) => refChip(r, "max-w-full")))
    /* le panneau flotte sous `inner`, pas sous la ligne : la teinte de lane ne peut pas hériter */
    more.style.setProperty("--badge-color", row.style.getPropertyValue("--badge-color"))

    const b = btn.getBoundingClientRect()
    const box = inner.getBoundingClientRect() // se déplace avec le scroll, comme `more`
    more.style.left = b.left - box.left + "px"
    more.style.top = b.bottom - box.top + 4 + "px"
    more.classList.replace("hidden", "flex")
    btn.setAttribute("aria-expanded", "true")
    openBtn = btn
  }

  function chunkG(ci: number) {
    const g = document.createElementNS(SVG_NS, "g")
    g.innerHTML = edgesSvg(S.edges[ci]) + nodesSvg(S.nodes[ci])
    return g
  }

  /* Le nuage dit où est la distante. Détaché du nom par un filet : « ici aussi ». Collé à un nom
     complet (`origin/develop`) : « la branche locale est ailleurs ». Une branche sans nuage
     n'a pas de distante du tout. */
  function refChip(r: RefChip, maxw: string) {
    const synced = r.remotes.length > 0
    const el = document.createElement("span")
    el.className = chip(refColor(r.kind)) + " " + maxw + (r.kind === "remote" || synced ? " ps-1.5" : "")
    el.title = synced ? r.remotes.join(", ") : r.name
    if (r.kind === "remote" || synced) el.appendChild(cloud())
    if (synced) {
      const sep = document.createElement("span")
      sep.className = badgeSeparator
      el.appendChild(sep)
    }
    const text = document.createElement("span")
    text.className = "truncate"
    text.textContent = r.name
    el.appendChild(text)
    return el
  }

  /** Les refs d'un groupe, tronquées à `budget`, le reste derrière un "+N" qui les déplie toutes. */
  function refGroup(refs: RefChip[], budget: number, tags: boolean, maxw: string, parent: HTMLElement) {
    for (const r of refs.slice(0, budget)) parent.appendChild(refChip(r, maxw))
    const hidden = refs.slice(budget)
    if (!hidden.length) return
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = chip("neutral") + " gg-more-btn cursor-pointer" // un compteur, pas une ref : pas de teinte
    btn.dataset.tags = String(tags)
    btn.textContent = `+${hidden.length}`
    btn.title = hidden.map((r) => r.name).join(", ")
    btn.setAttribute("aria-expanded", "false")
    parent.appendChild(btn)
  }

  function rowDiv(i: number) {
    const c = DATA[i]
    const row = document.createElement("div")
    row.className = ROW_CLASS
    row.dataset.i = String(i)
    row.dataset.selected = String(selection.has(i))
    if (matches) row.dataset.match = String(matches.has(c.h))
    /* hérité par les chips `lane` de la ligne — les noms de branche portent la couleur du trait */
    row.style.setProperty("--badge-color", laneColor(S.laneOf[i]))

    const ps = parseSubject(c.s)
    const badge = document.createElement("div")
    badge.className = "flex min-w-0"
    if (ps.label) {
      const b = document.createElement("span")
      b.className = chip(typeColor(ps.type!)) + " " + TYPE_MAX
      b.textContent = ps.label
      badge.appendChild(b)
    }
    row.appendChild(badge)

    /* Les branches restent devant le sujet : elles le qualifient, et sont peu nombreuses.
       Les tags, eux, sont des marqueurs de release — ils partent dans leur colonne. */
    const refs = c.r ? parseRefs(c.r) : []
    const subj = document.createElement("div")
    subj.className =
      "flex min-w-0 items-center gap-1.5 truncate pe-2.5" + (BACKUP_WIP.test(c.s) ? " text-muted-foreground" : "")
    refGroup(refs.filter((r) => r.kind !== "tag"), HEAD_BUDGET, false, "max-w-42", subj)

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

    const tags = document.createElement("div")
    tags.className = "flex min-w-0 items-center gap-1.5"
    refGroup(refs.filter((r) => r.kind === "tag"), TAG_BUDGET, true, TAG_MAX, tags)
    row.appendChild(tags)

    const author = document.createElement("div")
    author.className = "flex min-w-0 items-center gap-1.5 pe-2.5 text-muted-foreground"
    author.title = c.e || c.a
    const name = document.createElement("span")
    name.className = "truncate"
    name.textContent = c.a
    author.append(avatarEl(c.a, c.e), name)
    row.appendChild(author)

    for (const [cls, val] of [
      ["pe-2.5 text-muted-foreground tabular-nums", c.d],
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

  /* --- Largeur des colonnes type et tags ---
     Une piste `auto` se dimensionnerait ligne par ligne (chaque ligne est sa propre grille) :
     les colonnes ne s'aligneraient plus. On mesure donc, une fois par chaîne distincte, dans un
     règle hors flux — écritures groupées puis lectures groupées, un seul reflow. Les maxima ne
     font que croître : ni la pagination ni le scroll ne déplacent une colonne. */
  const ruler = document.createElement("div")
  ruler.className = "invisible absolute top-0 left-0 flex"
  const seenType = new Set<string>()
  const seenTag = new Set<string>()
  let scanned = 0
  let typeW = 0
  let tagW = 0
  let plusN = 0
  let plusW = 0

  function widest(texts: string[], maxw: string) {
    ruler.replaceChildren(
      ...texts.map((t) => {
        const s = document.createElement("span")
        s.className = chip("neutral") + " " + maxw
        s.textContent = t
        return s
      })
    )
    inner.appendChild(ruler)
    const w = Math.max(0, ...[...ruler.children].map((el) => (el as HTMLElement).offsetWidth))
    ruler.remove()
    return w
  }

  /** Pose `--gg-type` / `--gg-tag` et renvoie la place que les deux colonnes prennent. */
  function measureCols() {
    const types: string[] = []
    const tags: string[] = []
    let plus = plusN
    for (; scanned < S.next; scanned++) {
      const c = DATA[scanned]
      const label = parseSubject(c.s).label
      if (label && !seenType.has(label)) seenType.add(label), types.push(label)
      if (!c.r) continue
      let n = 0
      for (const r of parseRefs(c.r)) {
        if (r.kind !== "tag") continue
        n++
        if (!seenTag.has(r.name)) seenTag.add(r.name), tags.push(r.name)
      }
      plus = Math.max(plus, n - TAG_BUDGET)
    }
    if (types.length) typeW = Math.max(typeW, widest(types, TYPE_MAX))
    if (tags.length) tagW = Math.max(tagW, widest(tags, TAG_MAX))
    if (plus > plusN) {
      plusN = plus
      plusW = CHIP_GAP + widest([`+${plusN}`], "")
    }

    const type = typeW && typeW + GAP
    const tag = tagW && tagW + plusW + GAP
    inner.style.setProperty("--gg-type", type + "px")
    inner.style.setProperty("--gg-tag", tag + "px")
    return type + tag
  }

  /* Les chips sont mesurés à la police réelle. Tant que Geist n'a pas remplacé le fallback,
     les largeurs sont fausses : une seule reprise suffit à les asseoir. */
  document.fonts.ready.then(() => {
    if (!svg.isConnected) return
    seenType.clear()
    seenTag.clear()
    scanned = typeW = tagW = plusN = plusW = 0
    refresh()
  })

  function refresh() {
    const graphW = PAD * 2 + S.lanes.length * LANE
    const h = S.next * ROW
    svg.setAttribute("width", String(graphW))
    svg.setAttribute("height", String(h))
    svg.setAttribute("viewBox", `0 0 ${graphW} ${h}`)
    inner.style.height = h + "px"
    inner.style.minWidth = graphW + FIXED_W + measureCols() + "px"
    cb.onGraphWidth(graphW)

    let dangling = ""
    S.pending.forEach((list) =>
      list.forEach((e) => {
        dangling += `<path d="${edgePath(e, h)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6" stroke-dasharray="2 4" opacity="0.45"/>`
      })
    )
    overlay.innerHTML = edgesSvg(S.long) + dangling
    cb.onStats({ loaded: S.next, total: TOTAL, ms: S.ms })
  }

  async function fetchMore() {
    if (exhausted) return
    if (!fetching) {
      const g = gen
      fetching = api.log(DATA.length, PAGE).then((page) => {
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

  function applyMatches() {
    inner.toggleAttribute("data-search", matches !== null)
    inner.querySelectorAll<HTMLElement>(".gg-row").forEach((r) => {
      if (matches) r.dataset.match = String(matches.has(DATA[Number(r.dataset.i)].h))
      else delete r.dataset.match
    })
  }

  /* amène une ligne déjà mise en page au centre de l'écran, la sélectionne et la fait clignoter */
  function reveal(row: number) {
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

  /* le panneau est ancré à une ligne : le scroll peut la démonter sous lui */
  const onScroll = () => {
    closeMore()
    sync()
  }
  const onMouseOver = (ev: MouseEvent) => {
    const i = rowIndex(ev)
    if (i !== null) hoverRow(i)
  }
  const onMouseLeave = () => clearHover()
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closeMore()
  }
  const onClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t.closest(".gg-more")) return
    const btn = t.closest<HTMLElement>(".gg-more-btn")
    if (btn) return void (btn === openBtn ? closeMore() : openMore(btn)) // et surtout : pas de sélection
    closeMore()
    const i = rowIndex(ev)
    if (i !== null) cb.onSelect(i, ev.ctrlKey || ev.metaKey)
  }
  const onDblClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t.closest(".gg-more, .gg-more-btn")) return
    const i = rowIndex(ev)
    if (i !== null) cb.onBranchSelect(i)
  }

  /* pas de throttle : sync() est un no-op quand la plage de chunks visibles n'a pas changé */
  board.addEventListener("scroll", onScroll, { passive: true })
  board.addEventListener("mouseleave", onMouseLeave)
  inner.addEventListener("mouseover", onMouseOver)
  inner.addEventListener("click", onClick)
  inner.addEventListener("dblclick", onDblClick)
  document.addEventListener("keydown", onKeyDown)

  return {
    async reset() {
      gen++
      DATA = []
      fetching = null
      TOTAL = await api.total()
      exhausted = TOTAL === 0
      NCHUNKS = Math.max(1, Math.ceil(TOTAL / CHUNK))
      S = createState(NCHUNKS)
      selection = new Set()
      remount()
      board.scrollTop = 0
      clearHover()
      closeMore()
      await fetchMore()
      layoutChunk(S, DATA)
      refresh()
      sync()
    },

    async jumpTo(hash: string) {
      while (!S.rowOf.has(hash) && (S.next < DATA.length || !exhausted)) {
        if (S.next < DATA.length) layoutChunk(S, DATA)
        else await fetchMore()
      }
      const row = S.rowOf.get(hash)
      if (row === undefined) return
      reveal(row)
    },

    setSelection(rows) {
      selection = new Set(rows)
      applySelection()
    },

    setMatches(hashes) {
      matches = hashes && new Set(hashes)
      applyMatches()
    },

    /* balaye DATA — l'ordre du graphe — en chargeant à la demande : le résultat suivant peut
       vivre plusieurs pages plus bas. */
    async nextMatch(from, dir) {
      if (!matches?.size) return null
      const g = gen
      for (let i = from + dir; i >= 0; i += dir) {
        while (i >= DATA.length && !exhausted) await fetchMore()
        if (g !== gen || i >= DATA.length) return null
        if (!matches.has(DATA[i].h)) continue
        while (S.next <= i) layoutChunk(S, DATA)
        reveal(i)
        return i
      }
      return null
    },

    commit: (row) => DATA[row],
    branchSegment: (row) => branchSegment(S, DATA, row),
    chainInfo: (rows) => chainInfo(S, DATA, rows),
    laneColor: (row) => laneColor(S.laneOf[row]),

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
      document.removeEventListener("keydown", onKeyDown)
      mountedG.forEach((g) => g.remove())
      mountedRows.forEach((d) => d.remove())
      more.remove()
      overlay.remove()
      hlG.remove()
    },
  }
}
