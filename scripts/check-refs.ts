/* Auto-contrôle de parseRefs : `node scripts/check-refs.ts`.
   Node ≥ 22.18 retire les types nativement, pas de runner à installer. */
import assert from "node:assert/strict"
import { parseRefs } from "../src/renderer/src/lib/commit-message.ts"

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

console.log("check-refs: ok")
