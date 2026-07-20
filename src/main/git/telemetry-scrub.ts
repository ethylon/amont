/* Pure helpers for the Sentry reporting of git failures (spec: docs/superpowers/specs/
   2026-07-20-git-errors-sentry-design.md). Zero import, runnable under Node as-is — this is
   the unit-test surface of the telemetry workstream, like parse.ts is for the parsers; the
   Sentry calls themselves live in main/telemetry.ts, Electron-bound and untested.

   Privacy is the design constraint (cf. main/telemetry.ts header): nothing user-identifying
   may leave — no absolute path, URL, host, credential, branch or file name, email, or sha.
   sanitizeDetail() enforces that on git's stderr; gitVerb() never even looks at arguments. */

/* Second tokens that name the operation (`stash pop`, `config --unset`): a closed list, so a
   sha, a path or a branch sitting in second position can never end up in telemetry. */
const SUBVERBS = new Set(["pop", "push", "list", "show", "blob", "--unset", "--get-regexp", "--write-tree"])

/** The failed command's label for breadcrumbs and events: the git subcommand, never its args. */
export function gitVerb(args: string[]): string {
  const first = args[0] ?? ""
  const second = args[1]
  return second !== undefined && SUBVERBS.has(second) ? `${first} ${second}` : first
}

/* The scrub pipeline, in dependency order: URLs before emails (an scp-like remote
   `git@host:path` would otherwise half-match as an email), paths before shas (a hex run
   inside a replaced path is already gone), quotes last (they may wrap any of the above and
   normalize whatever remains). Char classes stop at whitespace and quotes so a quoted path
   scrubs to a quoted placeholder, not past the closing quote. */
const SCHEME_URL = /[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi
const SCP_URL = /[\w.+-]+@[\w.-]+:[^\s"']+/g
const HOST = /\bhost:\s*[\w.-]+/gi
const WIN_PATH = /\b[a-z]:[\\/][^\s"']*/gi
const UNC_PATH = /\\\\[^\s"']+/g
/* Anchored on the preceding character: `refs/heads/x` must survive (no leading slash),
   only genuinely absolute (or ~-relative) paths are user data. */
const ABS_PATH = /(^|[\s"'=(])(?:\/|~\/)[^\s"']*/g
const EMAIL = /[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi
const SHA = /\b[0-9a-f]{7,40}\b/gi
const SINGLE_QUOTED = /'[^']*'/g
const DOUBLE_QUOTED = /"[^"]*"/g

/** Scrub an AppError `detail` (git's `fatal:` line, cf. parse.ts classifyGitFailure) down to
    what telemetry may carry: the shape of the message, never its user data. First line only —
    multi-line messages list files. */
export function sanitizeDetail(detail: string): string {
  return detail
    .split("\n", 1)[0]
    .trim()
    .replace(SCHEME_URL, "<url>")
    .replace(SCP_URL, "<url>")
    .replace(HOST, "host: <host>")
    .replace(WIN_PATH, "<path>")
    .replace(UNC_PATH, "<path>")
    .replace(ABS_PATH, (m, prefix: string) => `${prefix}<path>`)
    .replace(EMAIL, "<email>")
    .replace(SHA, "<sha>")
    .replace(SINGLE_QUOTED, "'<ref>'")
    .replace(DOUBLE_QUOTED, "'<ref>'")
    .slice(0, 300)
}

/* A failing network op (fetch/pull/push) whose stderr matches one of these is environment,
   not bug: offline laptop, VPN down, flaky remote. Never captured for runOp — the dedup
   would bound the noise, but an issue nobody can act on is still noise. */
const NETWORK_NOISE = [
  "could not resolve host",
  "unable to access",
  "connection timed out",
  "connection refused",
  "could not read from remote repository",
  "no route to host",
  "network is unreachable",
  "operation timed out",
  "early eof",
  "the remote end hung up",
]

/** Whether a failure detail reads as an environmental network error. */
export function isNetworkNoise(detail: string): boolean {
  const lower = detail.toLowerCase()
  return NETWORK_NOISE.some((pattern) => lower.includes(pattern))
}

/* Session dedup: a given scope×code pair sends one event per app run — Sentry's per-issue
   event count keeps the cross-session frequency readable, repeats only cost their breadcrumb. */
const sent = new Set<string>()

/** True exactly once per scope×code pair per app run. */
export function shouldSend(scope: string, code: string): boolean {
  const key = `${scope}\0${code}`
  if (sent.has(key)) return false
  sent.add(key)
  return true
}

export function resetDedupForTests(): void {
  sent.clear()
}
