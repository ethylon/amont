/* Teintes disponibles pour les chips : le preset n'expose que destructive, on lui adjoint
   success et warning (cf. @theme dans app.css). Pas de violet/magenta/cyan : la couleur
   sémantique appartient au graphe, pas aux badges. */
export type BadgeColor = "neutral" | "primary" | "success" | "warning" | "danger"

/* Badges de type : conventions internes, typos incluses.
   ponytail: table d'alias explicite — passer en config si les conventions bougent. */
const TYPE_OF: Record<string, string> = {}
Object.entries({
  feature: ["FEATURE", "FEAUTRE", "FEATTURE"],
  hotfix: ["HOTFIX", "HOTFIXE", "HTOFIX", "HOTIFX", "HOFTIX"],
  bugfix: ["BUGFIX", "BUGFIXE", "BUFGIXE"],
  plugin: ["PLUGIN", "PLUGINS"],
  release: ["RELEASE"],
  beta: ["BETA"],
  backup: ["AUTOBACKUP"],
  wip: ["WIP"],
}).forEach(([type, aliases]) => aliases.forEach((a) => (TYPE_OF[a] = type)))

/* Conventional Commits : seuls les types connus donnent un badge,
   un "truc: machin" quelconque reste du texte. */
const CONVENTIONAL: Record<string, string> = {
  feat: "feature", fix: "bugfix", hotfix: "hotfix", perf: "perf",
  refactor: "refactor", chore: "chore", docs: "docs", test: "test",
  tests: "test", style: "style", ci: "ci", build: "build",
  release: "release", revert: "revert", wip: "wip",
}

const TYPE_COLOR: Record<string, BadgeColor> = {
  feature: "success",
  hotfix: "danger",
  revert: "danger",
  bugfix: "warning",
  perf: "warning",
  release: "primary",
  beta: "primary",
}

export const typeColor = (type: string): BadgeColor => TYPE_COLOR[type] ?? "neutral"

export type ParsedSubject = { type: string | null; label: string | null; text: string }

export function parseSubject(s: string): ParsedSubject {
  let m = /^\s*\[([^\]]+)\]\s*(.*)/.exec(s)
  if (m) {
    const type = TYPE_OF[m[1].toUpperCase().replace(/[^A-Z]/g, "")]
    return { type: type || "other", label: type || m[1].toLowerCase(), text: m[2] || s }
  }
  m = /^([A-Za-z]+)(\([^)]*\))?!?:\s+(.*)/.exec(s)
  if (m) {
    const type = CONVENTIONAL[m[1].toLowerCase()]
    if (type) return { type, label: type, text: (m[2] ? m[2] + " " : "") + m[3] }
  }
  return { type: null, label: null, text: s }
}

/* --- Refs (`%D` avec --decorate=full) --- */

export type RefKind = "head" | "branch" | "remote" | "tag"

export type RefChip = {
  /** nom court : "master", "origin/topic", "helpers/v5.11.0" */
  name: string
  kind: RefKind
  /** remotes posés sur le même commit que cette branche locale */
  remotes: string[]
}

export const refColor = (kind: RefKind): BadgeColor =>
  kind === "head" ? "primary" : kind === "tag" ? "warning" : "neutral"

/* Une branche est un point de navigation, un tag un marqueur : il passe en dernier.
   Ce rang décide seul de qui survit au budget de chips de la ligne. */
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
    if (ref === "HEAD") add("HEAD", "head") // détaché
    else if (ref.startsWith("tag: refs/tags/")) add(ref.slice(15), "tag")
    else if (ref.startsWith("refs/heads/")) {
      const name = ref.slice(11)
      locals.set(name, add(name, head ? "head" : "branch"))
    } else if (ref.startsWith("refs/remotes/")) remotes.push(ref.slice(13))
  }

  /* `origin/HEAD` est un alias symbolique, et `origin/master` collé à `master` un doublon :
     aucun des deux ne mérite un chip. La branche locale porte alors un point de synchro. */
  for (const r of remotes) {
    const short = r.slice(r.indexOf("/") + 1)
    if (short === "HEAD") continue
    const local = locals.get(short)
    if (local) local.remotes.push(r)
    else add(r, "remote")
  }

  return chips.sort((a, b) => RANK[a.kind] - RANK[b.kind]) // sort stable : ordre git conservé à rang égal
}

export type ParsedMerge = { from: string; to: string | null; tag?: boolean; noise: boolean }

/* Merges gitflow : "Merge branch 'X' into Y" → chips X → Y.
   Un merge de synchro (remote-tracking ou 'X' of <url> vers la même branche) est du bruit. */
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

export const MAIN_TARGETS = /^(develop|master|main|release\/.+)$/

/* Statuts `git diff --name-status`. Un statut à deux lettres est un conflit (UU, AA, DD…).
   R et C n'ont plus de teinte propre : ce sont des déplacements, pas des changements de contenu. */
export const fileStatusColor = (st: string): BadgeColor =>
  st.length > 1 ? "danger"
    : st === "A" || st === "?" ? "success"
      : st === "M" ? "warning"
        : st === "D" ? "danger"
          : "neutral"
