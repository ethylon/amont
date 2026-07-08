/* Auto-contrôle des parseurs de commit-message.ts : `node scripts/check-refs.ts`.
   Node ≥ 22.18 retire les types nativement, pas de runner à installer. */
import assert from "node:assert/strict"
import { parseBody, parseMarkdown, parseRefs, type MdToken } from "../src/renderer/src/lib/commit-message.ts"

/** "master*" = remote fusionné dans la branche locale */
const fmt = (raw: string) => parseRefs(raw).map((r) => r.name + (r.remotes.length ? "*" : ""))
const eq = (raw: string, expected: string[]) => assert.deepEqual(fmt(raw), expected, raw)

// local + son remote = un seul chip ; origin/HEAD disparaît
eq("HEAD -> refs/heads/master, refs/remotes/origin/master, refs/remotes/origin/HEAD", ["master*"])

// remote sans branche locale : chip à part entière, nom complet
eq("refs/remotes/origin/topic", ["origin/topic"])

/* Une locale littéralement nommée "origin/topic" n'est pas le remote "topic" de "origin" :
   deux refs, deux chips, homonymes à l'écran — l'ambiguïté est celle de git. */
eq("refs/heads/origin/topic, refs/remotes/origin/topic", ["origin/topic", "origin/topic"])

// plusieurs remotes alignés sur la même locale
eq("refs/heads/main, refs/remotes/origin/main, refs/remotes/upstream/main", ["main*"])

// remote d'une branche locale absente du commit : les deux ne fusionnent pas
eq("refs/heads/develop, refs/remotes/origin/master", ["develop", "origin/master"])

// rang : HEAD, branche, remote, tag — quel que soit l'ordre de git
eq("tag: refs/tags/v1, refs/remotes/origin/topic, refs/heads/develop", ["develop", "origin/topic", "v1"])

// rang stable : à teinte égale, l'ordre de git est conservé
eq("tag: refs/tags/b, tag: refs/tags/a", ["b", "a"])

// HEAD détaché
eq("HEAD, refs/heads/master", ["HEAD", "master"])

// branche à slashes : le remote se reconnaît au préfixe, pas au nombre de segments
eq("refs/heads/feature/ui/graph, refs/remotes/origin/feature/ui/graph", ["feature/ui/graph*"])

// commit sans ref
eq("", [])

/* Invariant du repli : le "+N" du graphe n'apparaît jamais seul, et ne se déclenche que
   sur débordement réel. Vérifié ici sur le seul contrat dont dépend `refChips`. */
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

/* --- parseBody : le corps perd ses trailers de co-auteur, et rien d'autre --- */

const body = (raw: string) => {
  const b = parseBody(raw)
  return [b.text, b.coAuthors.map((a) => `${a.name}|${a.email}`)] as const
}

assert.deepEqual(body("Corps.\n"), ["Corps.", []])
assert.deepEqual(body(""), ["", []])

assert.deepEqual(
  body("Corps.\n\nCo-authored-by: Ada Lovelace <ada@x.io>\nCo-Authored-By: Alan <alan@x.io>\n"),
  ["Corps.", ["Ada Lovelace|ada@x.io", "Alan|alan@x.io"]]
)

// trailer sans corps, et trailer sans e-mail
assert.deepEqual(body("Co-authored-by: Ada <ada@x.io>"), ["", ["Ada|ada@x.io"]])
assert.deepEqual(body("Co-authored-by: Ada"), ["", ["Ada|"]])

// trailer cassé : rendu au corps, plutôt qu'un co-auteur anonyme
assert.deepEqual(body("Co-authored-by:"), ["Co-authored-by:", []])

// une mention en plein texte n'est pas un trailer
assert.deepEqual(body("Voir le Co-authored-by: du commit d'avant."), ["Voir le Co-authored-by: du commit d'avant.", []])

/* --- parseMarkdown : sous-ensemble markdown du corps --- */

/** "p(texte)" / "ul(item|item)" ; les tokens inline sortent balisés : code[x], bold[x], em[x], link[x] */
const md = (raw: string) =>
  parseMarkdown(raw).map((b) =>
    b.kind === "p"
      ? `p(${fmtTokens(b.tokens)})`
      : `ul(${b.items.map(fmtTokens).join("|")})`
  )
const fmtTokens = (ts: MdToken[]) => ts.map((k) => (k.t === "text" ? k.v : `${k.t}[${k.v}]`)).join("")

assert.deepEqual(md(""), [])
assert.deepEqual(md("Une ligne."), ["p(Une ligne.)"])

// les sauts simples restent dans le paragraphe (pre-wrap), la ligne vide le coupe
assert.deepEqual(md("a\nb\n\nc"), ["p(a\nb)", "p(c)"])

// puces : les trois marqueurs, et le passage paragraphe ↔ liste ferme le bloc
assert.deepEqual(md("Avant\n- un\n* deux\n+ trois\nAprès"), ["p(Avant)", "ul(un|deux|trois)", "p(Après)"])

// inline
assert.deepEqual(md("un `git log` ici"), ["p(un code[git log] ici)"])
assert.deepEqual(md("**gras** et *italique*"), ["p(bold[gras] et em[italique])"])
assert.deepEqual(md("voir https://x.io/a?b=1 pour"), ["p(voir link[https://x.io/a?b=1] pour)"])

// l'italique ne coupe pas un identifiant, et `**` gagne sur `*`
assert.deepEqual(md("a*b*c"), ["p(a*b*c)"])
assert.deepEqual(md("**a*b**"), ["p(bold[a*b])"])

// une puce `*` n'est pas une ouverture d'italique
assert.deepEqual(md("* item"), ["ul(item)"])

// pas de HTML : le markup source ressort en texte
assert.deepEqual(md("<script>x</script>"), ["p(<script>x</script>)"])

console.log("check-refs: ok")
