/* Registry of open repos (AUDIT.md §4): the renderer only designates them by an opaque id,
   never by their path. One tab = one open repo; closing a tab goes through
   `repo:close`.

   Brings together what used to live scattered across the old main/index.js: lifecycle
   (open/close), per-repo mutation mutex (hygiene fix — the stash→checkout→pop dance used to
   run unlocked against autofetch), reentrancy guard on `openRepo` (two concurrent openings of
   the same path must produce only a single RepoHandle, not two duplicated watchers/timers), and
   path confinement (`inRepo`, realpath on both sides — hardening fix, symlinks). */

import { realpathSync } from "node:fs"
import { resolve, sep } from "node:path"
import type { ChildProcess } from "node:child_process"

import { AppError } from "../shared/errors.ts"
import { autoFetchIntervalMs } from "../shared/settings.ts"
import type { DistributiveOmit, OpEvent, ProgressEvent, QueueEvent, Repo, Stash, TraceLine } from "../shared/types.ts"
import { createGitRunner, killAll, type GitRunner } from "./git/exec.ts"
import { basename } from "./util.ts"
import { getSettings } from "./settings.ts"
import { remember } from "./state.ts"
import { watchGit, type Watchable } from "./watcher.ts"

/** Hooks provided by the window layer (window.ts), injected at opening rather than read from
    a global `mainWindow` — exec.ts and this module only import `electron` for its types. */
export interface RepoHooks {
  trace(line: DistributiveOmit<TraceLine, "id">): void
  op(payload: DistributiveOmit<OpEvent, "id">): void
  /** live maintenance progress (fsck/gc), streamed to the renderer footer */
  progress(payload: Omit<ProgressEvent, "id">): void
  /** mutation-queue transitions (enqueue/start/settle) — the footer's "N queued" indicator */
  queue(payload: Omit<QueueEvent, "id">): void
  changed(): void
  isFocused(): boolean
  /** graph fingerprint for the `emitChanged` gate (cf. watcher.ts) — ipc.ts supplies it in
      `makeHooks` like every other hook, resolving the handle by id at call time */
  graphKey?(): Promise<string>
}

/* Open repos, main side only. */
export interface RepoHandle extends Watchable {
  /** autofetch timer; `null` when auto-fetch is off or its interval isn't armed (cf. scheduleAutofetch) */
  timer: NodeJS.Timeout | null
  id: number
  path: string
  /** realpath of `path`, computed once: the basis for `inRepo`'s symlink-safe confinement. */
  realRoot: string
  name: string
  gitDir: string
  /** cache of the trunk's first-parent chain (cf. git/queries.ts refs), invalidated if its tip moves */
  trunk: { key: string; set: Set<string> } | null
  /** cached `git stash list`, valid for one change-generation (cf. watcher.ts `gen`): the log
      read path (git/queries.ts logPage/total) used to re-spawn `stash list` on every page */
  stashCache: { gen: number; list: Promise<Stash[]> } | null
  /** cached graph fingerprint + stashes for one change-generation (cf. git/queries.ts
      `graphSnapshot`): the `emitChanged` gate reads it when an event fires and the reload
      that follows re-reads it per page — same gen, one set of spawns for all of them */
  snapshotCache: { gen: number; snap: Promise<{ key: string; stashes: Stash[] }> } | null
  /** the graph's ordered hash list (cf. git/queries.ts logPage/total), keyed by the refs+stash
      tips snapshot — same idea as `trunk`. One string of fixed-width `\n`-terminated lines
      (~41 B/commit for sha1), deliberately never split into a per-commit array: a 1M-commit
      repo costs one ~41 MB string, not a million small ones plus array overhead. */
  logIndex: { key: string; hashes: Promise<string> } | null
  /** reflog "gone" verdicts per local branch (cf. git/queries.ts listRefs), valid while the
      branch's tip and the remote set are unchanged — one `git reflog show` per stale branch
      per refresh otherwise */
  goneCache: { remotes: string; verdicts: Map<string, { tip: string; gone: boolean }> } | null
  /** labels of the mutations waiting behind `running`, in run order (cf. withLock) */
  pending: string[]
  /** running + waiting mutations, tracked synchronously — `withLock`'s enqueue test and
      auto-fetch's back-off read it before any await */
  lockCount: number
  /** tail of the mutation queue: each `withLock` chains behind the previous one's settlement */
  lockTail: Promise<void>
  /** set by closeRepo/closeAll: an operation still waiting in the queue when the tab closes
      must not run against a closed repo — its turn resolves to NO_REPO instead */
  closed: boolean
  /** in-flight git children for this repo; killAll() terminates them all (closeRepo, app close) */
  children: Set<ChildProcess>
  /** cancellable in-flight requests, keyed by id supplied by the renderer (cf. `repo:cancel`) */
  requests: Map<string, AbortController>
  events: RepoHooks
  git: GitRunner["git"]
  diffNoIndex: GitRunner["diffNoIndex"]
  gitBuffer: GitRunner["gitBuffer"]
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

/* --- Per-repo mutation queue ---
   The stash→checkout→pop dance, commit, branch actions, and network operations
   share the same lock: two concurrent mutations on the same repo would otherwise risk
   `.git/index.lock` files stepping on each other. Reads (log, status, refs, diff…) stay
   outside the queue, as before — only repo ownership comes into play here.

   A busy repo used to throw BUSY at the second caller; chaining operations (fetch, then a
   checkout, then a push) meant waiting for each one by hand. Mutations now queue FIFO: each
   `withLock` chains behind the previous one's settlement and the caller's promise resolves
   with its own operation, so the renderer's usual "await → invalidate → reload" flow holds
   for queued calls too. Every transition goes out as a `git:queue` event — the footer shows
   how many operations wait, the toolbar greys a network op already running or queued.

   Still no nesting: a `withLock` inside a `withLock` no longer throws BUSY — it would wait
   behind itself forever. Shared bodies (cf. git/ops.ts `checkoutWithStash`) must keep running
   under their caller's lock. BUSY remains only as the overflow guard below. */
const QUEUE_MAX = 20

const emitQueue = (r: RepoHandle): void => r.events.queue({ running: r.running, pending: [...r.pending] })

export function withLock<T>(r: RepoHandle, label: string, fn: () => Promise<T>): Promise<T> {
  /* runaway guard: a queue this deep means something is stuck (a hung remote holds the lock
     while clicks pile up) — refuse rather than hoard work the user forgot about */
  if (r.lockCount > QUEUE_MAX) throw new AppError("BUSY", r.running ?? label)
  const queued = r.lockCount > 0
  r.lockCount++
  if (queued) {
    r.pending.push(label)
    emitQueue(r)
  }
  const prev = r.lockTail
  let settled!: () => void
  /* the tail resolves in `finally` below, never rejects: a failed operation must not poison
     the ones queued behind it — their own promises still surface their own errors */
  r.lockTail = new Promise((res) => (settled = res))
  const run = async (): Promise<T> => {
    if (queued) r.pending.splice(r.pending.indexOf(label), 1)
    /* the tab closed while this one waited: nothing to mutate anymore, and spawning git on a
       closed repo would leak children past killAll — still hand the turn over, the waiters
       behind must settle (to this same verdict) rather than hang */
    if (r.closed) {
      r.lockCount--
      settled()
      throw new AppError("NO_REPO")
    }
    r.running = label
    emitQueue(r)
    try {
      return await fn()
    } finally {
      r.running = null
      r.lockCount--
      settled()
      /* with waiters left, the successor's own "start" emission follows in a microtask —
         skipping the intermediate `running: null` frame saves the footer a flicker */
      if (r.lockCount === 0) emitQueue(r)
    }
  }
  return prev.then(run)
}

/* --- Autofetch ---
   Injected rather than imported directly from git/ops.ts: ops.ts already depends on repos.ts
   (use, mutex) for its own handlers, a direct import the other way would cycle.
   Set once by ipc.ts at startup. */
type AutofetchFn = (r: RepoHandle) => void
let autofetch: AutofetchFn | null = null
export function setAutofetch(fn: AutofetchFn): void {
  autofetch = fn
}

/** (Re)arm a repo's autofetch timer from the current settings (settings.ts): off clears it,
    on (re)starts it at the configured interval. Idempotent — always clears the old timer first. */
function scheduleAutofetch(r: RepoHandle): void {
  if (r.timer) clearInterval(r.timer)
  r.timer = null
  const settings = getSettings()
  if (settings.autoFetch) r.timer = setInterval(() => autofetch?.(r), autoFetchIntervalMs(settings))
}

/** Re-arm every open repo after an autofetch setting changed (on/off or interval). Called by
    ipc.ts through onSettingsChange — a live change takes effect without reopening a tab. */
export function rescheduleAutofetch(): void {
  for (const r of repos.values()) scheduleAutofetch(r)
}

/* --- Lifecycle --- */

const pendingOpens = new Map<string, Promise<Repo>>()

/** Opens `path`, or returns the already-open repo (same id). Reentrancy guard: two
    concurrent calls on the same path, still unknown to the registry, share the same promise —
    without it, both would pass the "already open" check before either finished its
    `rev-parse`, and two RepoHandles (two watchers, two timers) would be born for a
    single repo. */
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
    id,
    path,
    name: basename(path),
    gitDir,
    realRoot: safeRealpath(path),
    running: null,
    muted: 0,
    dirty: false,
    gen: 0,
    lastGraphKey: null,
    timer: null,
    watchers: [],
    watchRetries: 0,
    retryTimer: null,
    trunk: null,
    stashCache: null,
    snapshotCache: null,
    logIndex: null,
    goneCache: null,
    pending: [],
    lockCount: 0,
    lockTail: Promise.resolve(),
    closed: false,
    children,
    requests: new Map(),
    events,
    git: runner.git,
    diffNoIndex: runner.diffNoIndex,
    gitBuffer: runner.gitBuffer,
  }
  scheduleAutofetch(r)
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
  r.closed = true // operations still waiting in the queue resolve to NO_REPO instead of running
  if (r.timer) clearInterval(r.timer)
  if (r.retryTimer) clearTimeout(r.retryTimer)
  for (const w of r.watchers) w.close()
  killAll(r.children)
  for (const controller of r.requests.values()) controller.abort()
  repos.delete(id)
}

/** Closes everything (window / app close): roughly the same guarantees as `closeRepo`. */
export function closeAll(): void {
  for (const r of repos.values()) {
    r.closed = true
    if (r.timer) clearInterval(r.timer)
    if (r.retryTimer) clearTimeout(r.retryTimer)
    for (const w of r.watchers) w.close()
    killAll(r.children)
  }
  repos.clear()
}

/* --- Paths confined to the repo --- */

export function assertPaths(paths: string[]): void {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== "string" || !p))
    throw new AppError("BAD_ARG", "paths")
}

/** Absolute path confined to the repo. Double check (hardening fix): the original lexical
    test (git protects us from `--`, not from a `../..` passed to a shell), then realpath on
    both sides — an internal symlink pointing outside the repo would bypass the lexical test
    alone. A path absent from disk (deleted file, old commit) has nothing to symlink-escape:
    we fall back to the lexical result, as before this hardening. */
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
