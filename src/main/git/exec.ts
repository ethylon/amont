/* The spawn wrapper: the single point through which every git command passes (AUDIT.md §4,
   "main" workstream, item `git/exec.ts`). Compared to the old `git()` in main/index.js:
   - end-to-end AbortSignal (targeted cancellation, cf. shared/ipc-contract.ts `repo:cancel`);
   - default timeout for reads (~60s; it used to be infinite), SIGTERM → SIGKILL escalation;
   - stdout accumulation cap (a pathological `repo:diff` could approach V8's string limit);
   - the trace emitter is injected by the caller (RunnerContext.trace) rather than read from a
     global `mainWindow`, and the tab tag is provided directly — no more reverse path→tab lookup
     (the old `traceId`);
   - each child registers itself in a `Set` provided by the caller: `killAll()` terminates them
     all at once (closeRepo, window close — fix B4). */

import { execFile, spawn, type ChildProcess } from "node:child_process"

import { AppError } from "../../shared/errors.ts"
import type { DistributiveOmit, TraceLine } from "../../shared/types.ts"
import { classifyGitFailure, parseProgressPercent } from "./parse.ts"
import { gitVerb, type GitFailureInfo } from "./telemetry-scrub.ts"

/* GIT_TERMINAL_PROMPT=0: without a TTY, a git command asking for a password would hang
   indefinitely. Graphical credential helpers (GCM) remain usable.
   GIT_EDITOR: belt-and-braces — every command that could want an editor (tag -a, merge) is
   passed an explicit `-m`/no-edit, `true` turns any leftover case into a clean failure. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no" }

/** Reads: 60s. Network operations and pickaxe search pass their own timeout
    (longer or shorter), cf. git/ops.ts and git/queries.ts. */
export const DEFAULT_TIMEOUT = 60_000
/** Network operations, merges, branch actions, `flow finish`: longer than the default read
    timeout — a fetch or push on a slow connection shouldn't be cut off at 60s. */
export const OP_TIMEOUT = 90_000
/** A pathological `repo:diff` or `log` shouldn't approach V8's string limit. */
const OUTPUT_CAP = 64 * 1024 * 1024
/** Grace period between SIGTERM and SIGKILL: a git process finishing its last chunk of output
    shouldn't be brutally killed if one more second would do. */
const KILL_GRACE_MS = 3_000

export interface RunOpts {
  /** 0 = no timeout (rare escape hatch; defaults to DEFAULT_TIMEOUT). */
  timeout?: number
  /** sent over stdin (e.g. rev-list's `--stdin`, `--pathspec-from-file=-`): lists that would
      exceed Windows' command-line length limit go through without issue. */
  input?: string
  signal?: AbortSignal
  /** Exit codes to treat as success besides 0 (stdout resolves as usual). `merge-tree
      --write-tree` exits 1 to say "conflicts" while printing the result we came for. */
  okCodes?: number[]
  /** Live progress callback for long-running commands (fsck/gc): fired with the latest `NN%`
      parsed from git's stderr as it rewrites its progress line. Set only where a UI wants it —
      other commands pay nothing. */
  onProgress?: (percent: number) => void
  /** Extra environment merged over the base GIT_ENV — the typed console adds
      GIT_ALLOW_PROTOCOL so a `fetch "ext::sh -c …"` can't become command execution
      (cf. git/console.ts). */
  env?: Record<string, string>
}

export interface RunnerContext {
  path: string
  /** trace emitter for this tab, already tagged with its id — injected by the caller
      (repos.ts knows the id at the time it builds the runner), never read from a global. */
  trace?: (line: DistributiveOmit<TraceLine, "id">) => void
  /** telemetry hook, fired on every failed command — a Sentry breadcrumb in production
      (main/telemetry.ts addGitBreadcrumb). Injected like `trace`, so this module keeps
      importing nothing Electron-bound (packs.test.ts runs it under plain Node). */
  onFailure?: (info: GitFailureInfo) => void
  /** in-flight children of this repo; the caller kills them all at `closeRepo` / app close. */
  children: Set<ChildProcess>
}

export interface GitRunner {
  git(args: string[], opts?: RunOpts): Promise<string>
  /** `diff --no-index` against a path outside the repo (untracked file): exit 1 is the
      normal case (a difference exists), not a failure — so it doesn't go through `git()`. */
  diffNoIndex(a: string, b: string): Promise<string>
  /** Raw stdout as a Buffer, not decoded as utf8: `cat-file blob` on an image or any other
      binary object would be corrupted by the StringDecoder that `git()` installs. */
  gitBuffer(args: string[]): Promise<Buffer>
}

function killGracefully(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  const grace = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }, KILL_GRACE_MS)
  child.once("exit", () => clearTimeout(grace))
}

/** Terminates all children of a repo (closeRepo, window close): a window closed
    mid-fetch shouldn't leave an orphaned process running (fix B4). */
export function killAll(children: Set<ChildProcess>): void {
  for (const child of children) killGracefully(child)
}

export function createGitRunner(ctx: RunnerContext): GitRunner {
  function git(args: string[], opts: RunOpts = {}): Promise<string> {
    ctx.trace?.({ kind: "cmd", text: `git ${args.join(" ")}` })
    const started = Date.now()

    if (opts.signal?.aborted) return Promise.reject(new AppError("ABORTED"))

    return new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", ctx.path, ...args], {
        env: opts.env ? { ...GIT_ENV, ...opts.env } : GIT_ENV,
        windowsHide: true,
      })
      ctx.children.add(child)
      child.stdin.on("error", () => {}) // git may exit without reading: EPIPE, harmless
      child.stdin.end(opts.input ?? "")

      let out = "",
        errAll = "",
        pending = ""
      let killedBy: "timeout" | "abort" | "limit" | null = null

      /* setEncoding sets up a StringDecoder: a UTF-8 sequence split across two chunks gets
         reassembled, whereas `buf += chunk` would corrupt it. */
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (d: string) => {
        if (killedBy) return
        out += d
        if (out.length > OUTPUT_CAP) {
          killedBy = "limit"
          killGracefully(child)
        }
      })
      /* git rewrites its progress with \r on the same line: we only push on \n, so one
         line per completed step ("Receiving objects: 100% …"), without flooding the IPC stream. */
      child.stderr.on("data", (d: string) => {
        errAll += d
        /* progress is rewritten with `\r`, so scan the raw chunk (not the `\n`-buffered lines
           below, which would only surface the final percentage of each phase) */
        if (opts.onProgress) {
          const pct = parseProgressPercent(d)
          if (pct !== null) opts.onProgress(pct)
        }
        pending += d
        const lines = pending.split("\n")
        pending = lines.pop() ?? ""
        for (const l of lines) {
          const t = l.replace(/\r+$/, "")
          if (t) ctx.trace?.({ kind: "out", text: t })
        }
      })

      const timeout = opts.timeout ?? DEFAULT_TIMEOUT
      const timer = timeout
        ? setTimeout(() => {
            killedBy = "timeout"
            killGracefully(child)
          }, timeout)
        : undefined
      const onAbort = () => {
        killedBy = "abort"
        killGracefully(child)
      }
      opts.signal?.addEventListener("abort", onAbort)

      const cleanup = () => {
        clearTimeout(timer)
        opts.signal?.removeEventListener("abort", onAbort)
        ctx.children.delete(child)
      }

      child.on("error", (err) => {
        cleanup()
        const ms = Date.now() - started
        ctx.trace?.({ kind: "exit", ok: false, ms })
        const failure = classifyGitFailure({ exitCode: null, stdout: out, stderr: err.message, killedBy })
        ctx.onFailure?.({ verb: gitVerb(args), code: failure.code, exitCode: null, ms })
        reject(new AppError(failure.code, failure.detail))
      })
      child.on("close", (code) => {
        cleanup()
        const t = pending.replace(/\r+$/, "")
        if (t) ctx.trace?.({ kind: "out", text: t })
        const ms = Date.now() - started
        if (killedBy) {
          ctx.trace?.({ kind: "exit", ok: false, ms })
          const failure = classifyGitFailure({ exitCode: code, stdout: out, stderr: errAll, killedBy })
          ctx.onFailure?.({ verb: gitVerb(args), code: failure.code, exitCode: code, ms })
          return reject(new AppError(failure.code, failure.detail))
        }
        if (code !== 0 && !(code !== null && opts.okCodes?.includes(code))) {
          ctx.trace?.({ kind: "exit", ok: false, ms })
          const failure = classifyGitFailure({ exitCode: code, stdout: out, stderr: errAll, killedBy: null })
          ctx.onFailure?.({ verb: gitVerb(args), code: failure.code, exitCode: code, ms })
          return reject(new AppError(failure.code, failure.detail))
        }
        ctx.trace?.({ kind: "exit", ok: true, ms })
        resolve(out)
      })
    })
  }

  function diffNoIndex(a: string, b: string): Promise<string> {
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        ["-C", ctx.path, "diff", "--no-index", "--", a, b],
        { maxBuffer: OUTPUT_CAP, env: GIT_ENV, windowsHide: true, timeout: DEFAULT_TIMEOUT, killSignal: "SIGKILL" },
        (err, stdout) => {
          ctx.children.delete(child)
          /* Don't swallow the two failures that would otherwise pass as an empty diff: a
             pathological or non-regular file blowing past the buffer cap, and a hang caught by
             the timeout. `exit 1` ("there is a diff") stays the nominal, non-error case. */
          if (err && (err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
            ctx.onFailure?.({ verb: "diff --no-index", code: "OUTPUT_LIMIT", exitCode: null, ms: Date.now() - started })
            return reject(new AppError("OUTPUT_LIMIT"))
          }
          if (err && (err as { killed?: boolean }).killed) {
            ctx.onFailure?.({ verb: "diff --no-index", code: "TIMEOUT", exitCode: null, ms: Date.now() - started })
            return reject(new AppError("TIMEOUT"))
          }
          resolve(stdout || "")
        }
      )
      ctx.children.add(child)
    })
  }

  /* Binary read (image preview, cf. git/queries.ts blob()). Unlike git(), stdout is collected
     as a Buffer — no utf8 decoding — so image bytes survive intact. execFile buffers the whole
     output; the caller checks `cat-file -s` first and never asks for a blob past the cap, so
     `maxBuffer` here is only a backstop. */
  function gitBuffer(args: string[]): Promise<Buffer> {
    ctx.trace?.({ kind: "cmd", text: `git ${args.join(" ")}` })
    const started = Date.now()
    return new Promise((resolve, reject) => {
      const child = execFile(
        "git",
        ["-C", ctx.path, ...args],
        {
          maxBuffer: OUTPUT_CAP,
          encoding: "buffer",
          env: GIT_ENV,
          windowsHide: true,
          timeout: DEFAULT_TIMEOUT,
          killSignal: "SIGKILL",
        },
        (err, stdout) => {
          ctx.children.delete(child)
          if (err) {
            const ms = Date.now() - started
            if ((err as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
              ctx.onFailure?.({ verb: gitVerb(args), code: "OUTPUT_LIMIT", exitCode: null, ms })
              return reject(new AppError("OUTPUT_LIMIT"))
            }
            if ((err as { killed?: boolean }).killed) {
              ctx.onFailure?.({ verb: gitVerb(args), code: "TIMEOUT", exitCode: null, ms })
              return reject(new AppError("TIMEOUT"))
            }
            const failure = classifyGitFailure({ exitCode: null, stdout: "", stderr: err.message, killedBy: null })
            ctx.onFailure?.({ verb: gitVerb(args), code: failure.code, exitCode: null, ms })
            return reject(new AppError(failure.code, failure.detail))
          }
          resolve(stdout)
        }
      )
      ctx.children.add(child)
    })
  }

  return { git, diffNoIndex, gitBuffer }
}
