/* Watching .git (AUDIT.md §4): git doesn't notify anything, so we watch for changes in the
   only files that change the graph — HEAD (switch), local refs, and `packed-refs` (gc,
   branch deletion). The index belongs to the working tree, `objects/` is just
   noise, and `refs/remotes/` belongs to fetch, which already announces its own result.

   Three narrow watches rather than one recursive watch over the whole gitDir: a gc/repack
   used to flood the main loop with thousands of `objects/` events that were only filtered
   out here in JS. What we subscribe to now is exactly what WATCHED accepts:
   - the gitDir root, non-recursive — HEAD and packed-refs live there;
   - `refs/`, recursive — heads, tags, and `refs/stash` itself;
   - `logs/refs`, non-recursive — dropping an old stash entry only rewrites the stash reflog
     (`logs/refs/stash`), never `refs/stash`. Best-effort: a repo without reflogs lacks the
     directory, and one created later isn't picked up until the watcher restarts — the stash
     ref still covers push/pop/clear, only drop-of-an-old-entry is missed there.
   Each watcher prefixes the names it reports with its subdirectory, so the WATCHED filter
   keeps seeing gitDir-relative paths.

   When not in the foreground we hold the event instead of emitting it: rereading a repo
   nobody is watching serves no purpose, and Windows doesn't suspend anything on its own.
   The held `dirty` flag is flushed by the window's focus handler (cf. window.ts).

   Error recovery (hygiene fix): a `watch` that fails (unmounted volume, exhausted
   resources) used to close the watcher for good — the repo stayed silent until the tab was
   closed. We now retry with backoff, up to a cap on attempts. One failing watcher tears down
   the whole set: a partial trio would silently miss refs or HEAD.

   Known limitation: in a linked worktree, `--absolute-git-dir` points at `.git/worktrees/<name>` —
   HEAD lives there, but refs don't. Watching `--git-common-dir` too would fix that; deferred until
   linked-worktree support is actually on the table, since it needs the common dir plumbed through
   RepoHandle first. */

import { watch, type FSWatcher } from "node:fs"
import { join } from "node:path"

const WATCH_DEBOUNCE = 300
const MUTE_MS = 1500
/* `refs/stash` and its reflog: a `git stash` run from a terminal changes the graph. Dropping
   an old entry only touches `logs/refs/stash`, hence watching both. */
const WATCHED = /^(?:HEAD|packed-refs)$|^refs[\\/](?:heads|tags)[\\/]|^(?:logs[\\/])?refs[\\/]stash$/

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000
const RETRY_CAP = 6 // beyond that, the repo stays without a watcher — the renderer keeps manual refresh

export interface Watchable {
  gitDir: string
  running: string | null
  muted: number
  dirty: boolean
  /** change generation: bumped on every observed .git change (even one held as `dirty`) and
      by `mute()` after our own mutations — the read-path caches (stash list, ordered hash
      list, cf. repos.ts / git/queries.ts) hang off it rather than re-probing git each call. */
  gen: number
  /** last graph fingerprint the renderer has seen — written by the graph's read path
      (git/queries.ts orderedHashes) and by `emitChanged` when it notifies. The gate compares
      against it, so a .git write that moves nothing the UI shows (gc rewriting packed-refs,
      a reflog touch) never reaches the renderer */
  lastGraphKey: string | null
  watchers: FSWatcher[]
  watchRetries: number
  /** pending backoff retry, so closeRepo can cancel it — otherwise a retry scheduled after a
      watch error fires post-close and leaves an orphaned watcher nobody will ever close */
  retryTimer: NodeJS.Timeout | null
  events: {
    changed(): void
    isFocused(): boolean
    /** graph fingerprint provider (cf. git/queries.ts `graphSnapshotKey`, supplied by the
        ipc.ts hooks): optional so the trio watcher/window/tests never hard-depends on git */
    graphKey?(): Promise<string>
  }
}

/* Our own commands wake up the watcher, even though the renderer has already reloaded behind
   them. We can't tell these events apart from the others: we go quiet for a moment. The
   command did change the repo, though — whatever the read caches held is stale now.
   Deliberately NO eager baseline read here: `lastGraphKey` is seeded by the graph's own
   read path (git/queries.ts orderedHashes), so the baseline is always "what the renderer
   has actually seen" — an eager post-op read could absorb an external change the renderer
   was never told about (held `dirty`, mute-window race) and silence its recovery. */
export const mute = (r: Watchable): void => {
  r.gen++
  r.muted = Date.now() + MUTE_MS
}

/** Emits `changed` only if the graph fingerprint actually moved (refresh audit, §2): the
    single funnel for watcher events (below) and the focus flush (window.ts). Without a
    provider — or when it fails — the gate fails open and emits: staying silent on a real
    change is the one unacceptable outcome. */
export async function emitChanged(r: Watchable): Promise<void> {
  const key = await (r.events.graphKey?.() ?? Promise.resolve(null)).catch(() => null)
  /* a command started (or the mute window reopened) while we were reading: emitting now
     would race a half-applied repo, and the key just read is unreliable as a baseline —
     the command's own completion path reloads the renderer and reseeds the baseline */
  if (r.running || Date.now() < r.muted) return
  if (key !== null) {
    if (key === r.lastGraphKey) return
    r.lastGraphKey = key
  }
  r.events.changed()
}

export function watchGit(r: Watchable): void {
  let timer: NodeJS.Timeout | undefined
  const fire = () => {
    /* even a suppressed event invalidates the read caches: an external change racing our
       own echoes inside the mute window is indistinguishable from them, so gen is bumped
       unconditionally — only the renderer notification is muted or held */
    r.gen++
    if (r.running || Date.now() < r.muted) return
    if (r.events.isFocused()) void emitChanged(r)
    else r.dirty = true
  }
  const onError = () => {
    if (!r.watchers.length) return // a second watcher of the same set erroring: already torn down
    for (const w of r.watchers) w.close()
    r.watchers = []
    if (r.watchRetries >= RETRY_CAP) return // beyond that: permanent silence, no noise
    const delay = Math.min(RETRY_BASE_MS * 2 ** r.watchRetries, RETRY_MAX_MS)
    r.watchRetries++
    r.retryTimer = setTimeout(() => {
      r.retryTimer = null
      watchGit(r)
    }, delay)
  }
  /* the debounce timer is shared: HEAD + a ref moving in the same checkout must still
     collapse into a single `changed` */
  const add = (dir: string, recursive: boolean, prefix: string): FSWatcher | null => {
    try {
      const w = watch(dir, { recursive }, (_type, file) => {
        if (!file) return
        const rel = prefix + file // back to a gitDir-relative path, as WATCHED expects
        if (rel.endsWith(".lock") || !WATCHED.test(rel)) return
        clearTimeout(timer)
        timer = setTimeout(fire, WATCH_DEBOUNCE)
      })
      w.on("error", onError)
      return w
    } catch {
      return null
    }
  }

  const root = add(r.gitDir, false, "")
  if (!root) {
    /* no watcher on the first try (directory already gone): the app stays usable, the
       refresh falls back to manual — no retry here, nothing managed to subscribe */
    return
  }
  const refs = add(join(r.gitDir, "refs"), true, "refs/")
  const stashLog = add(join(r.gitDir, "logs", "refs"), false, "logs/refs/")
  r.watchers = [root, refs, stashLog].filter((w): w is FSWatcher => w !== null)
  r.watchRetries = 0
}
