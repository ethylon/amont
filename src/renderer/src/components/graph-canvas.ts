import { ArrowRight01Icon, CloudIcon, Fire02Icon, RocketIcon, Tag01Icon } from "@hugeicons/core-free-icons"

import { type Commit, type RepoApi } from "@/lib/git"
import { avatarUrl, initials, tint } from "@/lib/avatar"
import { iconEl } from "@/lib/utils"
import { badgeSeparator, badgeVariants } from "@/components/ui/badge"
import {
  BACKUP_WIP, mergeColor, mergeFlow, mergeSource, parseMerge, parseRefs, parseSubject, refColor,
  SEMVER, tagFlowColor, typeColor,
  type BadgeColor, type FlowKind, type ParsedMerge, type RefChip,
} from "@/lib/commit-message"
import {
  branchChain, branchSegment, chainInfo, collapsePairs, createState, edgePath, edgesSvg, laneColor,
  layoutChunk, nodesSvg, stroke, CHUNK, PAGE, ROW, PAD, LANE, X,
  type LayoutState,
} from "@/lib/graph-layout"

/* Rendu impératif, délibérément : virtualisation par chunks de 500 lignes, montage et
   démontage direct des <g> SVG. React ne gagnerait rien à repasser par un VDOM ici, et
   perdrait le contrôle fin du scroll. React possède la coquille, pas ce canvas. */

const SVG_NS = "http://www.w3.org/2000/svg"

/* La colonne branche est à gauche du métro : elle fusionne les anciens chips de branche (qui
   précédaient le sujet) et la colonne des tags. Priorité au nom de branche ; les branches en trop
   et les tags tombent derrière un "+N". Elle et la colonne type se dimensionnent sur le contenu
   chargé (cf. `measureCols`) et tombent à 0 quand le dépôt n'a rien à y mettre. La colonne graphe
   est un espaceur réservant `--graphw` sous le SVG, décalé de la largeur de la colonne branche. */
const ROW_CLASS =
  "gg-row grid h-7 cursor-pointer " +
  "grid-cols-[var(--gg-branch,0px)_calc(var(--graphw,0px)+12px)_var(--gg-type,0px)_1fr_130px_84px_68px] " +
  "items-center border-l-2 border-l-transparent pr-4.5 text-xs hover:bg-muted/60 " +
  "data-selected:border-l-primary data-selected:bg-primary/20 data-selected:hover:bg-primary/25"

/** gouttière d'une colonne, `pe-2.5` ou vide de fin de piste */
const GAP = 10
const TYPE_MAX = "max-w-28"
/** plafond du nom de branche : 96px, au-delà il défile au survol */
const BRANCH_MAX = "max-w-24"
/** graphe(12) + sujet (min) + auteur + date + hash + pr-4.5, gouttières comprises */
const FIXED_W = 12 + 320 + 130 + 84 + 68 + 18

const chip = (color: BadgeColor) => badgeVariants({ color, shape: "squared" })
const cloud = () => iconEl(CloudIcon, "shrink-0")
const tagIcon = () => iconEl(Tag01Icon, "shrink-0")

/* Texte de chip défilable : `.gg-clip` rogne, `.gg-scroll` porte l'anim de survol (cf. app.css). */
function marq(text: string) {
  const clip = document.createElement("span")
  clip.className = "gg-clip"
  const inner = document.createElement("span")
  inner.className = "gg-scroll"
  inner.textContent = text
  clip.appendChild(inner)
  return clip
}

/* Chip fantôme du survol : le nom de la branche à laquelle appartient le commit survolé, posé dans
   la colonne branche quand elle est vide. Contour pointillé, estompé — un rappel, pas une ref réelle. */
function ghostChip(name: string, color: string) {
  const el = document.createElement("span")
  el.className =
    badgeVariants({ color: "lane", shape: "squared", variant: "outline" }) + " border-dashed opacity-70 " + BRANCH_MAX
  el.style.setProperty("--badge-color", color)
  el.appendChild(marq(name))
  return el
}

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
/* ponytail: budget fixe à 1 — la colonne fait la largeur d'un chip, en afficher deux demanderait
   de mesurer chaque ligne. Compter, pas mesurer. Les refs sont triées branche → tag (cf. parseRefs),
   donc `slice(0, 1)` garde bien le nom de branche prioritaire. */
const BRANCH_BUDGET = 1

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
  onBranchWidth(px: number): void
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
  commit(row: number): Commit | undefined
  branchSegment(row: number): number[]
  chainInfo(rows: number[]): string
  /** branches de la ligne : ses refs propres, sinon celles du tip de sa chaîne, sinon la
      branche absorbée par son merge ; ordonnées HEAD, locales, distantes — vide faute de nom */
  branchesOf(row: number): { name: string; kind: "head" | "remote" }[]
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
  let rawLoaded = 0 // commits bruts consommés (skip de `api.log`) : le collapse rend DATA plus court
  let TOTAL = 0
  let NCHUNKS = 0
  let exhausted = false
  let fetching: Promise<void> | null = null
  let gen = 0 // invalide les fetchs en vol après un reset
  let destroyed = false // un reset en vol pendant destroy() (double montage StrictMode) ne doit plus toucher le DOM
  let S: LayoutState = createState(1)
  let selection = new Set<number>()
  let matches: Set<string> | null = null
  let hovered: number | null = null
  let ghostEl: HTMLElement | null = null

  const overlay = document.createElementNS(SVG_NS, "g") // long + dangling, toujours monté
  svg.append(overlay)

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

  /* Ouverture au survol : la fermeture est différée pour franchir le vide de 4px entre le bouton
     et le panneau — le survol du panneau, arrivé dans l'intervalle, annule la fermeture. */
  let moreTimer = 0
  const cancelClose = () => clearTimeout(moreTimer)
  const scheduleClose = () => {
    clearTimeout(moreTimer)
    moreTimer = window.setTimeout(closeMore, 120)
  }

  function openMore(btn: HTMLElement) {
    closeMore()
    const row = btn.closest<HTMLElement>(".gg-row")!
    const c = DATA[Number(row.dataset.i)]
    const refs = parseRefs(c.r).slice(Number(btn.dataset.n))
    const flow = (row.dataset.flow as FlowKind) || null
    more.replaceChildren(...refs.map((r) => refChip(r, "max-w-full", flow)))
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
  function refChip(r: RefChip, maxw: string, flow: FlowKind | null = null) {
    const synced = r.remotes.length > 0
    /* Un tag de version est le jalon d'une release : icône étiquette + teinte du flow (violet/rouge). */
    const version = r.kind === "tag" && SEMVER.test(r.name)
    const el = document.createElement("span")
    el.className =
      chip(version ? tagFlowColor(flow) : refColor(r.kind)) + " " + maxw +
      (!version && (r.kind === "remote" || synced) ? " ps-1.5" : "")
    el.title = synced ? r.remotes.join(", ") : r.name
    if (version) el.appendChild(tagIcon())
    if (r.kind === "remote" || synced) el.appendChild(cloud())
    if (synced) {
      const sep = document.createElement("span")
      sep.className = badgeSeparator
      el.appendChild(sep)
    }
    el.appendChild(marq(r.name))
    return el
  }

  /** Les refs d'un groupe, tronquées à `budget`, le reste derrière un "+N" qui les déplie toutes. */
  function refGroup(refs: RefChip[], budget: number, maxw: string, parent: HTMLElement, flow: FlowKind | null = null) {
    for (const r of refs.slice(0, budget)) parent.appendChild(refChip(r, maxw, flow))
    const hidden = refs.slice(budget)
    if (!hidden.length) return
    const btn = document.createElement("button")
    btn.type = "button"
    btn.className = chip("neutral") + " gg-more-btn cursor-pointer" // un compteur, pas une ref : pas de teinte
    btn.dataset.n = String(budget) // borne de slice pour openMore
    btn.textContent = `+${hidden.length}`
    btn.title = hidden.map((r) => r.name).join(", ")
    btn.setAttribute("aria-expanded", "false")
    parent.appendChild(btn)
  }

  /* Flow d'une ligne. Un merge `hotfix/*`|`release/*` se lit sur son sujet ; mais « Merge tag 'vX'
     into develop » rapatrie une version sans dire d'où elle vient. On remonte alors au commit tagué
     (2ᵉ parent, le merge côté master) : si c'est un hotfix, ce re-merge l'est aussi. Sans ça, le
     retour d'un hotfix sur develop passerait pour une release. */
  function rowFlow(c: Commit, mg: ParsedMerge | null): FlowKind | null {
    if (!mg) return null
    const own = mergeFlow(mg)
    if (!mg.tag) return own
    const pr = S.rowOf.get(c.p[1])
    const parent = pr !== undefined ? DATA[pr] : undefined
    const pmg = parent && parent.p.length > 1 ? parseMerge(parent.s) : null
    return pmg && mergeFlow(pmg) === "hotfix" ? "hotfix" : own
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

    /* Motif release/hotfix : la ligne porte un accent latéral (cf. app.css) et sa teinte irrigue
       le chip source du merge comme le drapeau du tag. */
    const mg = c.p.length > 1 ? parseMerge(c.s) : null
    const flow = c.cap ? c.cap.flow : rowFlow(c, mg)
    if (flow) row.dataset.flow = flow

    /* Colonne branche, à gauche du métro : nom(s) de branche puis tags, repliés au budget.
       Une capsule y met sa version en tête ; sinon le survol y pose un chip fantôme (cf. hoverRow). */
    const refs = c.r ? parseRefs(c.r) : []
    const branch = document.createElement("div")
    branch.className = "gg-branchcell flex min-w-0 items-center gap-1.5 px-2.5"
    if (c.cap) {
      const v = document.createElement("span")
      v.className = chip(tagFlowColor(c.cap.flow)) + " " + BRANCH_MAX
      v.appendChild(tagIcon())
      v.appendChild(marq(c.cap.version ?? c.cap.from))
      v.title = c.cap.version ?? c.cap.from
      branch.appendChild(v)
    } else {
      refGroup(refs, BRANCH_BUDGET, BRANCH_MAX, branch, flow)
    }
    row.appendChild(branch)

    row.appendChild(document.createElement("div")) // espaceur : la colonne graphe, sous le SVG

    const ps = parseSubject(c.s)
    const badge = document.createElement("div")
    badge.className = "flex min-w-0"
    if (ps.label) {
      const b = document.createElement("span")
      b.className = chip(typeColor(ps.type!)) + " " + TYPE_MAX
      b.appendChild(marq(ps.label))
      badge.appendChild(b)
    }
    row.appendChild(badge)

    const subj = document.createElement("div")
    subj.className =
      "flex min-w-0 items-center gap-1.5 truncate pe-2.5" + (BACKUP_WIP.test(c.s) ? " opacity-30" : "")

    if (c.cap) {
      /* Capsule : le motif entier sur une ligne — `release/x →(fusée/flamme) master · develop`. */
      subj.title = c.s
      const from = document.createElement("span")
      from.className = chip(tagFlowColor(c.cap.flow)) + " max-w-42"
      from.appendChild(iconEl(c.cap.flow === "hotfix" ? Fire02Icon : RocketIcon, "shrink-0"))
      from.appendChild(marq(c.cap.from))
      from.title = c.cap.from
      subj.append(from, iconEl(ArrowRight01Icon, "size-3.5 shrink-0 text-muted-foreground"))
      c.cap.targets.forEach((t, k) => {
        if (k) {
          const sep = document.createElement("span")
          sep.className = "shrink-0 text-muted-foreground/60"
          sep.textContent = "·"
          subj.appendChild(sep)
        }
        const tc = document.createElement("span")
        tc.className = chip("neutral") + " max-w-42"
        tc.appendChild(marq(t))
        tc.title = t
        subj.appendChild(tc)
      })
    } else if (mg) {
      if (mg.noise) row.classList.add("opacity-45")
      subj.title = c.s
      const from = document.createElement("span")
      from.className = chip(flow ? tagFlowColor(flow) : mergeColor(mg)) + " max-w-42"
      if (flow) from.appendChild(iconEl(flow === "hotfix" ? Fire02Icon : RocketIcon, "shrink-0"))
      from.appendChild(marq(mg.from))
      from.title = mg.from
      const arrow = iconEl(ArrowRight01Icon, "size-3.5 shrink-0 text-muted-foreground")
      const to = document.createElement("span")
      to.className = chip("neutral") + " max-w-42"
      to.appendChild(marq(mg.to || "HEAD"))
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

  /* --- Largeur des colonnes branche et type ---
     Une piste `auto` se dimensionnerait ligne par ligne (chaque ligne est sa propre grille) :
     les colonnes ne s'aligneraient plus. On mesure donc, une fois par chaîne distincte, dans un
     règle hors flux — écritures groupées puis lectures groupées, un seul reflow. Les maxima ne
     font que croître : ni la pagination ni le scroll ne déplacent une colonne. */
  const ruler = document.createElement("div")
  ruler.className = "invisible absolute top-0 left-0 flex"
  const seenType = new Set<string>()
  const seenCell = new Set<string>()
  let scanned = 0
  let typeW = 0
  let cellW = 0 // largeur auto de la colonne branche : la cellule rendue la plus large

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

  /** signature d'une cellule branche : deux commits qui rendent les mêmes chips ont la même largeur */
  const cellSig = (refs: RefChip[]) => refs.map((r) => r.kind + r.name + (r.remotes.length ? "~" : "")).join(",")

  /** Pose `--gg-type`, remonte `--gg-branch` (cf. onBranchWidth) et renvoie la place des deux colonnes. */
  function measureCols() {
    const types: string[] = []
    /* La colonne branche est en auto-width : on mesure la vraie cellule (chips réels + "+N", nuage
       compris), pas une somme de maxima indépendants qui la gonflerait. Une signature par cellule
       distincte suffit — mêmes chips, même largeur. */
    const cells: HTMLElement[] = []
    for (; scanned < S.next; scanned++) {
      const c = DATA[scanned]
      const label = parseSubject(c.s).label
      if (label && !seenType.has(label)) seenType.add(label), types.push(label)
      if (!c.r) continue
      const refs = parseRefs(c.r)
      const sig = cellSig(refs)
      if (seenCell.has(sig)) continue
      seenCell.add(sig)
      const cell = document.createElement("div")
      cell.className = "flex items-center gap-1.5"
      refGroup(refs, BRANCH_BUDGET, BRANCH_MAX, cell)
      cells.push(cell)
    }
    if (types.length) typeW = Math.max(typeW, widest(types, TYPE_MAX))
    if (cells.length) {
      ruler.replaceChildren(...cells)
      inner.appendChild(ruler)
      cellW = Math.max(cellW, ...cells.map((el) => el.offsetWidth))
      ruler.remove()
    }

    const type = typeW && typeW + GAP
    const branch = cellW && cellW + 2 * GAP // px-2.5 de la cellule
    inner.style.setProperty("--gg-type", type + "px")
    cb.onBranchWidth(branch)
    return type + branch
  }

  /* Les chips sont mesurés à la police réelle. Tant que Geist n'a pas remplacé le fallback,
     les largeurs sont fausses : une seule reprise suffit à les asseoir. */
  document.fonts.ready.then(() => {
    if (!svg.isConnected) return
    seenType.clear()
    seenCell.clear()
    scanned = typeW = cellW = 0
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

  /* Ne rejette jamais : un `git log` qui échoue (timeout, verrou de gc) laisse DATA en l'état
     et libère `fetching` pour que le prochain déclencheur retente — sinon la promesse rejetée
     resterait en place et la pagination serait morte jusqu'au reset. Les boucles d'appel
     détectent l'absence de progrès et abandonnent leur tour plutôt que de marteler git. */
  async function fetchMore() {
    if (exhausted) return
    if (!fetching) {
      const g = gen
      fetching = api.log(rawLoaded, PAGE).then(
        (page) => {
          if (g !== gen) return // reset entre-temps : page obsolète
          rawLoaded += page.length
          DATA.push(...collapsePairs(page)) // fusionne les paires release/hotfix de la page
          if (page.length < PAGE) exhausted = true
          fetching = null
        },
        () => {
          if (g === gen) fetching = null
        }
      )
    }
    return fetching
  }

  /** await fetchMore() avec détection de panne : `false` si rien n'est arrivé (échec de la page) */
  async function fetchProgress() {
    const before = DATA.length
    await fetchMore()
    return exhausted || DATA.length > before
  }

  function sync() {
    if (destroyed) return // l'overlay n'est plus dans le SVG : insertBefore échouerait
    const c0 = Math.max(0, Math.floor(board.scrollTop / (CHUNK * ROW)) - 1)
    const c1 = Math.min(NCHUNKS - 1, Math.floor((board.scrollTop + board.clientHeight) / (CHUNK * ROW)) + 1)
    const need = (c1 + 1) * CHUNK
    if (S.next < Math.min(need, DATA.length)) {
      while (S.next < Math.min(need, DATA.length)) layoutChunk(S, DATA)
      refresh()
    }
    /* on ne rechaîne sync() que si des données sont arrivées : en cas d'échec, pas de boucle
       de retentative — le prochain scroll suffira à relancer */
    if (need > DATA.length && !exhausted) {
      const before = DATA.length
      fetchMore()!.then(() => {
        if (DATA.length > before || exhausted) sync()
      })
    }
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

  function clearGhost() {
    ghostEl?.remove()
    ghostEl = null
  }

  function clearHover() {
    hovered = null
    clearGhost()
    cb.onHover(null)
  }

  /* Marquee de chip : mesuré une fois à l'entrée, avant que `gg-marqrun` ne libère la largeur. */
  let marqEl: HTMLElement | null = null
  function clearMarq() {
    if (!marqEl) return
    marqEl.classList.remove("gg-marqrun")
    marqEl.style.removeProperty("--marq")
    marqEl = null
  }
  function marqOver(el: HTMLElement | null) {
    if (el === marqEl) return
    clearMarq()
    if (el && el.scrollWidth > el.clientWidth) {
      el.style.setProperty("--marq", el.clientWidth - el.scrollWidth + "px")
      el.classList.add("gg-marqrun")
      marqEl = el
    }
  }

  /* Refs de branche posées sur une ligne, au rang parseRefs (HEAD, locales, distantes) ; la
     distante synchronisée est absorbée par sa locale. `kind` aligné sur GitRef pour que le
     sidebar retrouve sa ligne. */
  const refChips = (row: number) =>
    parseRefs(DATA[row].r)
      .filter((c) => c.kind !== "tag")
      .map((c) => ({ name: c.name, kind: c.kind === "remote" ? ("remote" as const) : ("head" as const) }))

  /* Branches auxquelles appartient le tip : ses refs vivantes, sinon celle que le commit de merge
     a absorbée (`mergedBy` → `from`). Sans ce repli, une branche mergée puis supprimée — la
     majorité de l'historique — n'a plus aucun nom en local et le ghost ne s'afficherait jamais. */
  function tipBranches(tip: number) {
    const own = refChips(tip)
    if (own.length) return own
    const mrow = S.mergedBy.get(DATA[tip].h)
    const src = mrow !== undefined ? mergeSource(DATA[mrow].s) : null
    return src ? [{ name: src, kind: "head" as const }] : []
  }

  /* Le survol ne surligne plus la chaîne : il nomme la branche du commit. Le statut la décrit
     (chainInfo), et la colonne branche reçoit un chip fantôme si elle est vide — sinon la ligne
     est déjà un tip et porte son vrai chip. */
  function hoverRow(i: number) {
    if (i === hovered) return
    hovered = i
    clearGhost()
    const rows = branchChain(S, DATA, i)
    cb.onHover(chainInfo(S, DATA, rows))
    const name = tipBranches(rows[0])[0]?.name
    if (!name) return
    const cell = inner.querySelector<HTMLElement>(`.gg-row[data-i="${i}"] .gg-branchcell`)
    if (!cell || cell.childElementCount) return
    ghostEl = ghostChip(name, laneColor(S.laneOf[rows[0]]))
    cell.appendChild(ghostEl)
  }

  const rowIndex = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".gg-row")
    return el ? Number(el.dataset.i) : null
  }

  /* le panneau est ancré à une ligne : le scroll peut la démonter sous lui */
  const onScroll = () => {
    closeMore()
    clearMarq()
    clearHover() // le scroll démonte la ligne survolée : le chip fantôme part avec elle
    sync()
  }
  const onMouseOver = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    marqOver(t.closest<HTMLElement>(".gg-scroll"))
    const btn = t.closest<HTMLElement>(".gg-more-btn")
    if (btn) {
      cancelClose()
      if (btn !== openBtn) openMore(btn)
    } else if (t.closest(".gg-more")) cancelClose() // sur le panneau : on le garde ouvert
    const i = rowIndex(ev)
    if (i !== null) hoverRow(i)
  }
  /* Quitter le bouton ou le panneau vers l'extérieur arme la fermeture ; y revenir l'annule. */
  const onMouseOut = (ev: MouseEvent) => {
    if (!openBtn) return
    const from = (ev.target as HTMLElement).closest(".gg-more-btn, .gg-more")
    if (!from) return
    const to = ev.relatedTarget as HTMLElement | null
    if (!to || !to.closest(".gg-more-btn, .gg-more")) scheduleClose()
  }
  const onMouseLeave = () => {
    clearHover()
    clearMarq()
    closeMore()
  }
  const onKeyDown = (ev: KeyboardEvent) => {
    if (ev.key === "Escape") closeMore()
  }
  const onClick = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    if (t.closest(".gg-more, .gg-more-btn")) return // le panneau s'ouvre au survol : le clic ne sélectionne pas
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
  inner.addEventListener("mouseout", onMouseOut)
  inner.addEventListener("click", onClick)
  inner.addEventListener("dblclick", onDblClick)
  document.addEventListener("keydown", onKeyDown)

  return {
    async reset() {
      const g = ++gen
      DATA = []
      rawLoaded = 0
      fetching = null
      TOTAL = await api.total()
      if (g !== gen || destroyed) return // destroy() ou reset concurrent pendant l'attente
      exhausted = TOTAL === 0
      NCHUNKS = Math.max(1, Math.ceil(TOTAL / CHUNK))
      S = createState(NCHUNKS)
      selection = new Set()
      remount()
      board.scrollTop = 0
      clearHover()
      closeMore()
      await fetchMore()
      if (g !== gen || destroyed) return
      layoutChunk(S, DATA)
      refresh()
      sync()
    },

    async jumpTo(hash: string) {
      while (!S.rowOf.has(hash) && (S.next < DATA.length || !exhausted)) {
        if (S.next < DATA.length) layoutChunk(S, DATA)
        else if (!(await fetchProgress())) return // page en échec : on renonce au saut
      }
      const row = S.rowOf.get(hash)
      if (row === undefined) return
      reveal(row)
    },

    async rowsOf(hashes) {
      const rows: number[] = []
      for (const h of hashes) {
        while (!S.rowOf.has(h) && (S.next < DATA.length || !exhausted)) {
          if (S.next < DATA.length) layoutChunk(S, DATA)
          else if (!(await fetchProgress())) return rows // page en échec : résultat partiel
        }
        const r = S.rowOf.get(h)
        if (r !== undefined) rows.push(r)
      }
      return rows
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
        while (i >= DATA.length && !exhausted) if (!(await fetchProgress())) return null
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
    branchesOf: (row) => {
      const own = refChips(row)
      return own.length ? own : tipBranches(branchChain(S, DATA, row)[0])
    },
    laneColor: (row) => laneColor(S.laneOf[row]),

    headDot(headSha) {
      const row = headSha === null ? undefined : S.rowOf.get(headSha)
      const lane = row === undefined ? undefined : S.laneOf[row]
      return lane === undefined ? null : { left: X(lane), color: laneColor(lane) }
    },

    destroy() {
      destroyed = true
      gen++
      clearTimeout(moreTimer)
      board.removeEventListener("scroll", onScroll)
      board.removeEventListener("mouseleave", onMouseLeave)
      inner.removeEventListener("mouseover", onMouseOver)
      inner.removeEventListener("mouseout", onMouseOut)
      inner.removeEventListener("click", onClick)
      inner.removeEventListener("dblclick", onDblClick)
      document.removeEventListener("keydown", onKeyDown)
      mountedG.forEach((g) => g.remove())
      mountedRows.forEach((d) => d.remove())
      more.remove()
      overlay.remove()
    },
  }
}
