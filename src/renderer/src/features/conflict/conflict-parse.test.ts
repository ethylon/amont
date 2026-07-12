import { describe, expect, it } from "vitest"

import { conflictCount, parseConflicts, takeSide } from "./conflict-parse"

const SIMPLE = [
  "const a = 1",
  "<<<<<<< HEAD",
  "const b = 2",
  "=======",
  "const b = 3",
  ">>>>>>> feature/x",
  "const c = 4",
].join("\n")

describe("parseConflicts", () => {
  it("splits context and conflict, carries the marker labels", () => {
    const segs = parseConflicts(SIMPLE)
    expect(segs).toEqual([
      { kind: "ctx", lines: ["const a = 1"] },
      {
        kind: "conflict",
        index: 0,
        ours: ["const b = 2"],
        theirs: ["const b = 3"],
        oursLabel: "HEAD",
        theirsLabel: "feature/x",
        raw: ["<<<<<<< HEAD", "const b = 2", "=======", "const b = 3", ">>>>>>> feature/x"],
      },
      { kind: "ctx", lines: ["const c = 4"] },
    ])
  })

  it("numbers several conflicts in order", () => {
    const text = `${SIMPLE}\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feature/x\n`
    const segs = parseConflicts(text)
    expect(conflictCount(segs)).toBe(2)
    expect(segs.filter((s) => s.kind === "conflict").map((s) => s.index)).toEqual([0, 1])
  })

  it("drops the diff3 base section from both sides", () => {
    const text = ["<<<<<<< HEAD", "ours", "||||||| merged common ancestors", "base", "=======", "theirs", ">>>>>>> other"].join(
      "\n"
    )
    const [seg] = parseConflicts(text)
    expect(seg).toMatchObject({ kind: "conflict", ours: ["ours"], theirs: ["theirs"] })
  })

  it("tolerates empty sides and empty labels", () => {
    const text = ["<<<<<<<", "=======", "theirs only", ">>>>>>>"].join("\n")
    const [seg] = parseConflicts(text)
    expect(seg).toMatchObject({ kind: "conflict", ours: [], theirs: ["theirs only"], oursLabel: "", theirsLabel: "" })
  })

  it("tolerates CRLF marker lines without touching content lines", () => {
    const text = ["<<<<<<< HEAD\r", "ours\r", "=======\r", "theirs\r", ">>>>>>> x\r", ""].join("\n")
    const [seg] = parseConflicts(text)
    expect(seg).toMatchObject({ kind: "conflict", ours: ["ours\r"], theirs: ["theirs\r"], oursLabel: "HEAD" })
  })

  it("treats an unterminated block as plain context", () => {
    const text = ["a", "<<<<<<< HEAD", "b", "c"].join("\n")
    expect(parseConflicts(text)).toEqual([{ kind: "ctx", lines: ["a", "<<<<<<< HEAD", "b", "c"] }])
  })

  it("does not read a marker mid-line or shorter than 7 characters", () => {
    const text = ["x <<<<<<< y", "<<<<<< six", "======= not a sep either without an open block"].join("\n")
    expect(conflictCount(parseConflicts(text))).toBe(0)
  })
})

describe("takeSide", () => {
  it("keeps A, keeps B, or keeps both in marker order", () => {
    expect(takeSide(SIMPLE, 0, "ours")).toBe("const a = 1\nconst b = 2\nconst c = 4")
    expect(takeSide(SIMPLE, 0, "theirs")).toBe("const a = 1\nconst b = 3\nconst c = 4")
    expect(takeSide(SIMPLE, 0, "both")).toBe("const a = 1\nconst b = 2\nconst b = 3\nconst c = 4")
  })

  it("only touches the targeted block and preserves the trailing newline", () => {
    const text = `${SIMPLE}\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> feature/x\n`
    const out = takeSide(text, 1, "theirs")
    expect(out).toBe(`${SIMPLE}\ny\n`)
    /* the remaining block is intact and renumbered from 0 */
    expect(conflictCount(parseConflicts(out))).toBe(1)
  })
})
