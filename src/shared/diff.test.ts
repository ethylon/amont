/* Tests for the main-side diff truncation scan (performance audit, finding 9b). The renderer's
   gates and its "N more lines" footer both key off `totalLines`, and the shipped text must be
   made of whole lines only (diff-view's raw fallback splits and re-renders it): these tests pin
   the split("\n") counting semantics the renderer used to compute for itself, and the guarantee
   that a truncated payload always carries strictly more than DIFF_MAX_LINES lines — the
   defense-in-depth that keeps a capped diff from ever passing a `<= DIFF_MAX_LINES` gate. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { DIFF_MAX_LINES, truncateDiff } from "./diff.ts"

/** `n` numbered lines joined by "\n" — no trailing newline unless `trailing`. */
const lines = (n: number, trailing = false) =>
  Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + (trailing ? "\n" : "")

describe("truncateDiff", () => {
  it("counts an empty output as one (empty) line, like split('\\n')", () => {
    assert.deepEqual(truncateDiff(""), { text: "", totalLines: 1 })
  })

  it("passes a small diff through untouched, with the exact split('\\n') count", () => {
    const text = "diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b\n"
    /* trailing newline ⇒ a final empty segment, counted — same as the old render-side scan */
    assert.deepEqual(truncateDiff(text), { text, totalLines: 5 })
  })

  it("leaves a diff exactly at the cap complete", () => {
    const text = lines(DIFF_MAX_LINES)
    assert.deepEqual(truncateDiff(text), { text, totalLines: DIFF_MAX_LINES })
  })

  it("truncates a large diff to whole lines, strictly more than the cap, prefix-intact", () => {
    const total = DIFF_MAX_LINES * 3
    const full = lines(total)
    const res = truncateDiff(full)
    assert.equal(res.totalLines, total) // exact, despite the text being cut
    const shipped = res.text.split("\n")
    assert.ok(shipped.length > DIFF_MAX_LINES, "slack: a truncated text never fits the cap")
    assert.ok(shipped.length < total, "the tail must not ship")
    /* whole lines only, in order: the shipped text is a line-aligned prefix of the input */
    assert.deepEqual(shipped, full.split("\n").slice(0, shipped.length))
    assert.notEqual(res.text.at(-1), "\n") // the cut lands before a newline, never mid-line
  })

  it("keeps totalLines exact for a truncated diff with a trailing newline", () => {
    const total = DIFF_MAX_LINES + 5000
    const res = truncateDiff(lines(total, true))
    assert.equal(res.totalLines, total + 1) // + the final empty segment, split('\n') semantics
  })

  it("ships the same capped text whether or not the tail keeps growing", () => {
    /* the slice depends only on the cap position, not on how much follows it */
    const a = truncateDiff(lines(DIFF_MAX_LINES * 2))
    const b = truncateDiff(lines(DIFF_MAX_LINES * 4))
    assert.equal(a.text, b.text)
  })
})
