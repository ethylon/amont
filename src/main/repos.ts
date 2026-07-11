/* Registre des dépôts ouverts (AUDIT.md §4) : le renderer ne les désigne que par un id opaque,
   jamais par leur chemin. Un onglet = un repo ouvert ; la fermeture d'onglet passe par
   `repo:close`.

   Réunit ce qui vivait épars dans l'ancien main/index.js : cycle de vie (open/close), mutex de
   mutation par dépôt (fix hygiène — la danse stash→checkout→pop courait sans verrou face à
   l'autofetch), garde de réentrance sur `openRepo` (deux ouvertures concurrentes du même chemin
   ne doivent produire qu'un seul RepoHandle, pas deux watchers/timers dupliqués), et la
   confinement de chemin (`inRepo`, realpath des deux côtés — fix durcissement, symlinks). */

import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { ChildProcess } from "node:child_process"

import { AppError } from "../shared/errors.ts"
import type { DistributiveOmit, OpEvent, Repo, TraceLine } from "../shared/types.ts"
import { createGitRunner, killAll, type GitRunner } from "./git/exec.ts"
import { basename } from "./util.ts"
import { openable, remember } from "./state.ts"
import { watchGit, type Watchable } from "./watcher.ts"

/** Hooks fournis par la couche fenêtre (window.ts), injectés à l'ouverture plutôt que lus sur
    un `mainWindow` global — exec.ts et ce module n'importent `electron` que pour les types. */
export interface RepoHooks {
  trace(line: DistributiveOmit<TraceLine, "id">): void
  op(payload: DistributiveOmit<OpEvent, "id">): void
  changed(): void
  isFocused(): boolean
}

/* Repos ouverts, côté main uniquement. */
export interface RepoHandle extends Watchable {
  /** intervalle d'autofetch ; `null` = aucun (jamais le cas après ouverture, cf. createRepo) */
  timer: NodeJS.Timeout | null
  id: number
  path: string
  /** realpath de `path`, calculé une fois : base du confinement symlink-safe de `inRepo`. */
  realRoot: string
  name: string
  gitDir: string
  /** cache de la chaîne first-parent du tronc (cf. git/queries.ts refs), invalidé si son tip bouge */
  trunk: { key: string; set: Set<string> } | null
  /** enfants git en vol pour ce dépôt ; killAll() les termine tous (closeRepo, fermeture d'app) */
  children: Set<ChildProcess>
  /** requêtes annulables en vol, par id fourni par le renderer (cf. `repo:cancel`) */
  requests: Map<string, AbortController>
  events: RepoHooks
  git: GitRunner["git"]
  diffNoIndex: GitRunner["diffNoIndex"]
}

const repos = new Map<number, RepoHandle>()
let nextId = 1

export const pub = (r: RepoHandle): Repo => ({ id: r.id, path: r.path, name: r.name })

export function use(id: number): RepoHandle {
  const r = repos.get(id)
  if (!r) throw new AppError("NO_REPO")
  return r
}

export function all(): RepoHandle[] {
  return [...repos.values()]
}

/* --- Mutex de mutation par dépôt ---
   La danse stash→checkout→pop, le commit, les actions de branche et les opérations réseau
   partagent le même verrou : deux mutations concurrentes sur le même dépôt risquent sinon des
   `.git/index.lock` qui se marchent dessus. Les lectures (log, status, refs, diff…) restent
   hors mutex, comme avant ce refactor — seule la propriété du dépôt entre en jeu ici. */
export function acquire(r: RepoHandle, label: string): void {
  if (r.running) throw new AppError("BUSY", r.running)
  r.running = label
}

export function release(r: RepoHandle): void {
  r.running = null
}

export async function withLock<T>(r: RepoHandle, label: string, fn: () => Promise<T>): Promise<T> {
  acquire(r, label)
  try {
    return await fn()
  } finally {
    release(r)
  }
}

/* --- Autofetch ---
   Injecté plutôt qu'importé directement depuis git/ops.ts : ops.ts dépend déjà de repos.ts
   (use, mutex) pour ses propres handlers, un import direct dans l'autre sens bouclerait.
   Posé une fois par ipc.ts au démarrage. */
type AutofetchFn = (r: RepoHandle) => void
let autofetch: AutofetchFn | null = null
export function setAutofetch(fn: AutofetchFn): void {
  autofetch = fn
}

const AUTOFETCH_MS = 5 * 60_000

/* --- Cycle de vie --- */

const pendingOpens = new Map<string, Promise<Repo>>()

/** Ouvre `path`, ou rend le dépôt déjà ouvert (même id). Garde de réentrance : deux appels
    concurrents sur le même chemin encore inconnu du registre partagent la même promesse — sans
    elle, les deux passeraient la vérification « déjà ouvert » avant que l'un ou l'autre n'ait
    fini son `rev-parse`, et deux RepoHandle (deux watchers, deux timers) naîtraient pour un
    seul dépôt. */
export function openRepo(path: string, hooks: (id: number) => RepoHooks): Promise<Repo> {
  const already = all().find((r) => r.path === path)
  if (already) return Promise.resolve(pub(already))

  const pending = pendingOpens.get(path)
  if (pending) return pending

  const p = createRepo(path, hooks).finally(() => pendingOpens.delete(path))
  pendingOpens.set(path, p)
  return p
}

async function createRepo(path: string, hooks: (id: number) => RepoHooks): Promise<Repo> {
  const children = new Set<ChildProcess>()
  const probe = createGitRunner({ path, children })

  let gitDir: string
  try {
    gitDir = (await probe.git(["rev-parse", "--absolute-git-dir"])).trim()
  } catch {
    throw new AppError("NOT_A_REPO")
  }

  const id = nextId++
  const events = hooks(id)
  const runner = createGitRunner({ path, trace: (line) => events.trace(line), children })

  const r: RepoHandle = {
    id, path, name: basename(path), gitDir,
    realRoot: safeRealpath(path),
    running: null, muted: 0, dirty: false, timer: null, watcher: null, watchRetries: 0,
    trunk: null, children, requests: new Map(),
    events, git: runner.git, diffNoIndex: runner.diffNoIndex,
  }
  r.timer = setInterval(() => autofetch?.(r), AUTOFETCH_MS)
  watchGit(r)
  repos.set(r.id, r)
  remember(path)
  return pub(r)
}

function safeRealpath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return path
  }
}

export function closeRepo(id: number): void {
  const r = repos.get(id)
  if (!r) return
  if (r.timer) clearInterval(r.timer)
  r.watcher?.close()
  killAll(r.children)
  for (const controller of r.requests.values()) controller.abort()
  repos.delete(id)
}

/** Ferme tout (fermeture de la fenêtre / de l'app) : mêmes garanties que `closeRepo`, en gros. */
export function closeAll(): void {
  for (const r of repos.values()) {
    if (r.timer) clearInterval(r.timer)
    r.watcher?.close()
    killAll(r.children)
  }
  repos.clear()
}

/* --- Chemins confinés au dépôt --- */

export function assertPaths(paths: string[]): void {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== "string" || !p))
    throw new AppError("BAD_ARG", "paths")
}

/** Chemin absolu confiné au dépôt. Double vérification (fix durcissement) : le test lexical
    d'origine (git nous protège du `--`, pas d'un `../..` passé à shell), puis realpath des
    deux côtés — un symlink interne pointant hors du dépôt contournerait le test lexical seul.
    Un chemin absent du disque (fichier supprimé, vieux commit) n'a rien à symlink-escaper : on
    retombe sur le résultat lexical, comme avant ce durcissement. */
export function inRepo(r: RepoHandle, path: string): string {
  assertPaths([path])
  const full = resolve(r.path, path)
  if (full !== r.path && !full.startsWith(r.path + sep)) throw new AppError("NOT_ALLOWED", path)
  try {
    const real = realpathSync(full)
    if (real !== r.realRoot && !real.startsWith(r.realRoot + sep)) throw new AppError("NOT_ALLOWED", path)
    return real
  } catch {
    return full
  }
}
