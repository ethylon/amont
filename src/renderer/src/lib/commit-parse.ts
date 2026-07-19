/* Parsing of commit messages and `%D` refs (AUDIT.md §7, phase 5 — formerly
   lib/commit-message.ts, split into three concerns: this module, markdown.ts and gitflow.ts). */

import {
  ArrowTurnBackwardIcon,
  Book02Icon,
  Bug01Icon,
  ConstructionIcon,
  Diamond02Icon,
  Fire02Icon,
  FlashIcon,
  FlaskConicalIcon,
  Infinity01Icon,
  Package01Icon,
  PaintBrush02Icon,
  PuzzleIcon,
  Recycle01Icon,
  RocketIcon,
  Settings01Icon,
  SparklesIcon,
  TestTube01Icon,
} from "@hugeicons/core-free-icons"
import type { IconSvgElement } from "@hugeicons/react"

import type { BadgeColor } from "@/components/ui/badge"

/* Type badges from a `[TAG] subject` prefix. Explicit alias table rather than a config file —
   move it to per-repo config the day these conventions need to vary. */
const TYPE_OF: Record<string, string> = {}
Object.entries({
  feat: ["FEATURE"],
  hotfix: ["HOTFIX"],
  bugfix: ["BUGFIX"],
  plugin: ["PLUGIN", "PLUGINS"],
  release: ["RELEASE"],
  beta: ["BETA"],
  wip: ["WIP"],
}).forEach(([type, aliases]) => aliases.forEach((a) => (TYPE_OF[a] = type)))

/* Conventional Commits: only known types get a badge,
   any random "thing: stuff" stays plain text. */
const CONVENTIONAL: Record<string, string> = {
  feat: "feat",
  fix: "fix",
  hotfix: "hotfix",
  perf: "perf",
  refactor: "refactor",
  polish: "polish",
  chore: "chore",
  docs: "docs",
  test: "test",
  tests: "test",
  style: "style",
  ci: "ci",
  build: "build",
  release: "release",
  revert: "revert",
  wip: "wip",
}

const TYPE_COLOR: Record<string, BadgeColor> = {
  feat: "success",
  feature: "success", // `feature/…` branch prefix, see gitflow.ts
  hotfix: "danger",
  revert: "revert",
  bugfix: "warning",
  fix: "warning", // `fix:` keeps its own label; same icon as bugfix, so they share one settings row
  perf: "perf",
  release: "release",
  beta: "beta",
  test: "info",
  refactor: "refactor",
  polish: "polish",
  /* housekeeping types: their tokens default to the neutral gray (cf. app.css) — a hue is a
     Settings ▸ Colors edit away, not an intent the defaults flag */
  wip: "wip",
  plugin: "plugin",
  chore: "chore",
  docs: "docs",
  style: "style",
  ci: "ci",
  build: "build",
}

/* User-defined prefixes (Settings ▸ Colors, cf. lib/customization.ts). Kept in a module registry the
   customization store pushes into on every change, rather than threaded through every call site:
   parseSubject/typeColor are pure hot-path functions read all over the imperative render, so an
   injected table is far less invasive than a parameter on each of them. Built-ins always win — a
   custom prefix only fills in a `PREFIX:`/`[PREFIX]` the tables above don't recognize.

   Their color is per-theme hex (not a preset hue), so it can't ride a named BadgeColor: the badge
   uses the generic `lane` color driven by a CSS var (prefixColorVar), which lib/customization writes
   for the active theme — theme-aware and live-updatable without rebuilding the graph. */

/** Fold a prefix or subject tag to its match key: lowercase, letters+digits only — so `[HOT-FIX]`,
    `hotfix`, and `Hotfix` all collapse to the same key, mirroring the built-in TYPE_OF folding. */
export const foldPrefix = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "")

/** The CSS custom property carrying a custom prefix's badge color. lib/customization's
    applyCustomization writes it for the active theme; the badge reads it as `--badge-color`. The key
    is folded to `[a-z0-9]*`, so the property name is always a safe identifier. */
export const prefixColorVar = (prefix: string): string => `--amont-prefix-${foldPrefix(prefix)}`

let customPrefixes = new Set<string>()

/** Replace the set of user-defined prefixes (any casing/punctuation; folded and de-duped here). */
export function setCustomPrefixes(prefixes: readonly string[]): void {
  customPrefixes = new Set(prefixes.map(foldPrefix).filter(Boolean))
}

/** Whether a parsed type is a user-defined prefix (vs a built-in or the neutral "other"). */
export const isCustomType = (type: string): boolean => customPrefixes.has(type)

/** The custom type a subject tag resolves to (its folded key), or null when no prefix matches. */
const customType = (raw: string): string | null => {
  const key = foldPrefix(raw)
  return key && customPrefixes.has(key) ? key : null
}

/* Deleted color presets (Settings ▸ Colors): the customization store pushes the removed hues here,
   same module-registry pattern as customPrefixes above. A type whose hue was deleted falls back to
   the neutral gray of a `chore`, until "Reset to defaults" brings the preset back. */
let neutralizedColors = new Set<string>()

/** Replace the set of badge hues whose color preset the user deleted. */
export function setNeutralizedColors(colors: readonly string[]): void {
  neutralizedColors = new Set(colors)
}

export const typeColor = (type: string): BadgeColor => {
  const color = TYPE_COLOR[type]
  if (color) return neutralizedColors.has(color) ? "neutral" : color
  return customPrefixes.has(type) ? "lane" : "neutral"
}

/* One glyph per intent, same table shape as TYPE_COLOR. Read before the label does — and for
   the neutral housekeeping types (chore/docs/style/ci/build) the icon is the only cue they carry.
   An unknown `[TAG]` (type "other") stays iconless: no glyph fits a name we don't know. */
const TYPE_ICON: Record<string, IconSvgElement> = {
  feat: SparklesIcon,
  feature: SparklesIcon,
  fix: Bug01Icon,
  bugfix: Bug01Icon,
  hotfix: Fire02Icon,
  perf: FlashIcon,
  refactor: Recycle01Icon,
  polish: Diamond02Icon,
  chore: Settings01Icon,
  docs: Book02Icon,
  test: TestTube01Icon,
  style: PaintBrush02Icon,
  ci: Infinity01Icon,
  build: Package01Icon,
  release: RocketIcon,
  revert: ArrowTurnBackwardIcon,
  wip: ConstructionIcon,
  beta: FlaskConicalIcon,
  plugin: PuzzleIcon,
}

export const typeIcon = (type: string): IconSvgElement | undefined => TYPE_ICON[type]

/** Badge types a hue drives, in table order — derived from TYPE_COLOR so the Settings ▸ Colors
    previews can never drift from the graph. Alias types sharing an earlier type's icon (`feature`
    next to `feat`) collapse into the one chip. */
export function typesOfColor(color: BadgeColor): string[] {
  const out: string[] = []
  const icons = new Set<IconSvgElement>()
  for (const [type, c] of Object.entries(TYPE_COLOR)) {
    if (c !== color) continue
    const icon = TYPE_ICON[type]
    if (icon && icons.has(icon)) continue
    if (icon) icons.add(icon)
    out.push(type)
  }
  return out
}

export type ParsedSubject = {
  type: string | null
  label: string | null
  text: string
  /** git's own `Revert "…"` subject — the quoted text is the undone commit's subject,
      which the graph strikes through (cf. render/rows.ts) */
  revert?: boolean
}

export function parseSubject(s: string): ParsedSubject {
  /* `git revert` default message: same badge as a conventional `revert:` prefix (danger hue,
     turn-back icon), the quoted original subject becomes the displayed text. A nested revert
     ("Revert "Revert "x""") keeps the inner quotes in the text. */
  const rv = /^Revert\s+"(.*)"\s*$/.exec(s)
  if (rv) return { type: "revert", label: "revert", text: rv[1] || s, revert: true }
  let m = /^\s*\[([^\]]+)\]\s*(.*)/.exec(s)
  if (m) {
    const type = TYPE_OF[m[1].toUpperCase().replace(/[^A-Z]/g, "")]
    if (type) return { type, label: type, text: m[2] || s }
    /* An unknown `[TAG]` still gets a badge (type "other"); a user rule, if one matches, gives it
       a real type and color instead of the neutral "other" fallback. */
    const custom = customType(m[1])
    return { type: custom || "other", label: custom || m[1].toLowerCase(), text: m[2] || s }
  }
  m = /^([A-Za-z]+)(?:\(([^)]*)\))?!?:\s+(.*)/.exec(s)
  if (m) {
    const type = CONVENTIONAL[m[1].toLowerCase()] || customType(m[1])
    if (type) return { type, label: m[2] ? `${type} · ${m[2]}` : type, text: m[3] }
  }
  return { type: null, label: null, text: s }
}

/* --- Refs (`%D` with --decorate=full) --- */

export type RefKind = "head" | "branch" | "remote" | "tag"

export type RefChip = {
  /** short name: "master", "origin/topic", "helpers/v5.11.0" */
  name: string
  kind: RefKind
  /** remotes sitting on the same commit as this local branch */
  remotes: string[]
}

/* A branch name carries the color of its branch: the chip and the graph line refer to the
   same thing, so they should say so alike. A tag isn't a branch — it keeps its own color. */
export const refColor = (kind: RefKind): BadgeColor => (kind === "tag" ? "warning" : "lane")

/* A branch is a navigation point, a tag a marker: it comes last.
   This rank alone decides who survives the row's chip budget. */
const RANK: Record<RefKind, number> = { head: 0, branch: 1, remote: 2, tag: 3 }

export function parseRefs(raw: string): RefChip[] {
  const chips: RefChip[] = []
  const locals = new Map<string, RefChip>()
  const remotes: string[] = []

  const add = (name: string, kind: RefKind) => {
    const c: RefChip = { name, kind, remotes: [] }
    chips.push(c)
    return c
  }

  for (const entry of raw.split(", ").filter(Boolean)) {
    const head = entry.startsWith("HEAD -> ")
    const ref = head ? entry.slice(8) : entry
    if (ref === "HEAD")
      add("HEAD", "head") // detached
    else if (ref.startsWith("tag: refs/tags/")) add(ref.slice(15), "tag")
    else if (ref.startsWith("refs/heads/")) {
      const name = ref.slice(11)
      locals.set(name, add(name, head ? "head" : "branch"))
    } else if (ref.startsWith("refs/remotes/")) remotes.push(ref.slice(13))
  }

  /* `origin/HEAD` is a symbolic alias, and `origin/master` glued to `master` is a duplicate:
     neither deserves a chip. The local branch then carries a sync dot instead. */
  for (const r of remotes) {
    const short = r.slice(r.indexOf("/") + 1)
    if (short === "HEAD") continue
    const local = locals.get(short)
    if (local) local.remotes.push(r)
    else add(r, "remote")
  }

  return chips.sort((a, b) => RANK[a.kind] - RANK[b.kind]) // stable sort: git order preserved at equal rank
}

/* --- Message body (`%b`) --- */

export type CoAuthor = { name: string; email: string }
export type CommitBody = { text: string; coAuthors: CoAuthor[] }

/* Git trailer: `Co-authored-by: Name <mail>`. Pulled out of the body — in this raw form it says
   nothing to the reader — to be rendered separately. A trailer without a name is left in the
   text: it's malformed. */
const CO_AUTHORED = /^co-authored-by:\s*(.*?)\s*(?:<([^>]*)>)?\s*$/i

export function parseBody(raw: string): CommitBody {
  const coAuthors: CoAuthor[] = []
  const lines = raw.split("\n").filter((l) => {
    const m = CO_AUTHORED.exec(l)
    if (!m?.[1]) return true
    coAuthors.push({ name: m[1], email: m[2] ?? "" })
    return false
  })
  return { text: lines.join("\n").trim(), coAuthors }
}

/* --- Merges --- */

export type ParsedMerge = { from: string; to: string | null; tag?: boolean; noise: boolean }

/* Gitflow merges: "Merge branch 'X' into Y" → chips X → Y.
   A sync merge (remote-tracking, or 'X' of <url> into the same branch) is noise. */
export function parseMerge(s: string): ParsedMerge | null {
  let m = /^Merge (remote-tracking )?branch '([^']+)'( of \S+)?(?: into '?(.+?)'?)?$/.exec(s)
  if (m) {
    const from = m[2]
    const to = m[4] || null
    const noise = !!(m[1] || m[3]) && (!to || from.replace(/^origin\//, "") === to)
    return { from, to, noise }
  }
  m = /^Merge tag '([^']+)'(?: into '?(.+?)'?)?$/.exec(s)
  if (m) return { from: m[1], to: m[2] || null, tag: true, noise: false }
  return null
}

/* Name of a merge's source branch, all formats: gitflow/tag (via parseMerge) and GitHub PR
   "Merge pull request #N from owner/branch". Used to name a branch that was merged then deleted,
   with no local ref left for it. The owner/ prefix (fork or repo) is stripped. */
export function mergeSource(s: string): string | null {
  const m = parseMerge(s)
  if (m) return m.from
  const pr = /^Merge pull request #\d+ from (\S+)/.exec(s)
  if (pr) return pr[1].includes("/") ? pr[1].slice(pr[1].indexOf("/") + 1) : pr[1]
  return null
}
