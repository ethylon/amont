# Refresh audit — v0.23.0

Audit of every refresh path, prompted by two reported symptoms: **full-screen blinks**
when the app refreshes, and **losing focus / place in the file tree**. Every finding was
verified against the code at the referenced lines.

> **Fix status** — every finding below is implemented on this branch. §2/§7/§8: a graph
> fingerprint (HEAD + tips + stash, shared with `orderedHashes`' cache key) now gates
> `git:changed` main-side (`emitChanged`, watcher.ts), `mute()` seeds it with the
> post-command state, and background tabs defer their reload until shown. §1/§4: watcher
> events, `doCommit` and `addWorktree` take a `soft` reload that keeps the view, the open
> diff and the scroll; working-tree diffs are invalidated in place instead of being closed.
> §5: `graph.reset()` is double-buffered — the old DOM stays painted until the new state
> (grown back to the previous scroll depth) swaps in a single task, and the viewport
> position survives every reload, hard ones included. §3: tree collapse state is
> controlled and keyed by full path, and stage/unstage restores focus to the row that
> takes the clicked one's place; the window-focus worktree refetch no longer cancels the
> flush's in-flight read. §6: `reresolveSelection` bounds its search near the selection's
> previous rows. §2 (storms): overlapping `resetAndLoad` calls coalesce into one shared
> trailing rerun. One deliberate choice: external changes reload in place (now invisible —
> no flash, no scroll/selection loss) rather than showing the auto-fetch-style badge; the
> badge remains for auto-fetch, whose result is optional. Line references below describe
> the pre-fix code.
>
> **Review round** — an adversarial multi-angle review of the first fix pass surfaced and
> fixed: the fingerprint was name-blind (`refTips` dedups object ids, so `git branch foo`
> on an existing tip, a rename, or a HEAD switch between same-commit branches was silenced
> forever) — the key now carries `refname␀hash` pairs plus HEAD's symbolic name, cached
> per change-generation and shared with `orderedHashes`; the eager post-mutation baseline
> read in `mute()` could absorb an external change held as `dirty` (or landing inside the
> mute window) and permanently suppress its recovery — the baseline is now seeded by the
> graph's own read path, i.e. always "what the renderer actually saw", and `emitChanged`
> re-checks `running`/`muted` after its read; the frozen old graph stayed interactive
> during a reset while clicks resolved row indices against the new half-loaded state —
> interactions now drop mid-reset; the scroll-depth regrowth is capped at the residency
> budget; the reload coalescer was rebuilt as a permanent chain (a settling-run microtask
> window let duplicates slip in) and the graph freeze as an owner token (a superseded
> reset could leave the winner's swap frozen); `Math.max(...rows)` over a branch-sized
> selection would blow the argument limit (now last-element of the sorted array), and a
> partial selection re-resolution no longer erases hashes that may live beyond the search
> bound; the stage/unstage focus restore waits two frames for React's commit and lives in
> file-list.tsx, which owns the `[data-file-row]` convention.

## How a change becomes a repaint (the pipeline)

```
.git change (external)            in-app mutation (commit, checkout, stash…)
        │                                      │
watcher.ts (debounce 300ms,                    │  mute(r) 1.5s quiets the watcher echo
 held while window unfocused)                  │
        │ git:changed                          │
        ▼                                      ▼
repo-store.tsx onChanged ──────────► invalidateRepo() + resetAndLoad()
 (repo-store.tsx:616-624)                      │
                                               ├─ ui: view="commits", diff=null, conflict=null
                                               ├─ graph.reset()  ← full blank remount, scrollTop=0
                                               ├─ reresolveSelection()
                                               └─ invalidate worktree
```

The query layer itself is well-behaved: `keepPreviousData` everywhere,
`refetchOnWindowFocus: false`, content-addressed caches for body/files/diff-of-a-hash.
Sidebar, status bar and detail panel do **not** flash on refetch. All of the violence
is concentrated in `resetAndLoad` and what it drags along.

## P0 — the causes of the reported symptoms

### 1. `resetAndLoad` is the universal hammer

Every trigger — external watcher event, window-refocus flush, commit, checkout, stash,
branch op, worktree op, git-flow, manual pull/push/fetch — funnels into the same
`resetAndLoad()` (`repo-store.tsx:451-456`), which unconditionally:

- **forces `view: "commits"` and closes any open `diff`/`conflict`**
  (`repo-store.tsx:452`) — even when the change is unrelated to what's on screen. If
  you are staging files in the worktree view when a watcher event lands (or after
  `doCommit` with files still dirty), you are yanked back to the commits view: this is
  the single biggest "I lose my place in the file tree" contributor.
- **runs `graph.reset()`** (`controller.ts:534-561`): `loader.reset()` throws away the
  entire layout state and page cache, then `remount()` removes every mounted SVG chunk
  and HTML row **before** page 1 is refetched (`controller.ts:554`), and
  `board.scrollTop = 0` (`controller.ts:555`). The graph is visibly **blank** for the
  duration of the first `git log` page + relayout + remount — that blank frame followed
  by a repaint at the top is exactly the reported "gros clignotement".
- **never restores the viewport**: `reresolveSelection` (`repo-store.tsx:334-349`)
  re-resolves the selected rows, but `setSelection` doesn't scroll (only
  `reveal`/`moveActive` do — `interactions/selection.ts` contains no scroll code). Net:
  scroll-to-top on every refresh, wherever you were.

### 2. `git:changed` is a 1-bit signal — no relevance check before the hammer falls

The watcher (`watcher.ts:39`) fires on HEAD, `refs/heads`, `refs/tags`, `refs/stash`
(+ reflog) and `packed-refs`. Any of those → full pipeline above. Nothing compares the
before/after state, so:

- `git gc` / `git pack-refs` rewriting `packed-refs` with **identical tips** → full
  blank reset for nothing;
- a stash-reflog touch with an unchanged stash list → reset;
- a long external rebase moves refs every few hundred ms → one full reset per 300 ms
  debounce window (`watcher.ts:35`) → the **multi-blink storm** while the rebase runs.
  There is no coalescing "a reset is already in flight, queue one trailing reset".

The codebase already owns both ingredients of the fix: main computes `refTips()`
snapshots around network ops to derive a real `changed` bit (`ops.ts:88-96`), and the
graph's `updateSync()` gates a remount behind a signature compare
(`controller.ts:181-195`). The `git:changed` payload could carry a HEAD+tips
fingerprint and the renderer (or main itself) could skip the reload when it hasn't
moved.

### 3. File tree: focus and collapse state are casualties of every refetch

- **Stage/unstage moves the row to the other block** (unstaged ⇄ staged): the
  `<button>` that had focus unmounts and DOM focus falls back to `<body>`. The
  arrow-key navigation is DOM-based (`file-list.tsx:86-96`), so once focus is on
  `<body>` the keyboard flow is dead until the user clicks again. Nothing restores
  focus to the neighbouring row after the action (the graph already does this right:
  `moveActive` re-focuses the active row after a re-sync, `controller.ts:382`).
- **Collapse state is uncontrolled and keyed by compacted label**
  (`Collapsible key={label} defaultOpen`, `file-list.tsx:290`; compaction at
  `file-list.tsx:353`). `compactPathTree` merges single-child directories, so staging
  the only file of a subfolder changes the compacted labels of what remains → React
  reconciles by a *different* key → whole subtrees remount: chevrons pop back open,
  rows flash, and any focus inside dies. A controlled expanded-set keyed by full path,
  persisted per block, would survive refetches.
- **Window refocus refetches the worktree twice**: `repo-view.tsx:193-198` invalidates
  `worktree` on every window `focus`, and main's dirty-flush (`window.ts:113-119`)
  fires `git:changed` for the same moment → `resetAndLoad` invalidates `worktree`
  again. Harmless visually (`keepPreviousData`) but two `git status`-class reads
  back-to-back, plus the full graph reset of finding 1 if anything was dirty.

## P1 — amplifiers

### 4. Background-initiated reloads ignore the gentle pattern the app already has

The auto-fetch path got this exactly right (`repo-store.tsx:653-664`): background op →
non-intrusive clickable badge ("N new commits · Reload"), with an explicit comment that
a background fetch must never rip scroll or selection away from the user. Watcher
events are equally background-initiated, yet they take the violent path. At minimum,
when the user is "engaged" (scrolled away from top, diff open, worktree view active,
text selected), an external change could surface as the same badge instead of an
immediate reset.

### 5. Graph reset is destructive rather than double-buffered

Even when a reload *is* warranted, DOM is cleared before the new data exists
(`remount()` then `await loader.fetchMore()`, `controller.ts:554-557`). Keeping the old
chunks/rows mounted until the new first page is laid out, then swapping in a single
frame — and restoring the captured `scrollTop` (clamped to the new height) — removes
the blank flash entirely without touching the layout engine. `loader.reset()` already
resolves total/stashes/worktrees *before* the controller blanks anything, so the swap
point is well defined.

### 6. `reresolveSelection` can page in the whole history after an amend

`resetAndLoad` → `reresolveSelection` → `rowsOf(hashes)` →
`growUntil(allKnown)` (`controller.ts:580-590`). A hash that no longer exists (the
selected commit was just amended/rebased — including by our own `doCommit` with amend)
makes `growUntil` fetch page after page **until history is exhausted** before giving
up. On a large repo, one amend of a selected commit triggers a full-history pagination
in the background (visible as the stats counter climbing and sustained git churn).
`rowsOf` needs a bounded probe (e.g. give up after the pages that were resident before
the reset, or check existence via a single `git cat-file --batch-check`-class call)
before committing to an unbounded walk.

## P2 — races and fan-out

### 7. The 1.5 s mute window loses the race on slow filesystems

`mute(r)` quiets the watcher for 1 500 ms after our own commands
(`watcher.ts:65-68`, called from every `finally` in `ops.ts`). Events delayed beyond
that (Windows + antivirus, network drives, a flow-finish writing many refs) escape the
window → a second, redundant `git:changed` reset moments after the renderer already
reloaded itself — the occasional **double-blink** right after an in-app operation. A
tips-fingerprint gate (finding 2) also eliminates this class, since the late echo
carries no new state.

### 8. Focus-flush fans out to every dirty repo at once

`window.ts:113-119` flushes the `dirty` flag of **all** open repos on window focus;
every mounted tab (they all stay mounted) runs its own `invalidateRepo` + full graph
reset simultaneously. Background tabs don't flash, but a multi-tab session pays N ×
(`total` + `stashes` + `worktrees` + page-1 `git log`) on each refocus. Flushing only
the active tab and leaving the others `dirty` until they're shown would keep the same
correctness at a fraction of the cost. Same class: `fire()` checks window focus but
not *tab* visibility (`watcher.ts:78`), so a foreground window keeps live-resetting
tabs the user isn't looking at.

## What's already solid (don't churn)

- The query layer: `keepPreviousData` on every list-shaped query, no polling,
  `refetchOnWindowFocus: false`, content-addressed `staleTime: Infinity` for
  body/files/immutable diffs — refetches repaint in place, no flash.
- `runWt` (stage/unstage) deliberately avoids the graph reset and only invalidates
  `worktree`; the conflict cache is deliberately kept out of `invalidateRepo` to
  protect in-progress edits.
- The watcher itself: three narrow scoped watches, `.lock` filtered, debounced,
  events held while unfocused, self-mute after own commands.
- The auto-fetch badge flow — it is the template findings 2 and 4 should generalize.

## Suggested order of attack

1. **Fingerprint gate on `git:changed`** (finding 2): include a HEAD+tips snapshot in
   the payload (or compare main-side) and skip the reload when nothing graph-relevant
   moved. Kills the gc/reflog no-op resets and the mute-race double-blink (7) in one
   move.
2. **Make background reloads gentle** (findings 1, 4): on watcher-initiated reloads,
   keep the current view (never force `view:"commits"`), keep a still-valid diff open,
   and preserve scroll; optionally badge instead of reload when the user is engaged.
3. **Double-buffer the graph reset + restore scroll** (finding 5): no blank frame, no
   scroll-to-top, for *every* remaining legitimate reload — in-app ops included.
4. **File tree**: controlled collapse state keyed by full path + focus restore to the
   adjacent row after stage/unstage (finding 3); drop one of the two focus-time
   worktree invalidations.
5. **Bound `reresolveSelection`** (finding 6) and coalesce reset storms (one trailing
   reset while one is in flight).
