/* Localization of structured errors (AUDIT.md §4, "errors" workstream). The main process no
   longer returns pre-formatted French strings: just a code (+ a factual detail — a branch name,
   git's fatal: line…). This is where, and only where, the message shown to the user takes shape. */

import { decodeError, type ErrorPayload } from "../../../shared/errors.ts"

/* re-exported for callers that branch on the code (the merge queue routes MERGE_CONFLICT
   to its conflict state instead of a badge) — the renderer keeps a single import site */
export { decodeError }

const MESSAGES: Record<ErrorPayload["code"], (detail?: string) => string> = {
  NOT_A_REPO: () => "Not a git repository (or git not found)",
  NO_REPO: () => "This repository is no longer open",
  NOT_ALLOWED: () => "Path not allowed",
  EXISTS: (d) => (d ? `Already exists: ${d}` : "The destination already exists"),
  BAD_ARG: (d) => (d ? `Invalid argument: ${d}` : "Invalid argument"),
  /* mutations queue FIFO now (main/repos.ts withLock): BUSY only fires when the queue
     overflows — something is stuck holding the lock while requests pile up */
  BUSY: () => "Too many operations queued — wait for the current one to finish",
  MERGE_CONFLICT: (d) => (d ? `Conflict in: ${d}` : "The merge ended in conflict"),
  STASH_POP_CONFLICT: (d) => `On ${d}, but the stash conflicts — entry kept`,
  NOT_FLOW_BRANCH: (d) => `${d} is not a git-flow branch`,
  NO_UPSTREAM: (d) => `${d} isn't tracking any remote branch`,
  /* normally intercepted upstream (the push flow routes it to the remote-ahead banner,
     cf. useRepoEvents): this text is only the fallback for any other surface */
  REMOTE_AHEAD: (d) =>
    d ? `The remote branch is ahead by ${d} commit(s) — pull first, or force push` : "The remote branch is ahead",
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
