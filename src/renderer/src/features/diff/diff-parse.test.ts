import { describe, expect, it } from "vitest"

import { buildHunkPatch, buildPatch, parseUnifiedDiff, type ParsedDiff } from "./diff-parse"

const HEADER = ["diff --git a/src/x.ts b/src/x.ts", "index 1111111..2222222 100644", "--- a/src/x.ts", "+++ b/src/x.ts"]

const TWO_HUNKS = [
  ...HEADER,
  "@@ -1,4 +1,4 @@",
  " const a = 1",
  "-const b = 2",
  "+const b = 20",
  " const c = 3",
  " const d = 4",
  "@@ -10,3 +10,4 @@ function f() {",
  "  let x = 0",
  "+  let y = 1",
  "  return x",
  " }",
  "",
].join("\n")

describe("parseUnifiedDiff", () => {
  it("splits header and hunks, types each line", () => {
    const d = parseUnifiedDiff(TWO_HUNKS)!
    expect(d.header).toEqual(HEADER)
    expect(d.hunks).toHaveLength(2)
    expect(d.hunks[0]).toMatchObject({ oldStart: 1, oldCount: 4, newStart: 1, newCount: 4 })
    expect(d.hunks[0].lines.map((l) => l.kind)).toEqual(["ctx", "del", "add", "ctx", "ctx"])
    expect(d.hunks[1]).toMatchObject({ header: "@@ -10,3 +10,4 @@ function f() {", oldCount: 3, newCount: 4 })
    expect(d.hunks[1].lines.map((l) => l.kind)).toEqual(["ctx", "add", "ctx", "ctx"])
  })

  it("accepts the count-omitted form @@ -N +N @@", () => {
    const d = parseUnifiedDiff([...HEADER, "@@ -3 +3 @@", "-old", "+new", ""].join("\n"))!
    expect(d.hunks[0]).toMatchObject({ oldStart: 3, oldCount: 1, newStart: 3, newCount: 1 })
  })

  it("flags the line preceding a no-newline marker", () => {
    const d = parseUnifiedDiff(
      [
        ...HEADER,
        "@@ -1 +1 @@",
        "-old",
        "\\ No newline at end of file",
        "+new",
        "\\ No newline at end of file",
        "",
      ].join("\n")
    )!
    expect(d.hunks[0].lines).toEqual([
      { kind: "del", text: "old", noEol: true },
      { kind: "add", text: "new", noEol: true },
    ])
  })

  it("rejects a multi-file diff, a binary diff and mismatched counts", () => {
    expect(parseUnifiedDiff(TWO_HUNKS + TWO_HUNKS)).toBeNull()
    expect(parseUnifiedDiff([...HEADER.slice(0, 2), "Binary files a/x and b/x differ", ""].join("\n"))).toBeNull()
    expect(parseUnifiedDiff([...HEADER, "@@ -1,2 +1,2 @@", " only one line", ""].join("\n"))).toBeNull()
  })
})

const parsed = (): ParsedDiff => parseUnifiedDiff(TWO_HUNKS)!

describe("buildHunkPatch", () => {
  it("reproduces the hunk verbatim under a recomputed header", () => {
    expect(buildHunkPatch(parsed(), 0, "stage")).toBe(
      [
        ...HEADER,
        "@@ -1,4 +1,4 @@",
        " const a = 1",
        "-const b = 2",
        "+const b = 20",
        " const c = 3",
        " const d = 4",
        "",
      ].join("\n")
    )
  })

  it("anchors a later hunk on its old-side numbers for staging", () => {
    /* the index never received the first hunk: the new side restarts from the old numbers */
    expect(buildHunkPatch(parsed(), 1, "stage")).toContain("@@ -10,3 +10,4 @@")
  })

  it("anchors on the new side for unstaging", () => {
    expect(buildHunkPatch(parsed(), 1, "unstage")).toContain("@@ -10,3 +10,4 @@")
  })
})

describe("buildPatch (line subset)", () => {
  it("stage: dropped add vanishes, dropped del becomes context", () => {
    const d = parsed()
    /* hunk 0: stage only the del (index 1), not the add (index 2) */
    expect(buildPatch(d, 0, new Set([1]), "stage")).toBe(
      [...HEADER, "@@ -1,4 +1,3 @@", " const a = 1", "-const b = 2", " const c = 3", " const d = 4", ""].join("\n")
    )
    /* stage only the add: the dropped del becomes context */
    expect(buildPatch(d, 0, new Set([2]), "stage")).toBe(
      [
        ...HEADER,
        "@@ -1,4 +1,5 @@",
        " const a = 1",
        " const b = 2",
        "+const b = 20",
        " const c = 3",
        " const d = 4",
        "",
      ].join("\n")
    )
  })

  it("unstage: dropped add becomes context, dropped del vanishes", () => {
    const d = parsed()
    expect(buildPatch(d, 0, new Set([1]), "unstage")).toBe(
      [
        ...HEADER,
        "@@ -1,5 +1,4 @@",
        " const a = 1",
        "-const b = 2",
        " const b = 20",
        " const c = 3",
        " const d = 4",
        "",
      ].join("\n")
    )
    expect(buildPatch(d, 0, new Set([2]), "unstage")).toBe(
      [...HEADER, "@@ -1,3 +1,4 @@", " const a = 1", "+const b = 20", " const c = 3", " const d = 4", ""].join("\n")
    )
  })

  it("returns null when no add/del line is selected", () => {
    expect(buildPatch(parsed(), 0, new Set(), "stage")).toBeNull()
    expect(buildPatch(parsed(), 0, new Set([0]), "stage")).toBeNull()
  })

  it("keeps the no-newline marker attached to its emitted line", () => {
    const d = parseUnifiedDiff(
      [...HEADER, "@@ -1 +1 @@", "-old", "+new", "\\ No newline at end of file", ""].join("\n")
    )!
    expect(buildPatch(d, 0, new Set([0, 1]), "stage")).toBe(
      [...HEADER, "@@ -1,1 +1,1 @@", "-old", "+new", "\\ No newline at end of file", ""].join("\n")
    )
  })

  it("downgrades a partial new-file patch to a plain modification", () => {
    const NEW = [
      "diff --git a/notes.md b/notes.md",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/notes.md",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
      "",
    ].join("\n")
    const d = parseUnifiedDiff(NEW)!
    /* unstage only one of the two lines: the file stays created in the index */
    expect(buildPatch(d, 0, new Set([1]), "unstage")).toBe(
      [
        "diff --git a/notes.md b/notes.md",
        "index 0000000..3333333",
        "--- a/notes.md",
        "+++ b/notes.md",
        "@@ -1,1 +1,2 @@",
        " one",
        "+two",
        "",
      ].join("\n")
    )
    /* full unstage: the patch stays a creation, reversed as-is */
    expect(buildPatch(d, 0, new Set([0, 1]), "unstage")).toContain("new file mode 100644")
  })

  it("downgrades a partial deleted-file patch symmetrically", () => {
    const DEL = [
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "index 4444444..0000000",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-one",
      "-two",
      "",
    ].join("\n")
    const d = parseUnifiedDiff(DEL)!
    expect(buildPatch(d, 0, new Set([0]), "stage")).toBe(
      [
        "diff --git a/old.ts b/old.ts",
        "index 4444444..0000000",
        "--- a/old.ts",
        "+++ b/old.ts",
        "@@ -1,2 +1,1 @@",
        "-one",
        " two",
        "",
      ].join("\n")
    )
  })
})
