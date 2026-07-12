import { describe, expect, it } from "vitest"

import {
  conflictCount,
  parseConflicts,
  pickPosition,
  renderPicks,
  setSide,
  sideState,
  toggleLine,
  type ConflictBlock,
  type Picks,
} from "./conflict-parse"

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

/* two-line sides, to exercise partial picks and ordering */
const TWO = [
  "ctx",
  "<<<<<<< HEAD",
  "a1",
  "a2",
  "=======",
  "b1",
  "b2",
  ">>>>>>> feature/x",
  "tail",
].join("\n")

const blockOf = (text: string, index = 0): ConflictBlock =>
  parseConflicts(text).filter((s) => s.kind === "conflict")[index]

describe("picks", () => {
  it("renders picked lines in click order, not in a hardcoded A-then-B order", () => {
    const segs = parseConflicts(TWO)
    let picks: Picks = {}
    picks = toggleLine(picks, 0, { side: "theirs", line: 0 }) // click b1 first
    picks = toggleLine(picks, 0, { side: "ours", line: 1 }) // then a2
    picks = toggleLine(picks, 0, { side: "ours", line: 0 }) // then a1
    expect(renderPicks(segs, picks)).toBe("ctx\nb1\na2\na1\ntail")
  })

  it("keeps the markers of an untouched conflict — resolve stays blocked, selection reversible", () => {
    const segs = parseConflicts(TWO)
    expect(renderPicks(segs, {})).toBe(TWO)
    let picks = toggleLine({}, 0, { side: "ours", line: 0 })
    picks = toggleLine(picks, 0, { side: "ours", line: 0 }) // unpick the only pick
    expect(renderPicks(segs, picks)).toBe(TWO)
    expect(conflictCount(parseConflicts(renderPicks(segs, picks)))).toBe(1)
  })

  it("setSide appends the side as a run at the end of the click order, off removes it everywhere", () => {
    const segs = parseConflicts(TWO)
    const block = blockOf(TWO)
    let picks: Picks = toggleLine({}, 0, { side: "theirs", line: 1 }) // b2 clicked first
    picks = setSide(picks, block, "ours", true) // then the whole A chunk
    expect(renderPicks(segs, picks)).toBe("ctx\nb2\na1\na2\ntail")
    picks = setSide(picks, block, "ours", false)
    expect(renderPicks(segs, picks)).toBe("ctx\nb2\ntail")
  })

  it("setSide does not duplicate a line already picked by hand", () => {
    const block = blockOf(TWO)
    let picks: Picks = toggleLine({}, 0, { side: "ours", line: 1 }) // a2 by hand
    picks = setSide(picks, block, "ours", true) // a1 joins after, a2 not duplicated
    expect(renderPicks(parseConflicts(TWO), picks)).toBe("ctx\na2\na1\ntail")
  })

  it("sideState reports none/some/all, and none for an empty side", () => {
    const block = blockOf(TWO)
    expect(sideState({}, block, "ours")).toBe("none")
    const some = toggleLine({}, 0, { side: "ours", line: 0 })
    expect(sideState(some, block, "ours")).toBe("some")
    expect(sideState(setSide({}, block, "ours", true), block, "ours")).toBe("all")
    const empty = blockOf(["<<<<<<<", "=======", "b", ">>>>>>>"].join("\n"))
    expect(sideState({}, empty, "ours")).toBe("none")
  })

  it("pickPosition numbers the output region 1-based in click order", () => {
    let picks: Picks = toggleLine({}, 0, { side: "theirs", line: 0 })
    picks = toggleLine(picks, 0, { side: "ours", line: 0 })
    expect(pickPosition(picks, 0, { side: "theirs", line: 0 })).toBe(1)
    expect(pickPosition(picks, 0, { side: "ours", line: 0 })).toBe(2)
    expect(pickPosition(picks, 0, { side: "ours", line: 1 })).toBeNull()
  })
})
