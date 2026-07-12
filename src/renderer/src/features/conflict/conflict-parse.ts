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

/* --- Click-ordered picks ---
   The selection model of the conflict view: per conflict, an ORDERED list of line
   references — the order is the click order, and it IS the order of the output region.
   No hardcoded A-before-B: checking B's chunk then A's yields B's lines then A's. A
   conflict with no picks keeps its raw markers in the output, which both leaves the
   resolve button blocked (markers still parse as a conflict) and makes every selection
   fully reversible — uncheck everything and the markers come back. */

export type PickSide = "ours" | "theirs"
export type LineRef = { side: PickSide; line: number }
/** keyed by conflict index; insertion order of each array = click order = output order */
export type Picks = Record<number, LineRef[]>

const sameRef = (a: LineRef, b: LineRef) => a.side === b.side && a.line === b.line

export const isPicked = (picks: Picks, index: number, ref: LineRef): boolean =>
  (picks[index] ?? []).some((r) => sameRef(r, ref))

/** 1-based position of the line in the conflict's output region, null if not picked. */
export function pickPosition(picks: Picks, index: number, ref: LineRef): number | null {
  const at = (picks[index] ?? []).findIndex((r) => sameRef(r, ref))
  return at < 0 ? null : at + 1
}

/** The per-line +/- button: appends at the end of the click order, or removes. */
export function toggleLine(picks: Picks, index: number, ref: LineRef): Picks {
  const cur = picks[index] ?? []
  const next = cur.some((r) => sameRef(r, ref)) ? cur.filter((r) => !sameRef(r, ref)) : [...cur, ref]
  return { ...picks, [index]: next }
}

/** The chunk checkbox: on appends the side's not-yet-picked lines (in file order, as one
    run at the end of the click order — re-checking after another side lands after it);
    off removes every line of the side, wherever the clicks had put them. */
export function setSide(picks: Picks, block: ConflictBlock, side: PickSide, on: boolean): Picks {
  const cur = picks[block.index] ?? []
  if (!on) return { ...picks, [block.index]: cur.filter((r) => r.side !== side) }
  const have = new Set(cur.filter((r) => r.side === side).map((r) => r.line))
  const added: LineRef[] = []
  for (let line = 0; line < block[side].length; line++) if (!have.has(line)) added.push({ side, line })
  return { ...picks, [block.index]: [...cur, ...added] }
}

/** Checkbox state of one side of one block. An empty side (deleted here) is "none":
    there is nothing to pick, the view disables its checkbox. */
export function sideState(picks: Picks, block: ConflictBlock, side: PickSide): "none" | "some" | "all" {
  const total = block[side].length
  if (!total) return "none"
  const n = new Set(
    (picks[block.index] ?? []).filter((r) => r.side === side).map((r) => r.line)
  ).size
  return n === 0 ? "none" : n === total ? "all" : "some"
}

/** The merged output: context verbatim, each picked conflict replaced by its picked lines
    in click order, each untouched conflict kept verbatim (markers included). */
export function renderPicks(segments: ConflictSegment[], picks: Picks): string {
  const out: string[] = []
  for (const seg of segments) {
    if (seg.kind === "ctx") out.push(...seg.lines)
    else {
      const refs = picks[seg.index] ?? []
      if (!refs.length) out.push(...seg.raw)
      else out.push(...refs.map((r) => seg[r.side][r.line]))
    }
  }
  return out.join("\n")
}
