/* Parsing des messages de commit et des refs `%D` (AUDIT.md §7, phase 5 — anciennement
   lib/commit-message.ts, éclaté en trois métiers : ce module, markdown.ts et gitflow.ts). */

import type { BadgeColor } from "@/components/ui/badge"

/* Badges de type : conventions internes, typos incluses.
   ponytail: table d'alias explicite — passer en config si les conventions bougent. */
const TYPE_OF: Record<string, string> = {}
Object.entries({
  feat: ["FEATURE", "FEAUTRE", "FEATTURE"],
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
  feat: "feat", fix: "bugfix", hotfix: "hotfix", perf: "perf",
  refactor: "refactor", chore: "chore", docs: "docs", test: "test",
  tests: "test", style: "style", ci: "ci", build: "build",
  release: "release", revert: "revert", wip: "wip",
}

const TYPE_COLOR: Record<string, BadgeColor> = {
  feat: "success",
  feature: "success", // préfixe de branche `feature/…`, cf. gitflow.ts
  hotfix: "danger",
  revert: "danger",
  bugfix: "warning",
  perf: "warning",
  release: "release",
  beta: "primary",
  test: "info",
  refactor: "refactor",
  /* chore/docs/style/ci/build restent neutres : du ménage, pas une intention à signaler */
}

export const typeColor = (type: string): BadgeColor => TYPE_COLOR[type] ?? "neutral"

/* Sauvegardes automatiques d'un outil tiers : présentes dans l'historique, jamais une intention.
   Elles restent lisibles, mais cessent de disputer l'attention au reste de la colonne. */
export const BACKUP_WIP = /^\s*\[(?:AUTO-)?BACKUP\]\s*WIP\b/i

export type ParsedSubject = { type: string | null; label: string | null; text: string }

export function parseSubject(s: string): ParsedSubject {
  let m = /^\s*\[([^\]]+)\]\s*(.*)/.exec(s)
  if (m) {
    const type = TYPE_OF[m[1].toUpperCase().replace(/[^A-Z]/g, "")]
    return { type: type || "other", label: type || m[1].toLowerCase(), text: m[2] || s }
  }
  m = /^([A-Za-z]+)(?:\(([^)]*)\))?!?:\s+(.*)/.exec(s)
  if (m) {
    const type = CONVENTIONAL[m[1].toLowerCase()]
    if (type) return { type, label: m[2] ? `${type} · ${m[2]}` : type, text: m[3] }
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

/* Un nom de branche porte la couleur de sa branche : le chip et le trait du graphe désignent la
   même chose, autant qu'ils le disent pareil. Le tag n'est pas une branche — il garde sa teinte. */
export const refColor = (kind: RefKind): BadgeColor => (kind === "tag" ? "warning" : "lane")

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

/* --- Corps du message (`%b`) --- */

export type CoAuthor = { name: string; email: string }
export type CommitBody = { text: string; coAuthors: CoAuthor[] }

/* Trailer git : `Co-authored-by: Nom <mail>`. Sorti du corps — sous cette forme il ne dit rien
   au lecteur — pour être rendu à part. Un trailer sans nom est laissé au texte : il est cassé. */
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

/* Nom de la branche source d'un merge, tous formats : gitflow/tag (via parseMerge) et PR GitHub
   « Merge pull request #N from owner/branche ». Sert à nommer une branche mergée puis supprimée,
   dont il ne reste plus aucune ref locale. Le préfixe owner/ (fork ou dépôt) est retiré. */
export function mergeSource(s: string): string | null {
  const m = parseMerge(s)
  if (m) return m.from
  const pr = /^Merge pull request #\d+ from (\S+)/.exec(s)
  if (pr) return pr[1].includes("/") ? pr[1].slice(pr[1].indexOf("/") + 1) : pr[1]
  return null
}
