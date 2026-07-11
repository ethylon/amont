/* Le spawn wrapper : point unique par lequel toute commande git passe (AUDIT.md §4, chantier
   « main », item `git/exec.ts`). Par rapport à l'ancien `git()` de main/index.js :
   - AbortSignal de bout en bout (annulation ciblée, cf. shared/ipc-contract.ts `repo:cancel`) ;
   - timeout par défaut pour les lectures (~60 s ; c'était infini), escalade SIGTERM → SIGKILL ;
   - plafond d'accumulation stdout (un `repo:diff` pathologique pouvait approcher la limite de
     string V8) ;
   - l'émetteur de trace est injecté par l'appelant (RunnerContext.trace) plutôt que lu sur un
     `mainWindow` global, et le tag d'onglet est fourni directement — fini le scan inverse
     path→tab (l'ancien `traceId`) ;
   - chaque enfant s'enregistre dans un `Set` fourni par l'appelant : `killAll()` les termine
     tous d'un coup (closeRepo, fermeture de la fenêtre — fix B4). */

import { execFile, spawn, type ChildProcess } from "node:child_process"

import { AppError } from "../../shared/errors.ts"
import type { DistributiveOmit, TraceLine } from "../../shared/types.ts"
import { classifyGitFailure } from "./parse.ts"

/* GIT_TERMINAL_PROMPT=0 : sans TTY, un git qui demande un mot de passe se bloquerait
   indéfiniment. Les helpers de credentials graphiques (GCM) restent utilisables.
   GIT_EDITOR : git n'ouvre pas d'éditeur sans TTY, mais `git flow` est un script shell qui,
   lui, en réclame un pour son tag annoté. `true` le transforme en échec propre. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no" }

/** Lectures : 60 s. Les opérations réseau et la recherche pickaxe passent leur propre timeout
    (plus long ou plus court), cf. git/ops.ts et git/queries.ts. */
export const DEFAULT_TIMEOUT = 60_000
/** Opérations réseau, merges, actions de branche, `flow finish` : plus long que la lecture par
    défaut — un fetch ou un push sur une connexion lente ne doit pas être coupé à 60 s. */
export const OP_TIMEOUT = 90_000
/** Un `repo:diff` ou un `log` pathologique ne doit pas viser la limite de string de V8. */
const OUTPUT_CAP = 64 * 1024 * 1024
/** Grâce laissée entre SIGTERM et SIGKILL : un git qui finit d'écrire son dernier chunk ne doit
    pas être tué à la sauvage si une seconde suffit. */
const KILL_GRACE_MS = 3_000

export interface RunOpts {
  /** 0 = pas de timeout (échappatoire rare ; par défaut DEFAULT_TIMEOUT). */
  timeout?: number
  /** part sur stdin (ex. `--stdin` de rev-list, `--pathspec-from-file=-`) : des listes qui
      dépasseraient la limite de ligne de commande de Windows y passent sans encombre. */
  input?: string
  signal?: AbortSignal
}

export interface RunnerContext {
  path: string
  /** émetteur de trace pour cet onglet, déjà tagué par son id — injecté par l'appelant
      (repos.ts connaît l'id au moment où il construit le runner), jamais lu sur un global. */
  trace?: (line: DistributiveOmit<TraceLine, "id">) => void
  /** enfants en vol de ce dépôt ; l'appelant les tue tous à `closeRepo` / fermeture d'app. */
  children: Set<ChildProcess>
}

export interface GitRunner {
  git(args: string[], opts?: RunOpts): Promise<string>
  /** `diff --no-index` contre un chemin hors dépôt (fichier non suivi) : l'exit 1 est le cas
      nominal (une différence existe), pas un échec — ne passe donc pas par `git()`. */
  diffNoIndex(a: string, b: string): Promise<string>
}

function killGracefully(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  const grace = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
  }, KILL_GRACE_MS)
  child.once("exit", () => clearTimeout(grace))
}

/** Termine tous les enfants d'un dépôt (closeRepo, fermeture de fenêtre) : une fenêtre fermée
    en plein fetch ne doit pas laisser un process orphelin tourner (fix B4). */
export function killAll(children: Set<ChildProcess>): void {
  for (const child of children) killGracefully(child)
}

export function createGitRunner(ctx: RunnerContext): GitRunner {
  function git(args: string[], opts: RunOpts = {}): Promise<string> {
    ctx.trace?.({ kind: "cmd", text: `git ${args.join(" ")}` })
    const started = Date.now()

    if (opts.signal?.aborted) return Promise.reject(new AppError("ABORTED"))

    return new Promise((resolve, reject) => {
      const child = spawn("git", ["-C", ctx.path, ...args], { env: GIT_ENV, windowsHide: true })
      ctx.children.add(child)
      child.stdin.on("error", () => {}) // git peut se terminer sans lire : EPIPE sans conséquence
      child.stdin.end(opts.input ?? "")

      let out = "", errAll = "", pending = ""
      let killedBy: "timeout" | "abort" | "limit" | null = null

      /* setEncoding pose un StringDecoder : une séquence UTF-8 coupée entre deux chunks est
         recollée, là où `buf += chunk` la corromprait. */
      child.stdout.setEncoding("utf8")
      child.stderr.setEncoding("utf8")
      child.stdout.on("data", (d: string) => {
        if (killedBy) return
        out += d
        if (out.length > OUTPUT_CAP) { killedBy = "limit"; killGracefully(child) }
      })
      /* git réécrit sa progression avec \r sur une même ligne : on ne pousse qu'aux \n, donc une
         ligne par étape terminée (« Receiving objects: 100% … »), sans inonder le flux d'IPC. */
      child.stderr.on("data", (d: string) => {
        errAll += d
        pending += d
        const lines = pending.split("\n")
        pending = lines.pop() ?? ""
        for (const l of lines) {
          const t = l.replace(/\r+$/, "")
          if (t) ctx.trace?.({ kind: "out", text: t })
        }
      })

      const timeout = opts.timeout ?? DEFAULT_TIMEOUT
      const timer = timeout ? setTimeout(() => { killedBy = "timeout"; killGracefully(child) }, timeout) : undefined
      const onAbort = () => { killedBy = "abort"; killGracefully(child) }
      opts.signal?.addEventListener("abort", onAbort)

      const cleanup = () => {
        clearTimeout(timer)
        opts.signal?.removeEventListener("abort", onAbort)
        ctx.children.delete(child)
      }

      child.on("error", (err) => {
        cleanup()
        ctx.trace?.({ kind: "exit", ok: false, ms: Date.now() - started })
        const failure = classifyGitFailure({ exitCode: null, stdout: out, stderr: err.message, killedBy })
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
          return reject(new AppError(failure.code, failure.detail))
        }
        if (code !== 0) {
          ctx.trace?.({ kind: "exit", ok: false, ms })
          const failure = classifyGitFailure({ exitCode: code, stdout: out, stderr: errAll, killedBy: null })
          return reject(new AppError(failure.code, failure.detail))
        }
        ctx.trace?.({ kind: "exit", ok: true, ms })
        resolve(out)
      })
    })
  }

  function diffNoIndex(a: string, b: string): Promise<string> {
    return new Promise((resolve) => {
      const child = execFile(
        "git", ["-C", ctx.path, "diff", "--no-index", "--", a, b],
        { maxBuffer: OUTPUT_CAP, env: GIT_ENV, windowsHide: true },
        (_err, stdout) => { ctx.children.delete(child); resolve(stdout || "") }
      )
      ctx.children.add(child)
    })
  }

  return { git, diffNoIndex }
}
