/* Pure parser for the unified diff of ONE file (output of `git diff [--cached] -- <path>`)
   and builder of the partial-staging sub-patches — the diff counterpart of conflict-parse.ts:
   no git call here, runnable under Node as-is (unit-test surface).

   The model serves the hunk/line staging view: each hunk keeps its typed lines (ctx/add/del)
   and `buildPatch` rebuilds a minimal patch carrying only the selected lines, to feed
   `git apply --cached` (stage) or `--cached --reverse` (unstage). Any diff that doesn't fit
   the expected grammar exactly (multi-file, binary, inconsistent counts) yields `null`: the
   view then falls back to the non-interactive render. */

export type DiffLineKind = "ctx" | "add" | "del"

export type DiffLine = {
  kind: DiffLineKind
  /** content without its ' ', '+' or '-' prefix */
  text: string
  /** line followed by `\ No newline at end of file` */
  noEol: boolean
}

export type Hunk = {
  /** the `@@ -a,b +c,d @@ …` line, verbatim */
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: DiffLine[]
}

export type ParsedDiff = {
  /** header lines before the first `@@` (diff --git, index, ---, +++, modes…) */
  header: string[]
  hunks: Hunk[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/
const KIND: Record<string, DiffLineKind> = { " ": "ctx", "+": "add", "-": "del" }

export function parseUnifiedDiff(text: string): ParsedDiff | null {
  const src = text.split("\n")
  /* git ends with \n: the trailing empty entry is not a diff line */
  if (src.at(-1) === "") src.pop()

  const header: string[] = []
  const hunks: Hunk[] = []
  let i = 0
  while (i < src.length && !src[i].startsWith("@@")) {
    /* a second file in the stream: out of contract (wtdiff is single-file) */
    if (header.length && src[i].startsWith("diff --git")) return null
    header.push(src[i++])
  }
  if (!header.length) return null

  while (i < src.length) {
    const m = HUNK.exec(src[i])
    if (!m) return null
    const hunk: Hunk = {
      header: src[i],
      oldStart: parseInt(m[1], 10),
      oldCount: m[2] === undefined ? 1 : parseInt(m[2], 10),
      newStart: parseInt(m[3], 10),
      newCount: m[4] === undefined ? 1 : parseInt(m[4], 10),
      lines: [],
    }
    i++
    let old = 0
    let neu = 0
    while (i < src.length && (old < hunk.oldCount || neu < hunk.newCount)) {
      const l = src[i]
      if (l.startsWith("\\")) {
        /* `\ No newline at end of file` qualifies the previous line */
        const prev = hunk.lines.at(-1)
        if (!prev) return null
        prev.noEol = true
        i++
        continue
      }
      const kind = KIND[l[0] ?? " "]
      if (kind === undefined) return null
      hunk.lines.push({ kind, text: l.slice(1), noEol: false })
      if (kind !== "add") old++
      if (kind !== "del") neu++
      i++
    }
    if (old !== hunk.oldCount || neu !== hunk.newCount) return null
    /* the `\` of a file with no final newline can follow the hunk's very last line */
    if (i < src.length && src[i].startsWith("\\")) {
      hunk.lines.at(-1)!.noEol = true
      i++
    }
    hunks.push(hunk)
  }
  return hunks.length ? { header, hunks } : null
}

/* --- Sub-patch construction ---
   Standard rule (the line-level one of `git add -p`): an unselected line must leave the
   target untouched. In the stage direction the target is the index's previous content (the
   `-` side): a dropped add vanishes, a dropped del becomes context. In the unstage direction
   the patch is applied --reverse against the index (the `+` side): a dropped add becomes
   context (it stays in the index), a dropped del vanishes. */

export type StageDirection = "stage" | "unstage"

/** indices into `hunk.lines` — only add/del lines matter, a ctx index is ignored */
export type LineSelection = ReadonlySet<number>

const NEW_FILE = /^new file mode /
const DEL_FILE = /^deleted file mode /

/** Sub-patch header. A partial patch on a created (or deleted) file is no longer a full
    creation (deletion): the new/deleted file markers are stripped and the /dev/null side
    renamed, otherwise git rejects the patch. */
function patchHeader(header: string[], oldCount: number, newCount: number): string[] {
  let out = header
  if (oldCount > 0 && out.some((l) => NEW_FILE.test(l))) {
    const path = out.find((l) => l.startsWith("+++ b/"))?.slice(6)
    if (path) out = out.filter((l) => !NEW_FILE.test(l)).map((l) => (l === "--- /dev/null" ? `--- a/${path}` : l))
  }
  if (newCount > 0 && out.some((l) => DEL_FILE.test(l))) {
    const path = out.find((l) => l.startsWith("--- a/"))?.slice(6)
    if (path) out = out.filter((l) => !DEL_FILE.test(l)).map((l) => (l === "+++ /dev/null" ? `+++ b/${path}` : l))
  }
  return out
}

/** Single-hunk patch carrying only the selected lines, ready for
    `git apply --cached` (stage) or `--cached --reverse` (unstage).
    `null` when the selection keeps no add/del line. */
export function buildPatch(
  diff: ParsedDiff,
  hunkIndex: number,
  sel: LineSelection,
  dir: StageDirection
): string | null {
  const hunk = diff.hunks[hunkIndex]
  if (!hunk) return null

  const body: string[] = []
  let oldCount = 0
  let newCount = 0
  let any = false
  const emit = (prefix: " " | "+" | "-", line: DiffLine) => {
    body.push(prefix + line.text)
    if (line.noEol) body.push("\\ No newline at end of file")
    if (prefix !== "+") oldCount++
    if (prefix !== "-") newCount++
  }
  hunk.lines.forEach((line, at) => {
    if (line.kind === "ctx") return emit(" ", line)
    if (sel.has(at)) {
      any = true
      return emit(line.kind === "add" ? "+" : "-", line)
    }
    /* dropped line: neutral towards the target (cf. the rule atop this section) */
    if (dir === "stage" && line.kind === "del") emit(" ", line)
    if (dir === "unstage" && line.kind === "add") emit(" ", line)
  })
  if (!any) return null

  /* The side that must match the target keeps its authoritative numbers: the `-` side (index
     before) when staging, the `+` side (current index, what --reverse matches) when unstaging.
     The other side is recomputed; git's convention shifts an empty side's start by one. */
  /* git writes an empty side as `start,0` anchored on the previous line; a side that became
     non-empty again (dropped del of a new file…) must restart at 1, not 0 */
  const fix = (start: number, count: number) => (count > 0 && start === 0 ? 1 : start)
  const oldStart = fix(hunk.oldStart, oldCount)
  const newStart = dir === "stage" ? (oldCount === 0 ? hunk.oldStart + 1 : oldStart) : fix(hunk.newStart, newCount)
  const header = patchHeader(diff.header, oldCount, newCount)
  return [...header, `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body, ""].join("\n")
}

/** Whole-hunk patch: every one of its add/del lines selected. */
export function buildHunkPatch(diff: ParsedDiff, hunkIndex: number, dir: StageDirection): string | null {
  const hunk = diff.hunks[hunkIndex]
  if (!hunk) return null
  const all = new Set(hunk.lines.flatMap((l, at) => (l.kind === "ctx" ? [] : [at])))
  return buildPatch(diff, hunkIndex, all, dir)
}
