import { describe, expect, it } from "vitest"

import type { Hunk } from "./diff-parse"
import { sideBySideRows } from "./diff-split"

const hunk = (start: [number, number], spec: string): Hunk => {
  const lines = [...spec].map((c) => ({
    kind: c === "+" ? ("add" as const) : c === "-" ? ("del" as const) : ("ctx" as const),
    text: "",
    noEol: false,
  }))
  return {
    header: "@@",
    oldStart: start[0],
    oldCount: lines.filter((l) => l.kind !== "add").length,
    newStart: start[1],
    newCount: lines.filter((l) => l.kind !== "del").length,
    lines,
  }
}

describe("sideBySideRows", () => {
  it("faces a context line with itself, numbered on both sides", () => {
    const rows = sideBySideRows(hunk([10, 20], "  "))
    expect(rows).toHaveLength(2)
    expect(rows[0].old).toMatchObject({ at: 0, no: 10 })
    expect(rows[0].new).toMatchObject({ at: 0, no: 20 })
    expect(rows[1].old?.no).toBe(11)
    expect(rows[1].new?.no).toBe(21)
  })

  it("pairs del[i] with add[i] inside a change block", () => {
    const rows = sideBySideRows(hunk([1, 1], "--++"))
    expect(rows).toHaveLength(2)
    expect(rows[0].old?.line.kind).toBe("del")
    expect(rows[0].new?.line.kind).toBe("add")
    expect(rows[1].old?.no).toBe(2)
    expect(rows[1].new?.no).toBe(2)
  })

  it("leaves the longer side's leftover facing a blank cell", () => {
    const rows = sideBySideRows(hunk([1, 1], "-++"))
    expect(rows).toHaveLength(2)
    expect(rows[1].old).toBeNull()
    expect(rows[1].new?.line.kind).toBe("add")
  })

  it("closes the pairing on a context line between two blocks", () => {
    const rows = sideBySideRows(hunk([1, 1], "- +"))
    expect(rows).toHaveLength(3)
    expect(rows[0].new).toBeNull()
    expect(rows[1].old?.line.kind).toBe("ctx")
    expect(rows[2].old).toBeNull()
  })

  it("starts a new block when a del follows adds", () => {
    const rows = sideBySideRows(hunk([1, 1], "+-"))
    expect(rows).toHaveLength(2)
    expect(rows[0].old).toBeNull()
    expect(rows[0].new?.line.kind).toBe("add")
    expect(rows[1].old?.line.kind).toBe("del")
    expect(rows[1].new).toBeNull()
  })

  it("keeps `at` pointing at the unified line index", () => {
    const rows = sideBySideRows(hunk([1, 1], " -+ "))
    expect(rows[1].old?.at).toBe(1)
    expect(rows[1].new?.at).toBe(2)
    expect(rows[2].old?.at).toBe(3)
  })
})
