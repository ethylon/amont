/* Auto-contrôle du parseur `--name-status -z` de src/main/name-status.js :
   `node scripts/check-files.ts`. Les cas que le split('\n')/split('\t') d'avant cassait —
   chemins C-quotés (non-ASCII), tab et saut de ligne dans un nom — et le layout à trois
   champs des renames/copies (`Rnn NUL ancien NUL nouveau NUL`). */
import assert from "node:assert/strict"
import { parseNameStatus } from "../src/main/name-status.ts"

const NUL = "\0"

// sortie vide (commit sans fichier) : rien, pas de ligne fantôme sur le NUL final
assert.deepEqual(parseNameStatus(""), [])
assert.deepEqual(parseNameStatus(NUL), [])

// entrées simples : un statut, un chemin
assert.deepEqual(parseNameStatus(`A${NUL}src/a.ts${NUL}M${NUL}b.md${NUL}D${NUL}c${NUL}`), [
  { st: "A", path: "src/a.ts", old: null },
  { st: "M", path: "b.md", old: null },
  { st: "D", path: "c", old: null },
])

// rename : le score (R100) tombe, l'ancien chemin précède le nouveau
assert.deepEqual(parseNameStatus(`R100${NUL}old/name.ts${NUL}new/name.ts${NUL}`), [
  { st: "R", path: "new/name.ts", old: "old/name.ts" },
])

// copy : même layout à trois champs que le rename
assert.deepEqual(parseNameStatus(`C75${NUL}src/base.ts${NUL}src/copie.ts${NUL}`), [
  { st: "C", path: "src/copie.ts", old: "src/base.ts" },
])

/* les chemins qui pulvérisaient le parse ligne/tab : en -z ils sortent bruts,
   sans C-quoting ni ambiguïté de séparateur */
assert.deepEqual(parseNameStatus(`M${NUL}café.txt${NUL}A${NUL}avec\ttab.txt${NUL}A${NUL}avec\nretour.txt${NUL}`), [
  { st: "M", path: "café.txt", old: null },
  { st: "A", path: "avec\ttab.txt", old: null },
  { st: "A", path: "avec\nretour.txt", old: null },
])

// rename vers un nom exotique : les trois champs restent alignés
assert.deepEqual(parseNameStatus(`R087${NUL}a b.txt${NUL}dossier accentué/é\tè.txt${NUL}M${NUL}suite.ts${NUL}`), [
  { st: "R", path: "dossier accentué/é\tè.txt", old: "a b.txt" },
  { st: "M", path: "suite.ts", old: null },
])

// sortie tronquée (process tué en vol) : on rend les entrées complètes, sans jeter
assert.deepEqual(parseNameStatus(`M${NUL}ok.ts${NUL}R100${NUL}orphelin`), [
  { st: "M", path: "ok.ts", old: null },
])

console.log("check-files: ok")
