/* Pure parser for git conflict markers — the working file is the single source of truth of
   the conflict view: the A/B panes and the per-conflict actions all derive from the merged
   text, re-parsed after every edit. No git call here; runnable under Node as-is (unit-test
   surface, same policy as main/git/parse.ts).

   Grammar (git merge, `checkout --conflict=merge` and diff3 style):
     <<<<<<< <label A>
     …ours lines…
     ||||||| <label base>     (diff3 only — kept out of both panes, :1: already carries it)
     …base lines…
     =======
     …theirs lines…
     >>>>>>> <label B>
   Markers are exactly 7 characters at column 0; a trailing \r (CRLF file) is tolerated on
   the marker line without touching the content lines. A block left unterminated at EOF is
   not a conflict — its raw lines flow back as context rather than being dropped. */

export type ConflictBlock = {
  kind: "conflict"
  /** position among the file's conflicts — the handle `takeSide` targets */
  index: number
  /** side A: what the current branch had (index stage 2) */
  ours: string[]
  /** side B: what the merged-in branch brings (index stage 3) */
  theirs: string[]
  /** labels carried by the markers ("HEAD", a branch name, a hash) — may be empty */
  oursLabel: string
  theirsLabel: string
  /** the block verbatim, markers included — what serialization keeps for untouched blocks */
  raw: string[]
}

export type ConflictSegment = { kind: "ctx"; lines: string[] } | ConflictBlock

const OURS = /^<{7}(?: (.*?))?\r?$/
const BASE = /^\|{7}(?: .*)?\r?$/
const SEP = /^={7}\r?$/
const THEIRS = /^>{7}(?: (.*?))?\r?$/

export function parseConflicts(text: string): ConflictSegment[] {
  const lines = text.split("\n")
  const segments: ConflictSegment[] = []
  let ctx: string[] = []
  let index = 0

  const flushCtx = () => {
    if (ctx.length) segments.push({ kind: "ctx", lines: ctx })
    ctx = []
  }

  for (let i = 0; i < lines.length; i++) {
    const open = OURS.exec(lines[i])
    if (!open) {
      ctx.push(lines[i])
      continue
    }
    /* candidate block: only committed once the three markers are found, in order */
    const raw: string[] = [lines[i]]
    const ours: string[] = []
    const theirs: string[] = []
    let theirsLabel = ""
    let state: "ours" | "base" | "theirs" = "ours"
    let closed = -1
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j]
      raw.push(l)
      if (state !== "theirs" && SEP.test(l)) {
        state = "theirs"
      } else if (state === "ours" && BASE.test(l)) {
        state = "base"
      } else if (state === "theirs") {
        const close = THEIRS.exec(l)
        if (close) {
          theirsLabel = close[1] ?? ""
          closed = j
          break
        }
        theirs.push(l)
      } else if (state === "ours") {
        ours.push(l)
      }
      /* state === "base": stage 1 content, dropped — neither pane shows it */
    }
    if (closed < 0) {
      /* unterminated: not a conflict, the raw lines are ordinary content */
      ctx.push(lines[i])
      continue
    }
    flushCtx()
    segments.push({ kind: "conflict", index: index++, ours, theirs, oursLabel: open[1] ?? "", theirsLabel, raw })
    i = closed
  }
  flushCtx()
  return segments
}

export const conflictCount = (segments: ConflictSegment[]): number =>
  segments.reduce((n, s) => (s.kind === "conflict" ? n + 1 : n), 0)

export type Side = "ours" | "theirs" | "both"

/** The merged text with conflict `index` replaced by the chosen side ("both" keeps A then B,
    the order the markers already imply). Other blocks stay verbatim (`raw`), context too:
    parse → replace → join is byte-faithful everywhere but the resolved block. */
export function takeSide(text: string, index: number, side: Side): string {
  const out: string[] = []
  for (const seg of parseConflicts(text)) {
    if (seg.kind === "ctx") out.push(...seg.lines)
    else if (seg.index !== index) out.push(...seg.raw)
    else if (side === "ours") out.push(...seg.ours)
    else if (side === "theirs") out.push(...seg.theirs)
    else out.push(...seg.ours, ...seg.theirs)
  }
  return out.join("\n")
}
