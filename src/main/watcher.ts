/* Watching .git (AUDIT.md §4): git doesn't notify anything, so we watch for changes in the
   only files that change the graph — HEAD (switch), local refs, and `packed-refs` (gc,
   branch deletion). The index belongs to the working tree, `objects/` is just
   noise, and `refs/remotes/` belongs to fetch, which already announces its own result.

   When not in the foreground we hold the event instead of emitting it: rereading a repo
   nobody is watching serves no purpose, and Windows doesn't suspend anything on its own.

   Error recovery (hygiene fix): a `watch` that fails (unmounted volume, exhausted
   resources) used to close the watcher for good — the repo stayed silent until the tab was
   closed. We now retry with backoff, up to a cap on attempts.

   Known limitation: in a linked worktree, `--absolute-git-dir` points at `.git/worktrees/<name>` —
   HEAD lives there, but refs don't. Watching `--git-common-dir` too would fix that; deferred until
   linked-worktree support is actually on the table, since it needs the common dir plumbed through
   RepoHandle first. */

import { watch, type FSWatcher } from "node:fs"

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
  watcher: FSWatcher | null
  watchRetries: number
  /** pending backoff retry, so closeRepo can cancel it — otherwise a retry scheduled after a
      watch error fires post-close and leaves an orphaned watcher nobody will ever close */
  retryTimer: NodeJS.Timeout | null
  events: { changed(): void; isFocused(): boolean }
}

/* Our own commands wake up the watcher, even though the renderer has already reloaded behind
   them. We can't tell these events apart from the others: we go quiet for a moment. */
export const mute = (r: Watchable): void => {
  r.muted = Date.now() + MUTE_MS
}

export function watchGit(r: Watchable): void {
  let timer: NodeJS.Timeout | undefined
  const fire = () => {
    if (r.running || Date.now() < r.muted) return
    if (r.events.isFocused()) r.events.changed()
    else r.dirty = true
  }
  try {
    r.watcher = watch(r.gitDir, { recursive: true }, (_type, file) => {
      if (!file || file.endsWith(".lock") || !WATCHED.test(file)) return
      clearTimeout(timer)
      timer = setTimeout(fire, WATCH_DEBOUNCE)
    })
    r.watchRetries = 0
    r.watcher.on("error", () => {
      r.watcher = null
      if (r.watchRetries >= RETRY_CAP) return // beyond that: permanent silence, no noise
      const delay = Math.min(RETRY_BASE_MS * 2 ** r.watchRetries, RETRY_MAX_MS)
      r.watchRetries++
      r.retryTimer = setTimeout(() => {
        r.retryTimer = null
        watchGit(r)
      }, delay)
    })
  } catch {
    /* no watcher on the first try (directory already gone): the app stays usable, the
       refresh falls back to manual — no retry here, nothing managed to subscribe */
  }
}
