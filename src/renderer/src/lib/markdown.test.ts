/* Migré depuis scripts/check-refs.ts (AUDIT.md §10, item tests). Éclaté depuis
   commit-message.test.ts (AUDIT.md §7, phase 5) : ce fichier ne couvre que markdown.ts. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { parseMarkdown, type MdToken } from "./markdown.ts"

describe("parseMarkdown", () => {
  /** "p(texte)" / "ul(item|item)" ; les tokens inline sortent balisés : code[x], bold[x], em[x], link[x] */
  const md = (raw: string) =>
    parseMarkdown(raw).map((b) =>
      b.kind === "p"
        ? `p(${fmtTokens(b.tokens)})`
        : `ul(${b.items.map(fmtTokens).join("|")})`
    )
  const fmtTokens = (ts: MdToken[]) => ts.map((k) => (k.t === "text" ? k.v : `${k.t}[${k.v}]`)).join("")

  it("rend un tableau vide pour un corps vide", () => {
    assert.deepEqual(md(""), [])
  })

  it("rend une ligne simple en paragraphe", () => {
    assert.deepEqual(md("Une ligne."), ["p(Une ligne.)"])
  })

  it("garde les sauts simples dans le paragraphe (pre-wrap), coupe sur ligne vide", () => {
    assert.deepEqual(md("a\nb\n\nc"), ["p(a\nb)", "p(c)"])
  })

  it("reconnaît les trois marqueurs de puce et ferme le bloc au passage paragraphe ↔ liste", () => {
    assert.deepEqual(md("Avant\n- un\n* deux\n+ trois\nAprès"), ["p(Avant)", "ul(un|deux|trois)", "p(Après)"])
  })

  it("tokenise l'inline (code, gras, italique, lien)", () => {
    assert.deepEqual(md("un `git log` ici"), ["p(un code[git log] ici)"])
    assert.deepEqual(md("**gras** et *italique*"), ["p(bold[gras] et em[italique])"])
    assert.deepEqual(md("voir https://x.io/a?b=1 pour"), ["p(voir link[https://x.io/a?b=1] pour)"])
  })

  it("ne laisse pas l'italique couper un identifiant ; ** gagne sur *", () => {
    assert.deepEqual(md("a*b*c"), ["p(a*b*c)"])
    assert.deepEqual(md("**a*b**"), ["p(bold[a*b])"])
  })

  it("ne prend pas une puce `*` pour une ouverture d'italique", () => {
    assert.deepEqual(md("* item"), ["ul(item)"])
  })

  it("ne rend aucun HTML : le markup source ressort en texte", () => {
    assert.deepEqual(md("<script>x</script>"), ["p(<script>x</script>)"])
  })
})
