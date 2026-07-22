/* Side-by-side pairing of a hunk's lines (diff-body's split view) — pure, testable under
   Node like diff-parse.ts. Classic alignment: a context line faces itself; inside a change
   block (consecutive dels then adds, git's emission order in a hunk) del[i] faces add[i],
   the longer side's leftover faces a blank cell. */

import type { DiffLine, Hunk } from "./diff-parse"

export type SideCell = {
  /** index into `hunk.lines` — what buildPatch selections and shiki refs are keyed on */
  at: number
  line: DiffLine
  /** 1-based line number on this side */
  no: number
}

export type SideRow = { old: SideCell | null; new: SideCell | null }

export function sideBySideRows(hunk: Hunk): SideRow[] {
  const rows: SideRow[] = []
  let oldNo = hunk.oldStart
  let newNo = hunk.newStart
  let dels: SideCell[] = []
  let adds: SideCell[] = []
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++)
      rows.push({ old: dels[i] ?? null, new: adds[i] ?? null })
    dels = []
    adds = []
  }
  hunk.lines.forEach((line, at) => {
    if (line.kind === "ctx") {
      flush()
      rows.push({ old: { at, line, no: oldNo++ }, new: { at, line, no: newNo++ } })
    } else if (line.kind === "del") {
      /* a del after adds starts a new change block (out of git's usual order, but the
         parser allows it): close the current pairing first */
      if (adds.length) flush()
      dels.push({ at, line, no: oldNo++ })
    } else {
      adds.push({ at, line, no: newNo++ })
    }
  })
  flush()
  return rows
}
