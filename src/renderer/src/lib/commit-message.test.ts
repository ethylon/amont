/* Migré depuis scripts/check-refs.ts (AUDIT.md §10, item tests) : mêmes assertions, un `it()`
   par bloc plutôt qu'un script qui s'arrête au premier échec. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import {
  mergeSource, parseBody, parseMarkdown, parseMerge, parseRefs, parseSubject, type MdToken,
} from "./commit-message.ts"

/** "master*" = remote fusionné dans la branche locale */
const fmt = (raw: string) => parseRefs(raw).map((r) => r.name + (r.remotes.length ? "*" : ""))
const eq = (raw: string, expected: string[]) => assert.deepEqual(fmt(raw), expected, raw)

describe("parseRefs", () => {
  it("fusionne local + son remote en un seul chip ; origin/HEAD disparaît", () => {
    eq("HEAD -> refs/heads/master, refs/remotes/origin/master, refs/remotes/origin/HEAD", ["master*"])
  })

  it("rend un remote sans branche locale en chip à part entière, nom complet", () => {
    eq("refs/remotes/origin/topic", ["origin/topic"])
  })

  it("distingue une locale nommée comme un remote de ce remote (deux chips homonymes)", () => {
    /* Une locale littéralement nommée "origin/topic" n'est pas le remote "topic" de "origin" :
       deux refs, deux chips, homonymes à l'écran — l'ambiguïté est celle de git. */
    eq("refs/heads/origin/topic, refs/remotes/origin/topic", ["origin/topic", "origin/topic"])
  })

  it("aligne plusieurs remotes sur la même locale", () => {
    eq("refs/heads/main, refs/remotes/origin/main, refs/remotes/upstream/main", ["main*"])
  })

  it("ne fusionne pas une locale et le remote d'une branche absente du commit", () => {
    eq("refs/heads/develop, refs/remotes/origin/master", ["develop", "origin/master"])
  })

  it("range HEAD, branche, remote, tag quel que soit l'ordre de git", () => {
    eq("tag: refs/tags/v1, refs/remotes/origin/topic, refs/heads/develop", ["develop", "origin/topic", "v1"])
  })

  it("garde l'ordre de git à teinte égale (rang stable)", () => {
    eq("tag: refs/tags/b, tag: refs/tags/a", ["b", "a"])
  })

  it("affiche HEAD détachée", () => {
    eq("HEAD, refs/heads/master", ["HEAD", "master"])
  })

  it("reconnaît le remote au préfixe, pas au nombre de segments (branche à slashes)", () => {
    eq("refs/heads/feature/ui/graph, refs/remotes/origin/feature/ui/graph", ["feature/ui/graph*"])
  })

  it("rend un tableau vide pour un commit sans ref", () => {
    eq("", [])
  })

  it("ne déclenche le repli +N que sur débordement réel (invariant du budget)", () => {
    const BUDGET = 2
    for (const raw of [
      "",
      "refs/heads/master",
      "tag: refs/tags/v1, tag: refs/tags/v2",
      "tag: refs/tags/a, tag: refs/tags/b, tag: refs/tags/c, tag: refs/tags/d",
    ]) {
      const refs = parseRefs(raw)
      const shown = refs.slice(0, BUDGET)
      const hidden = refs.slice(BUDGET)
      assert.ok(!hidden.length || shown.length, `"+N" orphelin : ${raw}`)
      assert.ok(!hidden.length || refs.length > BUDGET, `repli sans débordement : ${raw}`)
    }
  })
})

describe("parseBody", () => {
  const body = (raw: string) => {
    const b = parseBody(raw)
    return [b.text, b.coAuthors.map((a) => `${a.name}|${a.email}`)] as const
  }

  it("rend le corps tel quel sans trailer", () => {
    assert.deepEqual(body("Corps.\n"), ["Corps.", []])
    assert.deepEqual(body(""), ["", []])
  })

  it("extrait les trailers de co-auteur, insensible à la casse du champ", () => {
    assert.deepEqual(
      body("Corps.\n\nCo-authored-by: Ada Lovelace <ada@x.io>\nCo-Authored-By: Alan <alan@x.io>\n"),
      ["Corps.", ["Ada Lovelace|ada@x.io", "Alan|alan@x.io"]]
    )
  })

  it("accepte un trailer sans corps, et un trailer sans e-mail", () => {
    assert.deepEqual(body("Co-authored-by: Ada <ada@x.io>"), ["", ["Ada|ada@x.io"]])
    assert.deepEqual(body("Co-authored-by: Ada"), ["", ["Ada|"]])
  })

  it("rend un trailer cassé au corps plutôt qu'un co-auteur anonyme", () => {
    assert.deepEqual(body("Co-authored-by:"), ["Co-authored-by:", []])
  })

  it("ne prend pas une mention en plein texte pour un trailer", () => {
    assert.deepEqual(body("Voir le Co-authored-by: du commit d'avant."), ["Voir le Co-authored-by: du commit d'avant.", []])
  })
})

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

describe("parseMerge / mergeSource", () => {
  it("extrait source et cible d'un merge de branche", () => {
    assert.deepEqual(parseMerge("Merge branch 'feature/x' into develop"), { from: "feature/x", to: "develop", noise: false })
    assert.deepEqual(parseMerge("Merge branch 'hotfix/1.2.1'"), { from: "hotfix/1.2.1", to: null, noise: false })
  })

  it("signale les merges de synchro (remote-tracking, 'x' of <url>) comme bruit", () => {
    assert.deepEqual(
      parseMerge("Merge remote-tracking branch 'origin/develop' into develop"),
      { from: "origin/develop", to: "develop", noise: true }
    )
    assert.deepEqual(
      parseMerge("Merge branch 'master' of https://forge/depot.git into master"),
      { from: "master", to: "master", noise: true }
    )
  })

  it("reconnaît un merge de tag", () => {
    assert.deepEqual(parseMerge("Merge tag 'v1.2.0' into develop"), { from: "v1.2.0", to: "develop", tag: true, noise: false })
  })

  it("rend null pour un sujet qui n'est pas un merge", () => {
    assert.equal(parseMerge("feat: pas un merge"), null)
  })

  it("extrait la branche source d'un merge de PR GitHub (le préfixe owner/ tombe)", () => {
    assert.equal(mergeSource("Merge pull request #12 from owner/feature/x"), "feature/x")
    assert.equal(mergeSource("Merge branch 'release/2.0'"), "release/2.0")
    assert.equal(mergeSource("chore: rien"), null)
  })
})

describe("parseSubject", () => {
  it("reconnaît le badge de type, les alias internes (typos comprises) et Conventional Commits", () => {
    assert.deepEqual(parseSubject("[FEATURE] ajout du graphe"), { type: "feat", label: "feat", text: "ajout du graphe" })
    assert.deepEqual(parseSubject("[HOFTIX] vite"), { type: "hotfix", label: "hotfix", text: "vite" }) // typo connue
    assert.deepEqual(parseSubject("[Machin] chose"), { type: "other", label: "machin", text: "chose" })
    assert.deepEqual(parseSubject("feat(graph): lanes"), { type: "feat", label: "feat · graph", text: "lanes" })
    assert.deepEqual(parseSubject("fix: débordement"), { type: "bugfix", label: "bugfix", text: "débordement" })
  })

  it("laisse un \"truc: machin\" quelconque en texte", () => {
    assert.deepEqual(parseSubject("truc: machin"), { type: null, label: null, text: "truc: machin" })
  })
})
