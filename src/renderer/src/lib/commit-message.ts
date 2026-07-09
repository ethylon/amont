/* Teintes disponibles pour les chips : le preset n'expose que destructive, on lui adjoint
   success et warning (cf. @theme dans app.css). `lane` n'est pas une teinte mais un relais :
   le chip prend celle que son porteur lui pose — le trait de branche du graphe, ici. */
export type BadgeColor = "neutral" | "primary" | "success" | "warning" | "danger" | "release" | "lane"

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
  feature: "success", // préfixe de branche `feature/…`, cf. refs-sidebar
  hotfix: "danger",
  revert: "danger",
  bugfix: "warning",
  perf: "warning",
  release: "release",
  beta: "primary",
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

/* --- Markdown du corps ---
   Sous-ensemble réellement écrit dans un message de commit : paragraphes, puces, `code`,
   **gras**, *italique*, URLs nues. Le parseur ne rend que des données : aucun HTML n'est injecté.
   ponytail: ni titres, ni tableaux, ni blocs fencés. Une dep markdown le jour où ça manque. */

export type MdKind = "text" | "code" | "bold" | "em" | "link"
export type MdToken = { t: MdKind; v: string }
export type MdBlock = { kind: "p"; tokens: MdToken[] } | { kind: "ul"; items: MdToken[][] }

/* `(?<![*\w])` : l'italique ne coupe pas un `a*b*c`. Un `*` en tête de ligne est déjà une puce. */
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|(?<![*\w])\*([^*]+)\*(?!\*)|(https?:\/\/[^\s<>()]+)/g
const BULLET = /^\s*[-*+]\s+(.*)/

function tokenize(s: string): MdToken[] {
  const out: MdToken[] = []
  const push = (t: MdKind, v: string) => void (v && out.push({ t, v }))
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    push("text", s.slice(last, m.index))
    push(m[1] ? "code" : m[2] ? "bold" : m[3] ? "em" : "link", m[1] ?? m[2] ?? m[3] ?? m[4])
    last = m.index + m[0].length
  }
  push("text", s.slice(last))
  return out
}

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let para: string[] = []
  let items: string[] = []

  /* une ligne vide, ou le passage puce ↔ paragraphe, ferme le bloc courant */
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", tokens: tokenize(para.join("\n")) })
    if (items.length) blocks.push({ kind: "ul", items: items.map(tokenize) })
    para = []
    items = []
  }

  for (const line of text.split("\n")) {
    const m = BULLET.exec(line)
    if (m) {
      if (para.length) flush()
      items.push(m[1])
    } else if (!line.trim()) flush()
    else {
      if (items.length) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
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

export const MAIN_TARGETS = /^(develop|master|main|release\/.+)$/

/* Une release/hotfix gitflow atterrit sur master ET develop, avec un tag de version. Le motif se
   reconnaît à la source du merge : préfixe `release/`|`hotfix/`, ou — côté develop du « merge tag
   into develop » — au tag semver lui-même. Un tag semver seul ne distingue pas release de hotfix :
   on retombe sur release, le rouge du hotfix venant de ses merges `hotfix/`. */
export type FlowKind = "release" | "hotfix"
export const SEMVER = /^v?\d+\.\d+\.\d+/
const RELEASE_BRANCH = /^release\//
const HOTFIX_BRANCH = /^hotfix\//
const FLOW_COLOR: Record<FlowKind, BadgeColor> = { release: "release", hotfix: "danger" }

export function mergeFlow(mg: ParsedMerge): FlowKind | null {
  if (HOTFIX_BRANCH.test(mg.from)) return "hotfix"
  if (RELEASE_BRANCH.test(mg.from)) return "release"
  if (mg.tag && SEMVER.test(mg.from)) return "release"
  return null
}

/* Teinte du chip source d'un merge. Le motif release/hotfix prime ; sinon un tag reste ambre, et
   un merge vers un tronc garde son teal. */
export function mergeColor(mg: ParsedMerge): BadgeColor {
  const flow = mergeFlow(mg)
  if (flow) return FLOW_COLOR[flow]
  if (mg.tag) return "warning"
  return !mg.noise && mg.to && MAIN_TARGETS.test(mg.to) ? "primary" : "neutral"
}

/** Teinte d'un tag semver posé sur une ligne : rouge si la ligne est un hotfix, violet sinon. */
export const tagFlowColor = (flow: FlowKind | null): BadgeColor => (flow === "hotfix" ? "danger" : "release")

/* Statuts `git diff --name-status`. Un statut à deux lettres est un conflit (UU, AA, DD…).
   R et C n'ont plus de teinte propre : ce sont des déplacements, pas des changements de contenu. */
export const fileStatusColor = (st: string): BadgeColor =>
  st.length > 1 ? "danger"
    : st === "A" || st === "?" ? "success"
      : st === "M" ? "warning"
        : st === "D" ? "danger"
          : "neutral"
