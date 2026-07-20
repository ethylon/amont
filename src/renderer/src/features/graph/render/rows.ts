/* DOM factories for graph rows (AUDIT.md §6): a row = a grid of chips (branch,
   type, subject, author, date, hash) plus the measurement columns. Imperative rendering, as before
   this refactor — React owns the shell (react/commit-graph.tsx), not these rows. */

import {
  ArrowRight01Icon,
  CloudIcon,
  Fire02Icon,
  FolderLinksIcon,
  GitPullRequestIcon,
  RocketIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons"

import type { Commit } from "../../../../../shared/types.ts"
import { avatarUrl, githubEmailAvatar, initials, tint } from "@/lib/avatar"
import { worktreeName } from "@/lib/git"
import { messages } from "@/lib/messages"
import { iconEl } from "./icon-el.ts"
import { badgeSeparator, badgeVariants, type BadgeColor } from "@/components/ui/badge"
import {
  BACKUP_WIP,
  isCustomType,
  parseMerge,
  parseRefs,
  parseSubject,
  prefixColorVar,
  refColor,
  typeColor,
  typeIcon,
  type ParsedMerge,
  type RefChip,
} from "@/lib/commit-parse"
import { mergeColor, mergeFlow, SEMVER, tagFlowColor, type FlowKind } from "@/lib/gitflow"
import { getShowPrefixColumn } from "@/lib/customization"
import { scrollText } from "../interactions/scroll-text.tsx"
import { BRANCH_BUDGET, BRANCH_MAX, GRID_COLS, laneColor, ROW, ROW_CLASS, TYPE_MAX } from "../constants.ts"
import type { LayoutState } from "../layout/state.ts"
import type { SyncInfo } from "../layout/sync.ts"
import { hashOfId, idOf, shortHash } from "../ids.ts"

export const chip = (color: BadgeColor) => badgeVariants({ color, shape: "squared" })
/* Sized explicitly: inside a badge `[&>svg]:size-2.5!` already constrains it, but the
   sync marker label (controller.ts) has no such rule — an unsized svg renders huge. */
export const cloud = () => iconEl(CloudIcon, "size-2.5 shrink-0")
export const tagIcon = () => iconEl(Tag01Icon, "shrink-0")

/* Hover ghost chip: the name of the branch the hovered commit belongs to, placed in
   the branch column when it's empty. Dashed outline, faded — a hint, not a real ref.
   Without `color`, the hue comes from the holder (the "+N" panel sets its own). */
export function ghostChip(name: string, color: string, maxw = BRANCH_MAX) {
  const el = document.createElement("span")
  el.className =
    badgeVariants({ color: "lane", shape: "squared", variant: "outline" }) + " border-dashed opacity-70 " + maxw
  if (color) el.style.setProperty("--badge-color", color)
  el.appendChild(scrollText(name))
  return el
}

/* Open-worktree button (subject column, revealed on row hover via `.amont-wtopen`, cf. app.css):
   a real button — clicking it opens the worktree as a new tab (cf. controller.ts `.amont-wt-open`
   delegation) instead of selecting the row. Outline, folder icon up front: a place on disk. Only
   built for commits that are a linked worktree's HEAD (the main tree is filtered out at ingestion,
   cf. data/loader.ts). `tabIndex=-1`: the same action stays keyboard-reachable through the sidebar. */
export function wtChip(name: string, path: string, maxw = BRANCH_MAX) {
  const el = document.createElement("button")
  el.type = "button"
  el.className =
    badgeVariants({ color: "lane", shape: "squared", variant: "outline" }) + " amont-wt-open cursor-pointer " + maxw
  el.dataset.path = path
  el.title = path
  el.setAttribute("aria-label", messages.worktrees.openWorktree(name))
  el.tabIndex = -1
  el.appendChild(iconEl(FolderLinksIcon, "shrink-0"))
  el.appendChild(scrollText(name))
  return el
}

/* Several branches can share the tip (empty branch sitting on master: the commit
   belongs to both): the first as a chip, the others behind a "+N" with the same dashed
   outline. It carries `amont-more-btn`: hovering unfolds it in the floating panel, like
   real refs — `data-ghost` carries the names, since a line break is impossible within a ref. */
export function ghostChips(names: string[], color: string) {
  const wrap = document.createElement("span")
  wrap.className = "flex min-w-0 items-center gap-1.5"
  wrap.appendChild(ghostChip(names[0], color))
  if (names.length > 1) {
    const more = document.createElement("button")
    more.type = "button"
    more.className =
      badgeVariants({ color: "neutral", shape: "squared", variant: "outline" }) +
      " border-dashed opacity-70 amont-more-btn cursor-pointer"
    more.textContent = `+${names.length - 1}`
    more.dataset.ghost = names.slice(1).join("\n")
    more.setAttribute("aria-expanded", "false")
    more.setAttribute("aria-haspopup", "true")
    more.setAttribute("aria-label", messages.graph.extraBranchesOnTip(names.length - 1))
    /* hover ghost (AUDIT.md §8): only exists in the DOM during a mouse hover — never
       a keyboard cursor on it, so outside the tab order (unlike the real "+N" of
       `refGroup`, whose tabindex follows the active row, cf. interactions/selection.ts). */
    more.tabIndex = -1
    wrap.appendChild(more)
  }
  return wrap
}

/* Imperative twin of `<Avatar>`: the image overlays the monogram, a 404 removes it, and GitHub's
   e-mail lookup gets the same second chance — resolved, the image is re-attached with the new
   source. A graph row is never recycled, so nothing else will remount it. */
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
    img.onerror = () => {
      img.remove()
      /* `src !== url` breaks the cycle if the looked-up source itself errors: the cached
         lookup then answers with the URL already in place, and the image stays removed. */
      void githubEmailAvatar(email).then((url) => {
        if (url && img.src !== url) {
          img.src = url
          el.appendChild(img)
        }
      })
    }
    el.appendChild(img)
  }
  return el
}

/* The cloud says where the remote is. Detached from the name by a separator: "here too". Stuck to a
   full name (`origin/develop`): "the local branch is elsewhere". A branch without a cloud
   has no remote at all. */
export function refChip(r: RefChip, maxw: string, flow: FlowKind | null = null) {
  const synced = r.remotes.length > 0
  /* A version tag is a release's milestone: label icon + flow hue (purple/red). */
  const version = r.kind === "tag" && SEMVER.test(r.name)
  const el = document.createElement("span")
  el.className =
    chip(version ? tagFlowColor(flow) : refColor(r.kind)) +
    " " +
    maxw +
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

/** A group's refs, truncated to `budget`, the rest behind a "+N" that unfolds them all.
    `active`: the holding row is the roving tabindex's active row (AUDIT.md §8) — only its
    "+N", if it exists, enters the tab order; the others stay at `tabindex=-1`,
    otherwise they'd pollute Tab with one stop per mounted row instead of a single one per active row. */
export function refGroup(
  refs: RefChip[],
  budget: number,
  maxw: string,
  parent: HTMLElement,
  flow: FlowKind | null = null,
  active = false
) {
  for (const r of refs.slice(0, budget)) parent.appendChild(refChip(r, maxw, flow))
  const hidden = refs.slice(budget)
  if (!hidden.length) return
  const btn = document.createElement("button")
  btn.type = "button"
  btn.className = chip("neutral") + " amont-more-btn cursor-pointer" // a counter, not a ref: no hue
  btn.dataset.n = String(budget) // slice bound for openMore
  btn.textContent = `+${hidden.length}`
  btn.title = hidden.map((r) => r.name).join(", ")
  btn.setAttribute("aria-expanded", "false")
  btn.setAttribute("aria-haspopup", "true")
  btn.setAttribute("aria-label", messages.graph.extraRefsCount(hidden.length))
  btn.tabIndex = active ? 0 : -1
  parent.appendChild(btn)
}

/* A row's flow. A `hotfix/*`|`release/*` merge can be read from its subject; but "Merge tag 'vX'
   into develop" brings in a version without saying where it came from. We then climb back to the
   tagged commit (2nd parent, the master-side merge): if it's a hotfix, this re-merge is one too.
   Without this, a hotfix's return to develop would pass for a release. */
function rowFlow(S: LayoutState, c: Commit, mg: ParsedMerge | null): FlowKind | null {
  if (!mg) return null
  const own = mergeFlow(mg)
  if (!mg.tag) return own
  /* the parent's parsed merge lives in the layout state: no need for its page to be resident.
     `idOf` returns `undefined` for a parent outside the window (page not yet loaded) — no id
     has been interned for its hash in that case. */
  const pid = idOf(S.ids, c.p[1])
  const pr = pid !== undefined ? S.rowOf.get(pid) : undefined
  const pmg = pr !== undefined ? S.mergeOf.get(pr) : undefined
  return pmg && mergeFlow(pmg) === "hotfix" ? "hotfix" : own
}

/* Accessible name of a row: its visual columns (truncated chips, silent icons, shortened
   hash) don't add up to a sentence readable end to end — an explicit summary is better than
   concatenating the visible text for a screen reader (AUDIT.md §8). */
function rowLabel(c: Commit): string {
  return `${parseSubject(c.s).text} — ${c.a}, ${c.d}, ${shortHash(c.h)}`
}

export function rowDiv(
  S: LayoutState,
  i: number,
  c: Commit,
  selected: boolean,
  matched: boolean | null,
  active: boolean,
  total: number,
  sync?: SyncInfo | null
): HTMLDivElement {
  const row = document.createElement("div")
  row.className = ROW_CLASS
  row.style.setProperty("--amont-cols", GRID_COLS)
  row.dataset.i = String(i)
  row.dataset.selected = String(selected)
  if (matched !== null) row.dataset.match = String(matched)

  /* ARIA grid (AUDIT.md §8): each row is an "option" of the board's listbox (cf.
     react/commit-graph.tsx). `aria-selected`/`tabindex` are driven by interactions/selection.ts
     (roving tabindex) — set here at creation so the row is correct from its first
     mount, before any `applySelection()` pass. `aria-posinset`/`aria-setsize` give the
     actual rank in the full history to a screen reader that only sees a virtualized window
     of a few dozen mounted rows. */
  row.setAttribute("role", "option")
  row.setAttribute("aria-selected", String(selected))
  row.setAttribute("aria-posinset", String(i + 1))
  row.setAttribute("aria-setsize", String(total || i + 1))
  row.tabIndex = active ? 0 : -1
  row.setAttribute("aria-label", rowLabel(c))
  /* inherited by the row's `lane` chips — branch names carry the line's color */
  row.style.setProperty("--badge-color", laneColor(S.laneOf[i]))

  /* Release/hotfix pattern: the row carries a side accent (cf. app.css) and its hue flows
     into the merge's source chip as well as the tag's flag. */
  const mg = c.p.length > 1 ? parseMerge(c.s) : null
  const flow = c.cap ? c.cap.flow : rowFlow(S, c, mg)
  if (flow) row.dataset.flow = flow
  if (c.stash) row.dataset.stash = ""
  /* Sync zone (cf. layout/sync.ts): background tint via app.css — amber "to push",
     blue "to pull" — so the lag reads at graph scale, not just per node. */
  if (sync?.ahead.has(i)) row.dataset.sync = "ahead"
  else if (sync?.behind.has(i)) row.dataset.sync = "behind"

  /* Branch column, left of the metro: branch name(s) then tags, folded to the budget.
     A capsule puts its version there up front; otherwise hovering places a ghost chip (cf. hover.ts). */
  const refs = c.r ? parseRefs(c.r) : []
  const branch = document.createElement("div")
  branch.className = "amont-branchcell flex min-w-0 items-center gap-1.5 px-2.5"
  if (c.cap) {
    const v = document.createElement("span")
    v.className = chip(tagFlowColor(c.cap.flow)) + " " + BRANCH_MAX
    v.appendChild(tagIcon())
    v.appendChild(scrollText(c.cap.version ?? c.cap.from))
    v.title = c.cap.version ?? c.cap.from
    branch.appendChild(v)
  } else if (c.stash) {
    /* Full-strength dashed outline: a real entry, not a hover ghost. */
    const v = document.createElement("span")
    v.className =
      badgeVariants({ color: "lane", shape: "squared", variant: "outline" }) + " border-dashed " + BRANCH_MAX
    v.appendChild(scrollText(c.stash.name))
    v.title = c.stash.name
    branch.appendChild(v)
  } else {
    refGroup(refs, BRANCH_BUDGET, BRANCH_MAX, branch, flow, active)
  }
  row.appendChild(branch)

  row.appendChild(document.createElement("div")) // spacer: the graph column, under the SVG

  /* Prefix column: on (default), a recognized `feat:`/`[TAG]` prefix is lifted into its own
     badge column and stripped from the message. Off, the type column stays empty (collapses to
     0, cf. render/measure.ts) and the prefix reads inline in the subject. */
  const showPrefix = getShowPrefixColumn()
  const ps = parseSubject(c.s)
  const badge = document.createElement("div")
  badge.className = "flex min-w-0"
  if (showPrefix && ps.label) {
    const b = document.createElement("span")
    b.className = chip(typeColor(ps.type!)) + " " + TYPE_MAX
    /* A custom prefix rides the `lane` hue (chip above) driven by its own CSS var — set here so the
       badge follows theme flips and live color edits without the graph having to rebuild. */
    if (isCustomType(ps.type!)) b.style.setProperty("--badge-color", `var(${prefixColorVar(ps.type!)})`)
    const ic = typeIcon(ps.type!)
    if (ic) {
      const g = iconEl(ic, "shrink-0")
      g.dataset.icon = "inline-start" // triggers the badge's leading-icon padding (cf. badge.tsx)
      b.appendChild(g)
    }
    b.appendChild(scrollText(ps.label))
    badge.appendChild(b)
  }
  row.appendChild(badge)

  const subj = document.createElement("div")
  subj.className = "flex min-w-0 items-center gap-1.5 truncate pe-2.5" + (BACKUP_WIP.test(c.s) ? " opacity-30" : "")

  if (c.cap) {
    /* Capsule: the whole pattern on one row — `release/x →(rocket/flame) master · develop`. */
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
    if (mg.pr !== undefined) {
      /* GitHub PR merge: a single badge — PR icon, #number, rule, source branch — same
         icon│rule│name grammar as a synced ref chip. No target arrow: the subject never names
         it, and the row's lane already shows where the merge landed. The PR icon keeps the
         leading slot even on a release/hotfix PR; the flow speaks through the hue and the
         row accent. Wider cap than a plain source chip: the number shares the width. */
      from.className = chip(flow ? tagFlowColor(flow) : mergeColor(mg)) + " ps-1.5 max-w-56"
      from.appendChild(iconEl(GitPullRequestIcon, "shrink-0"))
      from.appendChild(document.createTextNode(`#${mg.pr}`))
      const sep = document.createElement("span")
      sep.className = badgeSeparator
      from.appendChild(sep)
      from.appendChild(scrollText(mg.from))
      from.title = mg.from
      subj.appendChild(from)
    } else {
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
    }
  } else {
    /* prefix column off → keep the prefix inline (full `c.s`), else the stripped text */
    const s = scrollText(showPrefix ? ps.text : c.s)
    /* the italics signal the provisional: this subject isn't a deliberately chosen commit message */
    if (c.stash) s.className += " italic text-muted-foreground"
    /* revert design: the quoted subject is the undone commit's — struck through, the
       clearest "this change was taken back" a row can say (the badge carries the intent) */
    if (ps.revert && showPrefix) s.className += " line-through decoration-foreground/40"
    s.title = c.s
    subj.appendChild(s)
  }
  /* Open-worktree action at the end of the message column: hidden until the row is hovered or
     holds the keyboard cursor (`.amont-wtopen`, cf. app.css). `c.wt` only ever carries linked
     worktrees (the main tree is filtered out at ingestion, cf. data/loader.ts), so the button
     appears solely on commits that a separate worktree has checked out. */
  if (c.wt?.length) {
    const wtWrap = document.createElement("span")
    /* no `flex` utility: `.amont-wtopen` owns `display` (none ↔ flex), and a utility-layer
       `flex` would outrank the component-layer hide and pin it visible. */
    wtWrap.className = "amont-wtopen ms-auto shrink-0 items-center gap-1.5 ps-2"
    for (const w of c.wt) wtWrap.appendChild(wtChip(worktreeName(w), w.path))
    subj.appendChild(wtWrap)
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

  /* The hash column shows 8 characters: display-only truncation, cf. AUDIT.md §6 (fix
     B1) — the graph's identity (rowOf, pending, selection) stays in full SHA. */
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

/** An HTML row bucket (cf. constants.ts ROW_BUCKET): a single positioned container,
    rows in normal flow inside — like the old per-CHUNK container, but sized on
    the actual viewport rather than on layout granularity (AUDIT.md §6, perf item). A row
    whose commit isn't resident (evicted page) is omitted — the caller only builds a
    bucket once its pages are guaranteed resident (cf. controller.ts). */
export function rowBucket(
  S: LayoutState,
  start: number,
  end: number,
  commitAt: (row: number) => Commit | undefined,
  selection: ReadonlySet<number>,
  matches: ReadonlySet<number> | null,
  active: number | null,
  total: number,
  sync?: SyncInfo | null
): HTMLDivElement {
  const div = document.createElement("div")
  div.className = "absolute inset-x-0"
  div.style.top = start * ROW + "px"
  for (let i = start; i < end; i++) {
    const c = commitAt(i)
    if (!c) continue
    const matched = matches ? matches.has(S.hashOf[i]) : null
    div.appendChild(rowDiv(S, i, c, selection.has(i), matched, i === active, total, sync))
  }
  return div
}
