/* decodeError est le point le plus fragile du chantier « erreurs » (AUDIT.md §4) : il doit
   reconstituer { code, detail } depuis ce qu'Electron laisse passer d'un throw traversant
   l'IPC. Vérifié empiriquement contre l'app réelle (Electron 43, cf. PR) : le message reçu
   n'est PAS le JSON nu — Electron y ajoute un préfixe, ce que la doc d'electron.d.ts ne laissait
   pas deviner. Ces tests figent ce format observé pour qu'une régression (ou un changement de
   préfixe d'une future version d'Electron) casse ici plutôt qu'en silence côté renderer. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { AppError, decodeError } from "./errors.ts"

describe("decodeError", () => {
  it("lit directement code/detail sur une AppError locale (avant toute traversée d'IPC)", () => {
    const err = new AppError("NOT_A_REPO")
    assert.deepEqual(decodeError(err), { code: "NOT_A_REPO", detail: undefined })
  })

  it("préserve le detail d'une AppError locale", () => {
    const err = new AppError("BAD_ARG", "hash")
    assert.deepEqual(decodeError(err), { code: "BAD_ARG", detail: "hash" })
  })

  it("décode le format réel observé après une traversée d'IPC (préfixe Electron + AppError:)", () => {
    /* capturé sur l'app réelle : `Error invoking remote method 'repo:checkout': AppError: {...}` */
    const message = `Error invoking remote method 'repo:checkout': AppError: {"code":"GIT_FAILED","detail":"pathspec 'x' did not match any file(s) known to git (exit 1)"}`
    const err = new Error(message)
    assert.deepEqual(decodeError(err), {
      code: "GIT_FAILED",
      detail: "pathspec 'x' did not match any file(s) known to git (exit 1)",
    })
  })

  it("reste robuste si le detail contient lui-même des accolades", () => {
    const message = `Error invoking remote method 'x': AppError: {"code":"GIT_FAILED","detail":"unexpected token } in JSON"}`
    assert.deepEqual(decodeError(new Error(message)), {
      code: "GIT_FAILED",
      detail: "unexpected token } in JSON",
    })
  })

  it("retombe sur UNKNOWN pour une erreur non structurée (bug, lib tierce)", () => {
    const err = new Error("Cannot read properties of undefined (reading 'foo')")
    assert.deepEqual(decodeError(err), {
      code: "UNKNOWN",
      detail: "Cannot read properties of undefined (reading 'foo')",
    })
  })

  it("retombe sur UNKNOWN pour une valeur qui n'est pas une Error", () => {
    assert.deepEqual(decodeError("plain string"), { code: "UNKNOWN", detail: "plain string" })
  })
})
