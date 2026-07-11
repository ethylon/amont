import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Repo } from "@/lib/git"
import { afterClose, HOME, navKeyEquals, repoKey, transitionKind } from "./navigation.ts"

const repo = (id: number, name = `r${id}`): Repo => ({ id, path: `/repo/${name}`, name })

describe("navKeyEquals", () => {
  it("deux HOME sont égales", () => {
    assert.equal(navKeyEquals(HOME, HOME), true)
  })
  it("deux repoKey du même id sont égales", () => {
    assert.equal(navKeyEquals(repoKey(1), repoKey(1)), true)
  })
  it("HOME et un repoKey ne sont jamais égaux", () => {
    assert.equal(navKeyEquals(HOME, repoKey(1)), false)
  })
  it("deux repoKey d'ids différents ne sont pas égales", () => {
    assert.equal(navKeyEquals(repoKey(1), repoKey(2)), false)
  })
})

describe("transitionKind", () => {
  const tabs = [repo(1), repo(2), repo(3)]

  it("une clé absente des onglets ouvre de face", () => {
    assert.equal(transitionKind(tabs, HOME, repoKey(42)), "open")
  })

  it("l'accueil n'est jamais 'open' : il est toujours en position 0", () => {
    assert.equal(transitionKind(tabs, repoKey(1), HOME), "prev")
  })

  it("avancer vers un onglet plus à droite glisse en 'next'", () => {
    assert.equal(transitionKind(tabs, repoKey(1), repoKey(3)), "next")
  })

  it("revenir vers un onglet plus à gauche glisse en 'prev'", () => {
    assert.equal(transitionKind(tabs, repoKey(3), repoKey(1)), "prev")
  })

  it("de l'accueil vers le premier onglet : 'next'", () => {
    assert.equal(transitionKind(tabs, HOME, repoKey(1)), "next")
  })
})

describe("afterClose", () => {
  const tabs = [repo(1), repo(2), repo(3)]

  it("fermer un onglet qui n'est pas actif laisse l'actif inchangé", () => {
    assert.deepEqual(afterClose(tabs, repoKey(2), 3), repoKey(2))
  })

  it("fermer l'onglet actif retombe sur son voisin de droite (même index)", () => {
    assert.deepEqual(afterClose(tabs, repoKey(1), 1), repoKey(2))
  })

  it("fermer le dernier onglet actif retombe sur son voisin de gauche", () => {
    assert.deepEqual(afterClose(tabs, repoKey(3), 3), repoKey(2))
  })

  it("fermer le seul onglet actif retombe sur l'accueil", () => {
    assert.deepEqual(afterClose([repo(1)], repoKey(1), 1), HOME)
  })

  it("fermer un onglet inconnu (déjà fermé) est un no-op", () => {
    assert.deepEqual(afterClose(tabs, repoKey(2), 99), repoKey(2))
  })

  it("l'accueil actif n'est jamais affecté par une fermeture", () => {
    assert.deepEqual(afterClose(tabs, HOME, 2), HOME)
  })
})
