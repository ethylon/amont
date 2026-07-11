import { ArrowRight01Icon, CloudIcon, Fire02Icon, RocketIcon, Tag01Icon } from "@hugeicons/core-free-icons"

import { type Commit, type RepoApi } from "@/lib/git"
import { avatarUrl, initials, tint } from "@/lib/avatar"
import { iconEl } from "@/lib/utils"
import { badgeSeparator, badgeVariants } from "@/components/ui/badge"
import {
  BACKUP_WIP, mergeColor, mergeFlow, parseMerge, parseRefs, parseSubject, refColor,
  SEMVER, tagFlowColor, typeColor,
  type BadgeColor, type FlowKind, type ParsedMerge, type RefChip,
} from "@/lib/commit-message"
import {
  branchChain, branchSegment, chainInfo, collapsePairs, createState, edgePath, edgesSvg, hkey,
  laneColor, layoutChunk, nodesSvg, stroke, CHUNK, PAGE, ROW, PAD, LANE, X,
  type LayoutState,
} from "@/lib/graph-layout"
import { scrollText, scrollTextHover, scrollTextStop } from "@/components/scroll-text"

/* Rendu impératif, délibérément : montage et démontage direct des <g> SVG par chunks de
   500 lignes. React ne gagnerait rien à repasser par un VDOM ici, et perdrait le contrôle
   fin du scroll. React possède la coquille, pas ce canvas.

   Virtualisation à deux étages : le DOM ne monte que les chunks visibles, et les commits
   eux-mêmes vivent dans un cache de pages borné (RESIDENT) — une page évincée se recharge
   par le même `git log --skip` qui l'a produite. Seul l'état de layout persiste pour tout
   l'historique, sous forme compacte (cf. graph-layout). */

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

/* ponytail: plafond de la colonne métro — au-delà, les lanes profondes sont rognées par le
   viewport du SVG plutôt que de pousser le sujet hors champ */
const MAX_LANES = 12

/* Fenêtre résidente du cache de commits : au-delà, les pages les moins récemment touchées sont
   libérées — hors pages sous le viewport ou sous la sélection, que le panneau de détail lit en
   synchrone. La géométrie (layout) persiste, elle : seuls les textes se rechargent. */
const RESIDENT = 12

const chip = (color: BadgeColor) => badgeVariants({ color, shape: "squared" })
const cloud = () => iconEl(CloudIcon, "shrink-0")
const tagIcon = () => iconEl(Tag01Icon, "shrink-0")

/* Chip fantôme du survol : le nom de la branche à laquelle appartient le commit survolé, posé dans
   la colonne branche quand elle est vide. Contour pointillé, estompé — un rappel, pas une ref réelle.
   Sans `color`, la teinte vient du porteur (le panneau "+N" pose la sienne). */
function ghostChip(name: string, color: string, maxw = BRANCH_MAX) {
  const el = document.createElement("span")
  el.className =
    badgeVariants({ color: "lane", shape: "squared", variant: "outline" }) + " border-dashed opacity-70 " + maxw
  if (color) el.style.setProperty("--badge-color", color)
  el.appendChild(scrollText(name))
  return el
}

/* Plusieurs branches peuvent se partager le tip (branche vide posée sur master : le commit
   appartient aux deux) : la première en chip, les autres derrière un "+N" au même contour
   pointillé. Il porte `gg-more-btn` : le survol le déplie dans le panneau flottant, comme les
   vraies refs — `data-ghost` transporte les noms, un saut de ligne étant impossible dans une ref. */
function ghostChips(names: string[], color: string) {
  const wrap = document.createElement("span")
  wrap.className = "flex min-w-0 items-center gap-1.5"
  wrap.appendChild(ghostChip(names[0], color))
  if (names.length > 1) {
    const more = document.createElement("button")
    more.type = "button"
    more.className =
      badgeVariants({ color: "neutral", shape: "squared", variant: "outline" }) +
      " border-dashed opacity-70 gg-more-btn cursor-pointer"
    more.textContent = `+${names.length - 1}`
    more.dataset.ghost = names.slice(1).join("\n")
    more.setAttribute("aria-expanded", "false")
    wrap.appendChild(more)
  }
  return wrap
}

/* Jumeau impératif de `<Avatar>` : l'image recouvre le monogramme, un 404 la retire.
   Une ligne du graphe n'est jamais recyclée — la retirer suffit, rien ne la remontera. */
function avatarEl(name: string, email: string) {
  const el = document.createElement("span")
  el.className =
    "relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-full " +
    "text-[0.5rem] font-medium text-background ring-1 ring-foreground/10"
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

/** Surface flottante du projet (cf. `dialog`, `command`). Bornée en hauteur : un commit très
    décoré (dizaines de tags) scrolle dans le panneau au lieu de dépasser la fenêtre. */
const MORE_CLASS =
  "gg-more absolute z-20 hidden max-h-[min(50vh,20rem)] w-max max-w-72 flex-col items-start gap-1 overflow-y-auto " +
  "rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/10"

export type Stats = { loaded: number; total: number; ms: number }

export type GraphCallbacks = {
  onSelect(row: number, additive: boolean): void
  onBranchSelect(row: number): void
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
  /** ramène en résidence les pages de commits couvrant ces lignes — à appeler avant de poser
      une sélection étendue, dont le détail lira `commit(row)` en synchrone */
  pin(rows: number[]): Promise<void>
  /** commit d'une ligne, `undefined` si sa page de cache a été évincée (cf. `pin`) */
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
  /* Cache de pages de commits — la « vraie » virtualisation. Une page = une page brute de
     `api.log` (PAGE commits), repliée puis collapsée ; `rowStart` ancre ses lignes dans le
     graphe. L'ordre d'insertion de la Map sert de LRU : `touch` réinsère. */
  type Page = { commits: Commit[]; rowStart: number }
  let pages = new Map<number, Page>()
  /* rowStart de chaque page brute consommée, croissant (une page vidée par le repli duplique
     celui de la suivante — la recherche prend la plus à droite) */
  let pageRows: number[] = []
  let nPages = 0
  let refetching = new Map<number, Promise<boolean>>()
  let TOTAL = 0
  let NCHUNKS = 0
  let exhausted = false
  let fetching: Promise<void> | null = null
  let gen = 0 // invalide les fetchs en vol après un reset
  let destroyed = false // un reset en vol pendant destroy() (double montage StrictMode) ne doit plus toucher le DOM
  let S: LayoutState = createState(1)
  let selection = new Set<number>()
  let matches: Set<number> | null = null // hkeys des commits en surbrillance de recherche
  let hovered: number | null = null
  let ghostEl: HTMLElement | null = null
  /* Stash : hash → nom d'entrée, et hashes de plomberie (index, non suivis) à replier.
     Relus à chaque reset, comme le total — la liste bouge avec push/pop/drop. */
  let stashOf = new Map<string, string>()
  let plumbing = new Set<string>()

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
    if (btn.dataset.ghost !== undefined) {
      /* "+N" fantôme : les autres branches du tip, en chips fantômes — pas des refs de la ligne */
      more.replaceChildren(...btn.dataset.ghost.split("\n").map((n) => ghostChip(n, "", "max-w-full")))
    } else {
      const c = commitAt(Number(row.dataset.i))
      if (!c) return // la ligne est montée donc résidente ; pure défense
      const refs = parseRefs(c.r).slice(Number(btn.dataset.n))
      const flow = (row.dataset.flow as FlowKind) || null
      more.replaceChildren(...refs.map((r) => refChip(r, "max-w-full", flow)))
    }
    /* le panneau flotte sous `inner`, pas sous la ligne : la teinte de lane ne peut pas hériter */
    more.style.setProperty("--badge-color", row.style.getPropertyValue("--badge-color"))

    const b = btn.getBoundingClientRect()
    const box = inner.getBoundingClientRect() // se déplace avec le scroll, comme `more`
    more.style.left = b.left - box.left + "px"
    more.style.top = b.bottom - box.top + 4 + "px"
    more.classList.replace("hidden", "flex")
    /* mesuré une fois visible : un "+N" près du bord droit rabat le panneau dans la zone visible
       du board au lieu d'étendre son scroll horizontal */
    const maxLeft = board.scrollLeft + board.clientWidth - more.offsetWidth - 4
    if (b.left - box.left > maxLeft) more.style.left = Math.max(0, maxLeft) + "px"
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
    el.appendChild(scrollText(r.name))
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
    /* le merge parsé du parent vit dans l'état de layout : pas besoin que sa page soit résidente */
    const pr = S.rowOf.get(hkey(c.p[1]))
    const pmg = pr !== undefined ? S.mergeOf.get(pr) : undefined
    return pmg && mergeFlow(pmg) === "hotfix" ? "hotfix" : own
  }

  function rowDiv(i: number) {
    const c = commitAt(i)! // sync ne monte un chunk de lignes que pages résidentes
    const row = document.createElement("div")
    row.className = ROW_CLASS
    row.dataset.i = String(i)
    row.dataset.selected = String(selection.has(i))
    if (matches) row.dataset.match = String(matches.has(S.hashOf[i]))
    /* hérité par les chips `lane` de la ligne — les noms de branche portent la couleur du trait */
    row.style.setProperty("--badge-color", laneColor(S.laneOf[i]))

    /* Motif release/hotfix : la ligne porte un accent latéral (cf. app.css) et sa teinte irrigue
       le chip source du merge comme le drapeau du tag. */
    const mg = c.p.length > 1 ? parseMerge(c.s) : null
    const flow = c.cap ? c.cap.flow : rowFlow(c, mg)
    if (flow) row.dataset.flow = flow
    if (c.stash) row.dataset.stash = ""

    /* Colonne branche, à gauche du métro : nom(s) de branche puis tags, repliés au budget.
       Une capsule y met sa version en tête ; sinon le survol y pose un chip fantôme (cf. hoverRow). */
    const refs = c.r ? parseRefs(c.r) : []
    const branch = document.createElement("div")
    branch.className = "gg-branchcell flex min-w-0 items-center gap-1.5 px-2.5"
    if (c.cap) {
      const v = document.createElement("span")
      v.className = chip(tagFlowColor(c.cap.flow)) + " " + BRANCH_MAX
      v.appendChild(tagIcon())
      v.appendChild(scrollText(c.cap.version ?? c.cap.from))
      v.title = c.cap.version ?? c.cap.from
      branch.appendChild(v)
    } else if (c.stash) {
      /* Contour pointillé plein régime : une vraie entrée, pas un fantôme de survol. */
      const v = document.createElement("span")
      v.className =
        badgeVariants({ color: "lane", shape: "squared", variant: "outline" }) + " border-dashed " + BRANCH_MAX
      v.appendChild(scrollText(c.stash.name))
      v.title = c.stash.name
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
      b.appendChild(scrollText(ps.label))
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
      from.appendChild(scrollText(c.cap.from))
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
        tc.appendChild(scrollText(t))
        tc.title = t
        subj.appendChild(tc)
      })
    } else if (mg) {
      if (mg.noise) row.classList.add("opacity-45")
      subj.title = c.s
      const from = document.createElement("span")
      from.className = chip(flow ? tagFlowColor(flow) : mergeColor(mg)) + " max-w-42"
      if (flow) from.appendChild(iconEl(flow === "hotfix" ? Fire02Icon : RocketIcon, "shrink-0"))
      from.appendChild(scrollText(mg.from))
      from.title = mg.from
      const arrow = iconEl(ArrowRight01Icon, "size-3.5 shrink-0 text-muted-foreground")
      const to = document.createElement("span")
      to.className = chip("neutral") + " max-w-42"
      to.appendChild(scrollText(mg.to || "HEAD"))
      to.title = mg.to || ""
      subj.append(from, arrow, to)
    } else {
      const s = scrollText(ps.text)
      /* l'italique dit le provisoire : ce sujet n'est pas un message de commit choisi */
      if (c.stash) s.className += " italic text-muted-foreground"
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
  let typeW = 0
  let cellW = 0 // largeur auto de la colonne branche : la cellule rendue la plus large
  /* files de mesure, consommées par measureCols ; les sources distinctes persistent (petites :
     types et cellules décorées uniques) pour re-mesurer quand la police réelle arrive —
     les pages de commits, elles, ont pu être évincées entre-temps */
  let queueTypes: string[] = []
  let queueCells: RefChip[][] = []
  let queueStash: string[] = []
  const allTypes: string[] = []
  const allCells: string[] = [] // refs brutes des cellules distinctes, re-parsées à la re-mesure

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

  /** Alimente les files de mesure avec ce que la page apporte de nouveau (types, cellules). */
  function scanPage(commits: Commit[]) {
    for (const c of commits) {
      const label = parseSubject(c.s).label
      if (label && !seenType.has(label)) {
        seenType.add(label)
        queueTypes.push(label)
        allTypes.push(label)
      }
      if (!c.r) continue
      const refs = parseRefs(c.r)
      const sig = cellSig(refs)
      if (seenCell.has(sig)) continue
      seenCell.add(sig)
      queueCells.push(refs)
      allCells.push(c.r)
    }
  }

  /** Pose `--gg-type`, remonte `--gg-branch` (cf. onBranchWidth) et renvoie la place des deux colonnes. */
  function measureCols() {
    if (queueTypes.length) {
      typeW = Math.max(typeW, widest(queueTypes, TYPE_MAX))
      queueTypes = []
    }
    /* le chip de stash occupe la colonne branche sans passer par les refs : sans cette
       mesure, un dépôt aux branches courtes le rognerait */
    if (queueStash.length) {
      cellW = Math.max(cellW, widest(queueStash, BRANCH_MAX))
      queueStash = []
    }
    /* La colonne branche est en auto-width : on mesure la vraie cellule (chips réels + "+N", nuage
       compris), pas une somme de maxima indépendants qui la gonflerait. Une signature par cellule
       distincte suffit — mêmes chips, même largeur. */
    if (queueCells.length) {
      const cells = queueCells.map((refs) => {
        const cell = document.createElement("div")
        cell.className = "flex items-center gap-1.5"
        refGroup(refs, BRANCH_BUDGET, BRANCH_MAX, cell)
        return cell
      })
      ruler.replaceChildren(...cells)
      inner.appendChild(ruler)
      cellW = Math.max(cellW, ...cells.map((el) => el.offsetWidth))
      ruler.remove()
      queueCells = []
    }

    const type = typeW && typeW + GAP
    const branch = cellW && cellW + 2 * GAP // px-2.5 de la cellule
    inner.style.setProperty("--gg-type", type + "px")
    cb.onBranchWidth(branch)
    return type + branch
  }

  /* Les chips sont mesurés à la police réelle. Tant que Geist n'a pas remplacé le fallback,
     les largeurs sont fausses : une seule reprise, depuis les sources persistées, suffit. */
  document.fonts.ready.then(() => {
    if (!svg.isConnected) return
    typeW = cellW = 0
    queueTypes = [...allTypes]
    queueCells = allCells.map(parseRefs)
    queueStash = [...new Set(stashOf.values())]
    refresh()
  })

  function refresh() {
    const graphW = PAD * 2 + Math.min(S.lanes.length, MAX_LANES) * LANE
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

  /* Un stash arrive du log avec ses 2-3 parents (base, index, non suivis). On ne garde que la
     base : l'entrée devient un nœud simple accroché à son commit d'origine, et ses commits de
     plomberie — invisibles ailleurs — sont retirés du flux. Le total du serveur les soustrait
     déjà (cf. repo:total). */
  function foldStashes(page: Commit[]) {
    if (!stashOf.size) return page
    const out: Commit[] = []
    for (const c of page) {
      if (plumbing.has(c.h)) continue
      const name = stashOf.get(c.h)
      out.push(name ? { ...c, p: c.p.slice(0, 1), stash: { name, untracked: c.p[2] ?? null } } : c)
    }
    return out
  }

  /** page contenant la ligne : la plus à droite dont le rowStart ne dépasse pas `row` */
  function pageOfRow(row: number) {
    let lo = 0
    let hi = pageRows.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pageRows[mid] <= row) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  /** rafraîchit la position LRU d'une page résidente */
  function touch(pi: number) {
    const p = pages.get(pi)
    if (p) {
      pages.delete(pi)
      pages.set(pi, p)
    }
  }

  function commitAt(row: number): Commit | undefined {
    const p = pages.get(pageOfRow(row))
    return p && p.commits[row - p.rowStart]
  }

  /** toutes les pages couvrant [r0, r1] sont résidentes ; les touche au passage (LRU) */
  function resident(r0: number, r1: number) {
    for (let pi = pageOfRow(r0), last = pageOfRow(r1); pi <= last; pi++) {
      if (!pages.has(pi)) return false
      touch(pi)
    }
    return true
  }

  const viewChunks = (): [number, number] => [
    Math.max(0, Math.floor(board.scrollTop / (CHUNK * ROW)) - 1),
    Math.min(NCHUNKS - 1, Math.floor((board.scrollTop + board.clientHeight) / (CHUNK * ROW)) + 1),
  ]

  /* ponytail: une sélection étalée (segment de tronc entier) épingle toutes ses pages — la borne
     RESIDENT est relâchée le temps de la sélection, elle se resserre quand elle se vide. */
  function evict() {
    if (pages.size <= RESIDENT || !pageRows.length) return
    const pinned = new Set<number>()
    if (S.next > 0) {
      const [c0, c1] = viewChunks()
      const last = Math.min(S.next - 1, (c1 + 1) * CHUNK - 1)
      for (let pi = pageOfRow(c0 * CHUNK), end = pageOfRow(last); pi <= end; pi++) pinned.add(pi)
    }
    selection.forEach((r) => pinned.add(pageOfRow(r)))
    for (const pi of [...pages.keys()]) {
      if (pages.size <= RESIDENT) break
      if (!pinned.has(pi)) pages.delete(pi)
    }
  }

  /* Ne rejette jamais : un `git log` qui échoue (timeout, verrou de gc) laisse le cache en l'état
     et libère `fetching` pour que le prochain déclencheur retente — sinon la promesse rejetée
     resterait en place et la pagination serait morte jusqu'au reset. Les boucles d'appel
     détectent l'absence de progrès et abandonnent leur tour plutôt que de marteler git.
     La page arrivée est mise en page entière sur-le-champ : la géométrie n'attend jamais le
     viewport, seuls les commits sont évincables. */
  async function fetchMore() {
    if (exhausted) return
    if (!fetching) {
      const g = gen
      const pi = nPages
      fetching = api.log(pi * PAGE, PAGE).then(
        (raw) => {
          if (g !== gen) return // reset entre-temps : page obsolète
          const commits = collapsePairs(foldStashes(raw)) // fusionne les paires release/hotfix de la page
          const rowStart = S.next
          pages.set(pi, { commits, rowStart })
          pageRows.push(rowStart)
          nPages++
          if (raw.length < PAGE) exhausted = true
          const end = rowStart + commits.length
          while (S.next < end) layoutChunk(S, (r) => commits[r - rowStart], end)
          /* le total du serveur ignore les capsules du collapse (deux merges → une ligne) :
             à l'épuisement de l'historique, le compte réel de lignes fait foi — sans ça,
             « loaded/total » ne converge jamais sur un dépôt gitflow */
          if (exhausted) TOTAL = S.next
          scanPage(commits)
          evict()
          refresh()
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
    const before = S.next
    await fetchMore()
    return exhausted || S.next > before
  }

  /* Recharge les pages évincées couvrant [r0, r1] (lignes déjà mises en page). Le repli et le
     collapse sont déterministes par page brute : la page revient identique et la géométrie ne
     bouge pas — on ne fait que regarnir les textes. Si le dépôt a bougé sous la page (premier
     hash différent), on ne monte rien de faux : le reset arrive par l'évènement de changement.
     Résout `false` dans ce cas, pour que l'appelant ne reboucle pas. */
  async function ensureRows(r0: number, r1: number): Promise<boolean> {
    let ok = true
    /* séquentiel : un `pin` de segment étalé ne doit pas lancer des dizaines de git en parallèle */
    for (let pi = pageOfRow(r0), last = pageOfRow(r1); pi <= last; pi++) {
      touch(pi)
      if (pages.has(pi)) continue
      let p = refetching.get(pi)
      if (!p) {
        const g = gen
        const rf = refetching // un reset remplace la map : un delete périmé ne doit pas toucher la neuve
        p = api.log(pi * PAGE, PAGE).then(
          (raw) => {
            rf.delete(pi)
            if (g !== gen) return false
            const commits = collapsePairs(foldStashes(raw))
            const rowStart = pageRows[pi]
            const len = (pageRows[pi + 1] ?? S.next) - rowStart
            if (rowStart === undefined || commits.length < len || hkey(commits[0].h) !== S.hashOf[rowStart])
              return false
            pages.set(pi, { commits, rowStart })
            evict()
            return true
          },
          () => {
            rf.delete(pi)
            return false
          }
        )
        refetching.set(pi, p)
      }
      ok = (await p) && ok
    }
    return ok
  }

  function sync() {
    if (destroyed) return // l'overlay n'est plus dans le SVG : insertBefore échouerait
    const [c0, c1] = viewChunks()
    const need = (c1 + 1) * CHUNK
    /* on ne rechaîne sync() que si des données sont arrivées : en cas d'échec, pas de boucle
       de retentative — le prochain scroll suffira à relancer */
    if (need > S.next && !exhausted) {
      const g = gen
      const before = S.next
      fetchMore()!.then(() => {
        if (g === gen && (S.next > before || exhausted)) sync()
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
    /* la géométrie (SVG) est toujours montable — le layout persiste ; les lignes HTML exigent
       leurs commits : un trou de cache se recharge puis re-sync, le métro reste visible en
       attendant les textes */
    let missing: [number, number] | null = null
    for (let ci = c0; ci <= c1 && ci * CHUNK < S.next; ci++) {
      if (!mountedG.has(ci)) {
        const g = chunkG(ci)
        svg.insertBefore(g, overlay)
        mountedG.set(ci, g)
      }
      if (!mountedRows.has(ci)) {
        const r0 = ci * CHUNK
        const r1 = Math.min((ci + 1) * CHUNK, S.next) - 1
        if (resident(r0, r1)) {
          const d = chunkRows(ci)
          inner.appendChild(d)
          mountedRows.set(ci, d)
        } else missing = missing ? [missing[0], r1] : [r0, r1]
      }
    }
    if (missing) {
      const g = gen
      ensureRows(missing[0], missing[1]).then((ok) => {
        if (ok && g === gen) sync()
      })
    }
  }

  function remount() {
    scrollTextStop() // les lignes partent sans mouseleave : la boucle rAF s'arrête avec elles
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
      if (matches) r.dataset.match = String(matches.has(S.hashOf[Number(r.dataset.i)]))
      else delete r.dataset.match
    })
  }

  /* amène une ligne déjà mise en page au centre de l'écran, la sélectionne et la fait clignoter ;
     attend le retour de sa page si elle a été évincée — la sélection lira le commit en synchrone */
  async function reveal(row: number) {
    refresh()
    board.scrollTop = row * ROW - board.clientHeight / 2
    const g = gen
    /* tout le chunk de la ligne : sync ne monte les lignes que par chunk entier résident */
    const ci = Math.floor(row / CHUNK)
    await ensureRows(ci * CHUNK, Math.min((ci + 1) * CHUNK, S.next) - 1)
    if (g !== gen || destroyed) return
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
  }

  /** nœud d'une ligne : un par ligne, poussé dans l'ordre — l'offset dans son chunk suffit */
  const nodeAt = (row: number) => S.nodes[Math.floor(row / CHUNK)][row % CHUNK]

  /* Refs de branche posées sur une ligne, au rang parseRefs (HEAD, locales, distantes) ; la
     distante synchronisée est absorbée par sa locale. `kind` aligné sur GitRef pour que le
     sidebar retrouve sa ligne. Lues dans l'état de layout, indépendant du cache de pages. */
  const refChips = (row: number) =>
    parseRefs(S.refsOf.get(row) ?? "")
      .filter((c) => c.kind !== "tag")
      .map((c) => ({ name: c.name, kind: c.kind === "remote" ? ("remote" as const) : ("head" as const) }))

  /* Branches auxquelles appartient le tip : ses refs vivantes, sinon celle que le commit de merge
     a absorbée (`mergedBy` → `from`). Sans ce repli, une branche mergée puis supprimée — la
     majorité de l'historique — n'a plus aucun nom en local et le ghost ne s'afficherait jamais. */
  function tipBranches(tip: number) {
    const own = refChips(tip)
    if (own.length) return own
    const mrow = S.mergedBy.get(tip)
    const src = mrow !== undefined ? (S.mergeOf.get(mrow)?.from ?? null) : null
    return src ? [{ name: src, kind: "head" as const }] : []
  }

  /* Le survol nomme la branche du commit : la colonne branche reçoit un chip fantôme si elle
     est vide — sinon la ligne est déjà un tip et porte son vrai chip. */
  function hoverRow(i: number) {
    if (i === hovered) return
    hovered = i
    clearGhost()
    if (nodeAt(i).stash) return // un stash porte déjà son chip : ni chaîne à remonter, ni ghost
    const rows = branchChain(S, i)
    const names = tipBranches(rows[0]).map((b) => b.name)
    if (!names.length) return
    const cell = inner.querySelector<HTMLElement>(`.gg-row[data-i="${i}"] .gg-branchcell`)
    if (!cell || cell.childElementCount) return
    ghostEl = ghostChips(names, laneColor(S.laneOf[rows[0]]))
    cell.appendChild(ghostEl)
  }

  const rowIndex = (ev: Event) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".gg-row")
    return el ? Number(el.dataset.i) : null
  }

  /* le panneau est ancré à une ligne : le scroll peut la démonter sous lui */
  const onScroll = () => {
    closeMore()
    scrollTextStop()
    clearHover() // le scroll démonte la ligne survolée : le chip fantôme part avec elle
    sync()
  }
  const onMouseOver = (ev: MouseEvent) => {
    const t = ev.target as HTMLElement
    scrollTextHover(t.closest<HTMLElement>(".gg-scrolltext"))
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
    scrollTextStop()
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
      ++gen // périme les fetchs en vol
      /* la liste de stash et le total voyagent ensemble : les pages qui suivent replient
         la plomberie que le total a déjà soustraite */
      const [total, stashes] = await Promise.all([api.total(), api.stashes().catch(() => [])])
      if (destroyed) return
      /* Ré-init d'un seul tenant, APRÈS l'attente, sous un gen re-bumpé : un scroll pendant
         l'await peut relancer fetchMore — parti sur l'ancien état, il doit être jeté à
         l'arrivée, pas semer une page dans l'état neuf (pageRows désordonné, page 0 sautée,
         arêtes pending jamais résolues → SVG dégénéré à chaque refresh). */
      const g = ++gen
      pages = new Map()
      pageRows = []
      nPages = 0
      fetching = null
      refetching = new Map() // les refetchs en vol vérifient gen, leurs promesses expirent seules
      TOTAL = total
      stashOf = new Map(stashes.map((s) => [s.h, s.name]))
      plumbing = new Set(stashes.flatMap((s) => s.p.slice(1)))
      /* les noms d'entrée passent en colonne branche : mesurés d'emblée, la liste est connue */
      for (const s of stashes) {
        if (seenCell.has(s.name)) continue
        seenCell.add(s.name)
        queueStash.push(s.name)
      }
      exhausted = TOTAL === 0
      NCHUNKS = Math.max(1, Math.ceil(TOTAL / CHUNK))
      S = createState(NCHUNKS)
      selection = new Set()
      remount()
      board.scrollTop = 0
      clearHover()
      closeMore()
      await fetchMore() // met en page et rafraîchit ; sync monte le viewport
      if (g !== gen || destroyed) return
      refresh()
      sync()
    },

    async jumpTo(hash: string) {
      const k = hkey(hash)
      while (!S.rowOf.has(k) && !exhausted) {
        if (!(await fetchProgress())) return // page en échec : on renonce au saut
      }
      const row = S.rowOf.get(k)
      if (row === undefined) return
      await reveal(row)
    },

    async rowsOf(hashes) {
      const rows: number[] = []
      for (const h of hashes) {
        const k = hkey(h)
        while (!S.rowOf.has(k) && !exhausted) {
          if (!(await fetchProgress())) return rows // page en échec : résultat partiel
        }
        const r = S.rowOf.get(k)
        if (r !== undefined) rows.push(r)
      }
      return rows
    },

    async pin(rows) {
      if (!rows.length) return
      await ensureRows(Math.min(...rows), Math.max(...rows))
    },

    setSelection(rows) {
      selection = new Set(rows)
      applySelection()
    },

    setMatches(hashes) {
      matches = hashes && new Set(hashes.map(hkey))
      applyMatches()
    },

    /* balaye les lignes — l'ordre du graphe — en chargeant à la demande : le résultat suivant
       peut vivre plusieurs pages plus bas. Les hash comparés vivent dans l'état de layout. */
    async nextMatch(from, dir) {
      if (!matches?.size) return null
      const g = gen
      for (let i = from + dir; i >= 0; i += dir) {
        while (i >= S.next && !exhausted) if (!(await fetchProgress())) return null
        if (g !== gen || i >= S.next) return null
        if (!matches.has(S.hashOf[i])) continue
        await reveal(i)
        return i
      }
      return null
    },

    commit: (row) => commitAt(row),
    branchSegment: (row) => branchSegment(S, row),
    chainInfo: (rows) => chainInfo(S, rows),
    branchesOf: (row) => {
      if (nodeAt(row).stash) return [] // un stash ne focalise aucune branche du sidebar
      const own = refChips(row)
      return own.length ? own : tipBranches(branchChain(S, row)[0])
    },
    laneColor: (row) => laneColor(S.laneOf[row]),

    headDot(headSha) {
      const row = headSha === null ? undefined : S.rowOf.get(hkey(headSha))
      const lane = row === undefined ? undefined : S.laneOf[row]
      return lane === undefined ? null : { left: X(lane), color: laneColor(lane) }
    },

    destroy() {
      destroyed = true
      gen++
      scrollTextStop() // même raison qu'à remount : le texte survolé part sans mouseleave
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
