/* Fabriques DOM des lignes du graphe (AUDIT.md §6) : une ligne = une grille de chips (branche,
   type, sujet, auteur, date, hash) plus les colonnes de mesure. Rendu impératif, comme avant ce
   refactor — React possède la coquille (react/commit-graph.tsx), pas ces lignes. */

import { ArrowRight01Icon, CloudIcon, Fire02Icon, RocketIcon, Tag01Icon } from "@hugeicons/core-free-icons"

import type { Commit } from "../../../../../shared/types.ts"
import { avatarUrl, initials, tint } from "@/lib/avatar"
import { iconEl } from "./icon-el.ts"
import { badgeSeparator, badgeVariants, type BadgeColor } from "@/components/ui/badge"
import {
  BACKUP_WIP, parseMerge, parseRefs, parseSubject, refColor, typeColor,
  type ParsedMerge, type RefChip,
} from "@/lib/commit-parse"
import { mergeColor, mergeFlow, SEMVER, tagFlowColor, type FlowKind } from "@/lib/gitflow"
import { scrollText } from "../interactions/scroll-text.ts"
import { BRANCH_BUDGET, BRANCH_MAX, GRID_COLS, laneColor, ROW, ROW_CLASS, TYPE_MAX } from "../constants.ts"
import type { LayoutState } from "../layout/state.ts"
import { hashOfId, idOf, shortHash } from "../ids.ts"

export const chip = (color: BadgeColor) => badgeVariants({ color, shape: "squared" })
export const cloud = () => iconEl(CloudIcon, "shrink-0")
export const tagIcon = () => iconEl(Tag01Icon, "shrink-0")

/* Chip fantôme du survol : le nom de la branche à laquelle appartient le commit survolé, posé dans
   la colonne branche quand elle est vide. Contour pointillé, estompé — un rappel, pas une ref réelle.
   Sans `color`, la teinte vient du porteur (le panneau "+N" pose la sienne). */
export function ghostChip(name: string, color: string, maxw = BRANCH_MAX) {
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
export function ghostChips(names: string[], color: string) {
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

/* Le nuage dit où est la distante. Détaché du nom par un filet : « ici aussi ». Collé à un nom
   complet (`origin/develop`) : « la branche locale est ailleurs ». Une branche sans nuage
   n'a pas de distante du tout. */
export function refChip(r: RefChip, maxw: string, flow: FlowKind | null = null) {
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
export function refGroup(refs: RefChip[], budget: number, maxw: string, parent: HTMLElement, flow: FlowKind | null = null) {
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
function rowFlow(S: LayoutState, c: Commit, mg: ParsedMerge | null): FlowKind | null {
  if (!mg) return null
  const own = mergeFlow(mg)
  if (!mg.tag) return own
  /* le merge parsé du parent vit dans l'état de layout : pas besoin que sa page soit résidente.
     `idOf` rend `undefined` pour un parent hors fenêtre (page pas encore chargée) — aucun id
     n'a alors été interné pour son hash. */
  const pid = idOf(S.ids, c.p[1])
  const pr = pid !== undefined ? S.rowOf.get(pid) : undefined
  const pmg = pr !== undefined ? S.mergeOf.get(pr) : undefined
  return pmg && mergeFlow(pmg) === "hotfix" ? "hotfix" : own
}

export function rowDiv(S: LayoutState, i: number, c: Commit, selected: boolean, matched: boolean | null): HTMLDivElement {
  const row = document.createElement("div")
  row.className = ROW_CLASS
  row.style.setProperty("--gg-cols", GRID_COLS)
  row.dataset.i = String(i)
  row.dataset.selected = String(selected)
  if (matched !== null) row.dataset.match = String(matched)
  /* hérité par les chips `lane` de la ligne — les noms de branche portent la couleur du trait */
  row.style.setProperty("--badge-color", laneColor(S.laneOf[i]))

  /* Motif release/hotfix : la ligne porte un accent latéral (cf. app.css) et sa teinte irrigue
     le chip source du merge comme le drapeau du tag. */
  const mg = c.p.length > 1 ? parseMerge(c.s) : null
  const flow = c.cap ? c.cap.flow : rowFlow(S, c, mg)
  if (flow) row.dataset.flow = flow
  if (c.stash) row.dataset.stash = ""

  /* Colonne branche, à gauche du métro : nom(s) de branche puis tags, repliés au budget.
     Une capsule y met sa version en tête ; sinon le survol y pose un chip fantôme (cf. hover.ts). */
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

  /* La colonne hash affiche 8 caractères : la troncature à l'affichage, cf. AUDIT.md §6 (fix
     B1) — l'identité du graphe (rowOf, pending, sélection) reste en SHA complet. */
  for (const [cls, val] of [
    ["pe-2.5 text-muted-foreground tabular-nums", c.d],
    ["font-mono text-muted-foreground tabular-nums", shortHash(hashOfId(S.ids, S.hashOf[i]))],
  ] as const) {
    const el = document.createElement("span")
    el.className = cls
    el.textContent = val
    row.appendChild(el)
  }
  return row
}

/** Un bucket de lignes HTML (cf. constants.ts ROW_BUCKET) : un seul conteneur positionné,
    des lignes en flux normal dedans — comme l'ancien conteneur par CHUNK, mais dimensionné sur
    le viewport réel plutôt que sur la granularité du layout (AUDIT.md §6, item perf). Une ligne
    dont le commit n'est pas résident (page évincée) est omise — l'appelant ne construit un
    bucket qu'une fois ses pages garanties résidentes (cf. controller.ts). */
export function rowBucket(
  S: LayoutState,
  start: number,
  end: number,
  commitAt: (row: number) => Commit | undefined,
  selection: ReadonlySet<number>,
  matches: ReadonlySet<number> | null
): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "absolute inset-x-0"
  div.style.top = start * ROW + "px"
  for (let i = start; i < end; i++) {
    const c = commitAt(i)
    if (!c) continue
    const matched = matches ? matches.has(S.hashOf[i]) : null
    div.appendChild(rowDiv(S, i, c, selection.has(i), matched))
  }
  return div
}
