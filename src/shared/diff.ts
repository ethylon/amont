/* The diff-text line cap, shared by both processes (performance audit, finding 9b). The
   renderer shows at most DIFF_MAX_LINES lines of a diff (diff-view.tsx: diff2html + shiki
   below the cap, a plain fallback above), but `repo:diff`/`repo:wtdiff` used to ship the full
   git output — up to the 64 MB OUTPUT_CAP — across IPC just for the renderer to throw most of
   it away. `truncateDiff` runs on the main side, right after the git call: one newline scan
   slices the payload a small slack past the cap and counts the exact total in the same pass,
   so the renderer's "N more lines" footer stays truthful without ever seeing the full text. */

import type { DiffText } from "./types.ts"

/** Hard cap on rendered diff lines — diff2html/shiki must never see more than this. */
export const DIFF_MAX_LINES = 3000

/* Shipped-lines slack above the cap: a truncated payload deliberately carries MORE than
   DIFF_MAX_LINES lines, so any `lines <= DIFF_MAX_LINES` gate on the text itself can never
   mistake a truncated diff for a complete one. The render gates key off `totalLines`; the
   slack keeps the text unambiguous as defense in depth. */
const DIFF_LINE_SLACK = 64

/** Caps `text` at DIFF_MAX_LINES + slack lines, counting the total in the same scan.
    `totalLines` follows `split("\n").length` semantics (a trailing newline yields a final
    empty line), matching what the renderer used to count render-side. On a capped diff the
    scan still sweeps the tail for an exact count — a plain indexOf run, cheap next to the
    multi-MB string copy and structured clone it avoids. */
export function truncateDiff(text: string): DiffText {
  const keep = DIFF_MAX_LINES + DIFF_LINE_SLACK
  let newlines = 0
  let cut = -1
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    newlines++
    /* the `keep`-th newline terminates the last kept line: slice up to (not including) it */
    if (newlines === keep && cut < 0) cut = i
  }
  const totalLines = newlines + 1
  return cut < 0 ? { text, totalLines } : { text: text.slice(0, cut), totalLines }
}
