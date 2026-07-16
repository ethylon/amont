/* Localization of structured errors (AUDIT.md §4, "errors" workstream). The main process no
   longer returns pre-formatted French strings: just a code (+ a factual detail — a branch name,
   git's fatal: line…). This is where, and only where, the message shown to the user takes shape. */

import { decodeError, type ErrorPayload } from "../../../shared/errors.ts"

const MESSAGES: Record<ErrorPayload["code"], (detail?: string) => string> = {
  NOT_A_REPO: () => "Not a git repository (or git not found)",
  NO_REPO: () => "This repository is no longer open",
  NOT_ALLOWED: () => "Path not allowed",
  EXISTS: (d) => (d ? `Already exists: ${d}` : "The destination already exists"),
  BAD_ARG: (d) => (d ? `Invalid argument: ${d}` : "Invalid argument"),
  BUSY: () => "An operation is already in progress",
  MERGE_CONFLICT: (d) => (d ? `Conflict in: ${d}` : "The merge ended in conflict"),
  STASH_POP_CONFLICT: (d) => `On ${d}, but the stash conflicts — entry kept`,
  NOT_FLOW_BRANCH: (d) => `${d} is not a git-flow branch`,
  NO_UPSTREAM: (d) => `${d} isn't tracking any remote branch`,
  DIVERGED: (d) => `${d} and its remote branch have diverged — reconcile them first`,
  TIMEOUT: () => "git isn't responding (timed out)",
  ABORTED: () => "Operation cancelled",
  OUTPUT_LIMIT: () => "git's output exceeds the allowed limit",
  GIT_FAILED: (d) => d ?? "git failed",
  UNKNOWN: (d) => d ?? "Unknown error",
}

function format(payload: ErrorPayload): string {
  return MESSAGES[payload.code](payload.detail)
}

/** Use on an `invoke` error (a rejection caught by `catch`/`.then(null, …)`). */
export function describeError(err: unknown): string {
  return format(decodeError(err))
}

/** Use on a payload that's already structured (a `git:op` event, which escapes Electron's
    restriction on `invoke` errors and carries `code`/`detail` as-is). */
export function describePayload(payload: ErrorPayload): string {
  return format(payload)
}
