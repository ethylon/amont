/* Migrated from scripts/check-refs.ts (AUDIT.md §10, tests item). Split off from
   commit-message.test.ts (AUDIT.md §7, phase 5): this file only covers markdown.ts. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { parseMarkdown, type MdToken } from "./markdown.ts"

describe("parseMarkdown", () => {
  /** "p(text)" / "ul(item|item)"; inline tokens come out tagged: code[x], bold[x], em[x], link[x] */
  const md = (raw: string) =>
    parseMarkdown(raw).map((b) =>
      b.kind === "p" ? `p(${fmtTokens(b.tokens)})` : `ul(${b.items.map(fmtTokens).join("|")})`
    )
  const fmtTokens = (ts: MdToken[]) => ts.map((k) => (k.t === "text" ? k.v : `${k.t}[${k.v}]`)).join("")

  it("renders an empty array for an empty body", () => {
    assert.deepEqual(md(""), [])
  })

  it("renders a single line as a paragraph", () => {
    assert.deepEqual(md("Une ligne."), ["p(Une ligne.)"])
  })

  it("keeps single line breaks inside the paragraph (pre-wrap), splits on blank line", () => {
    assert.deepEqual(md("a\nb\n\nc"), ["p(a\nb)", "p(c)"])
  })

  it("recognizes the three bullet markers and closes the block on paragraph ↔ list switch", () => {
    assert.deepEqual(md("Before\n- one\n* two\n+ three\nAfter"), ["p(Before)", "ul(one|two|three)", "p(After)"])
  })

  it("tokenizes inline content (code, bold, italic, link)", () => {
    assert.deepEqual(md("a `git log` here"), ["p(a code[git log] here)"])
    assert.deepEqual(md("**gras** et *italique*"), ["p(bold[gras] et em[italique])"])
    assert.deepEqual(md("see https://x.io/a?b=1 for"), ["p(see link[https://x.io/a?b=1] for)"])
  })

  it("does not let italics cut through an identifier; ** wins over *", () => {
    assert.deepEqual(md("a*b*c"), ["p(a*b*c)"])
    assert.deepEqual(md("**a*b**"), ["p(bold[a*b])"])
  })

  it("does not mistake a `*` bullet for an opening italic marker", () => {
    assert.deepEqual(md("* item"), ["ul(item)"])
  })

  it("renders no HTML: the source markup comes back out as text", () => {
    assert.deepEqual(md("<script>x</script>"), ["p(<script>x</script>)"])
  })
})
