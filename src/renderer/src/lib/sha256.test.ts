/* Migrated from scripts/check-sha256.ts (AUDIT.md §10, tests item): indistinguishable from
   node:crypto, FIPS vectors and accented emails included — the homemade implementation exists
   only to keep the renderer sandbox intact (crypto.subtle is async-only). */
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { describe, it } from "vitest"

import { sha256 } from "./sha256.ts"

const ref = (s: string) => createHash("sha256").update(s, "utf8").digest("hex")

describe("sha256", () => {
  it("matches the FIPS 180-4 vectors (empty, one block, two blocks)", () => {
    /* the padding straddles the block boundary on the 3rd vector */
    assert.equal(sha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
    assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
    assert.equal(
      sha256("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"
    )
  })

  it("matches node:crypto around block boundaries (55/56/63/64/65 bytes…)", () => {
    for (const n of [1, 3, 31, 32, 55, 56, 57, 63, 64, 65, 127, 128, 129, 1000])
      assert.equal(sha256("a".repeat(n)), ref("a".repeat(n)), `length ${n}`)
  })

  it("matches node:crypto on a real Gravatar key (accents, multi-byte UTF-8)", () => {
    for (const s of ["ada@x.io", "prénom.nom@société.fr", "émoji-🐙@x.io", "mathieu@exemple.fr "])
      assert.equal(sha256(s), ref(s), s)
  })
})
