/* decodeError is the most fragile point of the "errors" workstream (AUDIT.md §4): it has to
   reconstruct { code, detail } from whatever Electron lets through from a throw crossing
   the IPC boundary. Verified empirically against the real app (Electron 43, cf. PR): the
   message received is NOT bare JSON — Electron prepends a prefix to it, something the
   electron.d.ts docs gave no hint of. These tests pin down this observed format so that a
   regression (or a prefix change in a future Electron version) breaks here rather than
   silently on the renderer side. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { AppError, decodeError } from "./errors.ts"

describe("decodeError", () => {
  it("reads code/detail directly off a local AppError (before any IPC crossing)", () => {
    const err = new AppError("NOT_A_REPO")
    assert.deepEqual(decodeError(err), { code: "NOT_A_REPO", detail: undefined })
  })

  it("preserves a local AppError's detail", () => {
    const err = new AppError("BAD_ARG", "hash")
    assert.deepEqual(decodeError(err), { code: "BAD_ARG", detail: "hash" })
  })

  it("decodes the real format observed after an IPC crossing (Electron prefix + AppError:)", () => {
    /* captured from the real app: `Error invoking remote method 'repo:checkout': AppError: {...}` */
    const message = `Error invoking remote method 'repo:checkout': AppError: {"code":"GIT_FAILED","detail":"pathspec 'x' did not match any file(s) known to git (exit 1)"}`
    const err = new Error(message)
    assert.deepEqual(decodeError(err), {
      code: "GIT_FAILED",
      detail: "pathspec 'x' did not match any file(s) known to git (exit 1)",
    })
  })

  it("stays robust if the detail itself contains braces", () => {
    const message = `Error invoking remote method 'x': AppError: {"code":"GIT_FAILED","detail":"unexpected token } in JSON"}`
    assert.deepEqual(decodeError(new Error(message)), {
      code: "GIT_FAILED",
      detail: "unexpected token } in JSON",
    })
  })

  it("falls back to UNKNOWN for an unstructured error (bug, third-party lib)", () => {
    const err = new Error("Cannot read properties of undefined (reading 'foo')")
    assert.deepEqual(decodeError(err), {
      code: "UNKNOWN",
      detail: "Cannot read properties of undefined (reading 'foo')",
    })
  })

  it("falls back to UNKNOWN for a value that isn't an Error", () => {
    assert.deepEqual(decodeError("plain string"), { code: "UNKNOWN", detail: "plain string" })
  })
})
