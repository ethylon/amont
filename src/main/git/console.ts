/* The typed console (features/console): the user can run a git command from the popup's
   input. The renderer sends the raw string; EVERYTHING that makes it safe lives here, main
   side — a compromised renderer talking straight to `repo:console` gets the same policy.

   Threat model (same as the rest of the IPC surface, AUDIT.md §4): the renderer is
   semi-trusted, so a typed command must never become arbitrary code execution or an escape
   from the repo. Concretely:
   - no shell, ever: the parsed argv goes to the same `spawn("git", …)` runner as every other
     command. Unquoted shell syntax (`|`, `$(…)`, `>` …) is rejected with a clear error rather
     than silently handed to git as arguments;
   - subcommand allowlist of git builtins: an alias can't shadow a builtin, so `git
     smash` (alias, possibly `!rm -rf`) never runs. config/difftool/submodule/worktree/
     bisect/filter-branch and friends stay out — each has a code-execution or
     path-escape story;
   - no global options: `-c core.fsmonitor=…`, `-C /elsewhere`, `--git-dir`, `--exec-path`
     all die on the "first token must be the subcommand" rule;
   - dangerous per-command options blocked (`--upload-pack`, `--receive-pack`, `--exec`,
     `--output`, grep's `-O`, rebase's `-x`, apply's `--unsafe-paths`), option scanning
     stopping at `--` where pathspecs begin;
   - transports restricted (GIT_ALLOW_PROTOCOL): `fetch "ext::sh -c …"` is command
     execution by design — console commands only speak file/git/http(s)/ssh. `remote
     add`/`set-url` refuse `<helper>::` URLs for the same reason: the URL would sit in
     config and the next background fetch (which doesn't carry the console's env) would
     honor it. */

import { AppError } from "../../shared/errors.ts"
import { withLock, type RepoHandle } from "../repos.ts"
import { OP_TIMEOUT } from "./exec.ts"

/** Builtin subcommands that never spawn other programs and stay inside the repo. Read-only
    ones run outside the mutation queue — `status` while a fetch hangs must not feel stuck. */
const READS = new Set([
  "blame",
  "cat-file",
  "check-ignore",
  "cherry",
  "count-objects",
  "describe",
  "diff",
  "diff-tree",
  "for-each-ref",
  "grep",
  "log",
  "ls-files",
  "ls-remote",
  "ls-tree",
  "merge-base",
  "name-rev",
  "range-diff",
  "reflog",
  "rev-list",
  "rev-parse",
  "shortlog",
  "show",
  "show-branch",
  "show-ref",
  "status",
  "var",
  "version",
  "whatchanged",
])

/** Mutations: through the repo queue (repos.withLock), like every GUI mutation — a typed
    `commit` racing an autofetch would otherwise fight over `.git/index.lock`. */
const MUTATIONS = new Set([
  "add",
  "am",
  "apply",
  "branch",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "fetch",
  "fsck",
  "gc",
  "merge",
  "mv",
  "notes",
  "pack-refs",
  "prune",
  "pull",
  "push",
  "rebase",
  "remote",
  "repack",
  "reset",
  "restore",
  "revert",
  "rm",
  "stash",
  "switch",
  "tag",
])

/* Long options that inject a command to run (`--upload-pack=…` & co on the network commands,
   `--open-files-in-pager` on grep), write files at arbitrary paths (`--output`), or lift
   git's own path confinement (`apply --unsafe-paths`). Matched as `--opt` and `--opt=…`,
   on every allowed subcommand — none of them has a legitimate console use. */
const BLOCKED_LONG = [
  "--config",
  "--config-env",
  "--exec",
  "--ext-diff",
  "--open-files-in-pager",
  "--output",
  "--output-directory",
  "--receive-pack",
  "--unsafe-paths",
  "--upload-pack",
]

/* Short options that alias a blocked long one, per subcommand — as a letter anywhere in a
   single-dash token, because parse-options bundles them (`rebase -fx cmd` reaches `-x`).
   grep's `-O[pager]` opens the matches in an arbitrary program; rebase's `-x <cmd>` runs it. */
const BLOCKED_SHORT: Record<string, RegExp> = { grep: /O/, rebase: /x/ }

/* `<helper>::…` — git-remote-<helper> is a program git runs. Typed directly on fetch/push the
   env below blocks it; written into config by `remote add`/`set-url` it would outlive the
   console and fire on the next background fetch, so those two never accept one. */
const HELPER_URL = /^[A-Za-z0-9.+-]+::/

/** The console's transport policy: no `ext::`/`fd::`/remote helpers, whose "URL" is a command
    line. Everything the GUI itself can produce stays allowed. */
const CONSOLE_ENV = { GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh" }

const INPUT_MAX = 2000

/* Unquoted, these mean "shell" to the user — silently passing them to git as literal
   arguments would look like the pipe/redirect worked. Rejected with the offending character
   as detail; quoting them makes them plain argument text (there is no shell to expand
   anything anyway). */
const SHELL_CHARS = new Set(["|", "&", ";", "<", ">", "(", ")", "`", "$"])

/** Shell-like tokenizer, without a shell: whitespace splits, single quotes are literal,
    double quotes literal too (`\"` and `\\` escaped inside), backslash escapes the next
    character outside quotes. No expansion of any kind. */
function tokenize(input: string): string[] {
  const tokens: string[] = []
  let current = ""
  let started = false
  let i = 0
  const push = (): void => {
    if (started) tokens.push(current)
    current = ""
    started = false
  }
  while (i < input.length) {
    const ch = input[i]
    if (ch === " " || ch === "\t") {
      push()
      i++
    } else if (ch === "'") {
      const end = input.indexOf("'", i + 1)
      if (end === -1) throw new AppError("BAD_ARG", "'")
      current += input.slice(i + 1, end)
      started = true
      i = end + 1
    } else if (ch === '"') {
      started = true
      i++
      let closed = false
      while (i < input.length) {
        const c = input[i]
        if (c === "\\" && (input[i + 1] === '"' || input[i + 1] === "\\")) {
          current += input[i + 1]
          i += 2
        } else if (c === '"') {
          closed = true
          i++
          break
        } else {
          current += c
          i++
        }
      }
      if (!closed) throw new AppError("BAD_ARG", '"')
    } else if (ch === "\\" && i + 1 < input.length) {
      current += input[i + 1]
      started = true
      i += 2
    } else if (SHELL_CHARS.has(ch)) {
      throw new AppError("BAD_ARG", ch)
    } else {
      current += ch
      started = true
      i++
    }
  }
  push()
  return tokens
}

/** Parses and polices a typed command into the argv handed to the runner. Pure — the unit
    test surface (console.test.ts). Throws BAD_ARG on syntax the console doesn't speak,
    NOT_ALLOWED on anything outside the policy above. */
export function parseConsole(input: unknown): string[] {
  if (typeof input !== "string" || !input.trim() || input.length > INPUT_MAX) throw new AppError("BAD_ARG", "command")
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(input)) throw new AppError("BAD_ARG", "command")

  const tokens = tokenize(input)
  if (tokens[0] === "git") tokens.shift() // `git status` and `status` both work
  if (!tokens.length) throw new AppError("BAD_ARG", "command")

  const sub = tokens[0]
  /* no global options: the subcommand comes first, or nothing runs — this single rule kills
     `-c`, `-C`, `--git-dir`, `--work-tree`, `--exec-path`, `--namespace` at once */
  if (sub.startsWith("-")) throw new AppError("NOT_ALLOWED", sub)
  if (!READS.has(sub) && !MUTATIONS.has(sub)) throw new AppError("NOT_ALLOWED", sub)

  const blockedShort = BLOCKED_SHORT[sub]
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === "--") break // pathspecs from here on: `log -- --output=x` is a path, not an option
    if (t.startsWith("--")) {
      if (BLOCKED_LONG.some((b) => t === b || t.startsWith(b + "="))) throw new AppError("NOT_ALLOWED", t)
    } else if (t.startsWith("-") && blockedShort?.test(t)) {
      throw new AppError("NOT_ALLOWED", t)
    }
  }
  /* `remote add`/`set-url`: every bare argument is screened, wherever it sits (name before
     URL, flags in between) and even past a `--` separator — a helper URL must not slip into
     config through argument position games */
  if (sub === "remote" && (tokens.includes("add") || tokens.includes("set-url"))) {
    for (const t of tokens.slice(1)) {
      if (!t.startsWith("-") && HELPER_URL.test(t)) throw new AppError("NOT_ALLOWED", t)
    }
  }
  return tokens
}

/* The popup keeps 500 lines (features/console CAP): re-emitting more stdout than that is
   pure IPC noise — the tail wins, like a scrolled terminal. */
const OUT_LINES_MAX = 400

/** Runs one typed command against the repo. stderr streams live through the runner's own
    trace (git/exec.ts traces cmd/out/exit itself); stdout — what a typed `log` or `status`
    prints, which the runner treats as data and never traces — is re-emitted here as `out`
    lines, capped at the tail. The promise only carries success/failure.
    No `mute()` afterwards, deliberately: unlike GUI actions, the renderer has no idea what a
    typed command changed — the watcher's `changed` event is what refreshes the UI. */
export function runConsole(r: RepoHandle, input: unknown): Promise<void> {
  const args = parseConsole(input)
  const run = async (): Promise<void> => {
    r.events.trace({ kind: "group", text: "Console", ts: Date.now() })
    const out = await r.git(args, { timeout: OP_TIMEOUT, env: CONSOLE_ENV })
    const all = out.replace(/\n+$/, "").split("\n")
    if (all.length === 1 && !all[0]) return
    const tail = all.length > OUT_LINES_MAX ? all.slice(all.length - OUT_LINES_MAX) : all
    if (tail.length < all.length) r.events.trace({ kind: "out", text: `… (${all.length - tail.length} more lines)` })
    for (const text of tail) r.events.trace({ kind: "out", text })
    /* the runner's exit line landed before these: close the stream again, so the feed's
       "busy = last line isn't an exit" heuristic doesn't stick on a finished command */
    r.events.trace({ kind: "exit", ok: true, ms: 0 })
  }
  return READS.has(args[0]) ? run() : withLock(r, args[0], run)
}
