/* Auto-contrôle de lib/sha256.ts contre node:crypto : `node scripts/check-sha256.ts`.
   L'implémentation maison n'existe que pour garder le sandbox du renderer ; elle doit être
   indiscernable de la référence, vecteurs FIPS et e-mails accentués compris. */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { sha256 } from "../src/renderer/src/lib/sha256.ts"

const ref = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

// vecteurs FIPS 180-4 : vide, un bloc, deux blocs (le padding chevauche la frontière)
assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
assert.equal(
  sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
  "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
)

// tailles autour des frontières de bloc (55/56/63/64/65 octets) : le padding a des cas limites
for (const n of [1, 3, 31, 32, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000])
  assert.equal(sha256("a".repeat(n)), ref("a".repeat(n)), `longueur ${n}`)

// la clé Gravatar réelle : des e-mails, accents et multi-octets UTF-8 compris
for (const s of ["ada@x.io", "prénom.nom@société.fr", "émoji-🐙@x.io", "mathieu@exemple.fr "])
  assert.equal(sha256(s), ref(s), s)

console.log("check-sha256: ok")
