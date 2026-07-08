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
