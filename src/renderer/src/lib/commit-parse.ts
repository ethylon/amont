/* Parsing of commit messages and `%D` refs (AUDIT.md §7, phase 5 — formerly
   lib/commit-message.ts, split into three concerns: this module, markdown.ts and gitflow.ts). */

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
  fix: "bugfix",
  hotfix: "hotfix",
  perf: "perf",
  refactor: "refactor",
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
  revert: "danger",
  bugfix: "warning",
  perf: "warning",
  release: "release",
  beta: "primary",
  test: "info",
  refactor: "refactor",
  /* chore/docs/style/ci/build stay neutral: housekeeping, not an intent worth flagging */
}

export const typeColor = (type: string): BadgeColor => TYPE_COLOR[type] ?? "neutral"

/* Automatic backups from a third-party tool: present in the history, never an intent.
   They stay readable, but stop competing for attention with the rest of the column. */
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
