# Performance audit — v0.18.0

Deep audit of the five performance-critical areas: main-process git/IPC layer, graph
engine, React state & re-renders, diff/highlight pipeline, and startup/bundle. Findings
are ranked by expected impact on the reported "slow & clanky" feel; every item was
verified against the code at the referenced lines.

## P0 — the big four

### 1. Graph: `refresh()` is never called when pages stream in (regression)

`controller.ts:94-98` — `onPageLoaded` only runs `measurer.scanPage` + `evictNow`; the
scroll-driven fetch chain in `sync()` (`controller.ts:229-234`) never refreshes either.
`refresh()` (`controller.ts:205-218`) is the only place that sizes `inner.style.height`,
the SVG `width/height/viewBox`, drains `measureCols()`, and emits stats — and it only
runs from `reset()`, `reveal()` and the one-time `fonts.ready` hook.

The pre-refactor monolith (`graph-canvas.ts` before `62b726a`) called `refresh()` on
every ingested page. Consequences past the first page (1 000 commits):

- SVG keeps its page-1 height; default `overflow: hidden` clips every node/edge below
  row ~1000 until something else triggers a refresh.
- `inner` keeps its page-1 height, so the scrollbar thumb recalibrates one viewport at a
  time — you can never drag toward the bottom of a large repo. Classic broken-
  virtualization scroll feel.
- The loaded/total stats counter freezes after page 1.
- Column widths queued by `scanPage` for pages 2+ are never applied (type/branch columns
  and new lanes render clipped).

**Fix:** call `refresh()` from `onPageLoaded` (or in the `sync()` fetch-chain
continuation when `loader.state.next` advanced). Cheap: `measureCols` no-ops on empty
queues, `emitStats` is rAF-coalesced. Essentially a one-line restore.

### 2. Main process: log pagination is O(history) per page, with serial spawns on top

- `queries.ts:156-174` — every page runs `git log --date-order --skip=N -n1000` over
  `--all`. `--skip` re-walks (and `--date-order` re-sorts) from the tips every time:
  page 40 of a 50k repo walks ~40k commits before emitting; a jump-to-bottom
  (`growUntil`, 4 concurrent pages) sums to ~1.25M commit visits; evicted pages
  (`RESIDENT = 12`) re-pay the full skip when scrolled back. The comment at
  `queries.ts:154` already predicts this bottleneck.
- `queries.ts:163` — each page also awaits a fresh `git stash list` spawn *before* the
  log starts: a serial ~10-40 ms fork/exec tax on the hottest read path.
- `queries.ts:206-211` — `total()` runs `git rev-list --count --all` (full-history walk)
  on **every** `git:changed` event and every loader reset, with no cache.

**Fix:** one long-lived streaming `git log` child per repo generation (pause/resume
stdout between page requests, invalidate on `git:changed`), or materialize the ordered
hash list once via `rev-list` and serve pages with `git log --no-walk=unsorted --stdin`.
Cache stash tips and the total count on `RepoHandle`, keyed by the ref-tips snapshot
(`refTips()` in `ops.ts:39-43` already exists for exactly this), invalidated via the
existing `mute()`/watcher paths — the same pattern `trunk` already uses.

### 3. Diff/conflict: whole-document shiki tokenization runs synchronously on the renderer thread

- `diff-view.tsx:74-80` (`shikiPass`) and `shiki-tokens.tsx:43` (`useShikiTokens`) feed
  up to `MAX_LINES = 3000` lines to `codeToTokens` — a synchronous call on the JS regex
  engine. A 3k-line TSX diff freezes the renderer for hundreds of ms to seconds; side-
  by-side doubles it. `paintLine` then does ~25k `createElement` calls in the same task.
- `conflict-view.tsx:101` — the output editor re-runs that full tokenize **on every
  keystroke** (`value` changes on each `onChange`), plus a full re-render of the
  mirrored `<pre>` (`value.split("\n")` + per-line map at `:102,121-131`). Typing in a
  large conflicted file is visibly laggy.
- No token cache keyed on `(text, lang, theme)`: unified↔side-by-side and light↔dark
  toggles re-tokenize everything (`diff-view.tsx:231-253` also re-parses diff2html and
  re-assigns the full `innerHTML` on those toggles).

**Fix:** move tokenization to a Web Worker (shiki/core is worker-safe), or chunk per
~200 lines with `scheduler.yield()` carrying `grammarState`; add a small LRU keyed on
`(hash(code), lang, theme)`; use shiki dual-theme tokens so theme flips never
re-tokenize; debounce/`useDeferredValue` the conflict editor's tokenize input (stale
tokens already display fine — the hook never clears).

### 4. React: hot interactions re-render whole trees — no `React.memo` anywhere

Zero `React.memo` and zero `React.lazy` in the renderer (verified by grep); `useMemo`
exists but not at the hot list/tree-building sites.

- **Per keystroke** (commit message): `WorktreePanel` subscribes to
  `commitDraft.subject/description` (`worktree-panel.tsx:140-141`) and also renders the
  three file blocks. Each keypress rebuilds the `conflicts`/`unindexed`/`indexed` arrays
  (`:179-187`) and `FileEntries` re-runs `compactPathTree(buildPathTree(files))` plus
  per-level `localeCompare` sorts (`file-list.tsx:349-358, 266-268, 304-305`) with no
  memoization. With a few hundred dirty files, typing janks.
- **Per commit click**: `RepoViewContent` subscribes to `s.selection.rows` — a new array
  every click (`repo-view.tsx:114`) — so Toolbar, CommitSearch, RefsSidebar,
  GraphColumn and StatusBar all re-render. `RefsSidebar` also subscribes to
  `focusedKeys` (new `Set` per click, `repo-store.tsx:197,208`) and rebuilds+re-sorts
  the full refs tree per group (`refs-sidebar.tsx:111-137`, `refs-tree.tsx:222-228`).
  `DetailPanel` is remounted (not updated) on every selection change via
  `ErrorBoundary key={selection.join(",")+nonce}` (`repo-view.tsx:235`).
- **Per stage/discard click**: `WtDiffBody` renders every hunk line eagerly with 1-2
  `IconButton`s each (`wt-diff-body.tsx:245-254,116-137`) and nothing below the top is
  memoized, so each `setBusy(true/false)` pair reconciles the full 15-20k-element tree
  twice, plus a third time on refetch. `splitHunk` recomputes `sideBySideRows(h)` every
  render (`:224`).
- **Per app-level change**: mounted background tabs all re-render on any menu action,
  theme change, or `useMenuRepo` query update, because `RepoView` isn't memoized and
  receives the broadcast `command` prop (`App.tsx:151-157,214-236`).

**Fix:** extract the commit form into a child that alone subscribes to `commitDraft`;
`useMemo` the file arrays + built trees on `[files, view]`; memoize the refs-sidebar
tree on `[data, q]` (it doesn't depend on selection); `React.memo` the tab's top-level
children and `RepoView` (route menu commands via the store instead of a prop); key the
`ErrorBoundary` on the nonce only; memoize/extract `WtDiffBody` hunk rows.

## P1 — significant

5. **`staleTime: 0` on immutable-by-hash queries** — `files(hash)`, `body(hash)`,
   `diff(hash,…)`, `search(term)` are content-addressed but refetch (spawning git) on
   every remount — which finding 4's DetailPanel remount guarantees per click
   (`detail-panel.tsx:147`, `repo-queries.ts`, `diff-queries.ts:23-27`). Set
   `staleTime: Infinity` for immutable keys; keep explicit invalidation for mutable
   ones (already correct).
6. **No code splitting at all** — the entire renderer is one entry chunk: diff2html
   JS+CSS statically imported by `diff-view.tsx:2-4`, `ConflictView`/`DiffView` static
   in `graph-column.tsx:9-10`, dialogs and maintenance UI static in
   `App.tsx`/`repo-view.tsx`. `React.lazy` the natural seams (DiffView, ConflictView,
   CreateDialog, flow/maintenance dialogs) or at minimum dynamic-import diff2html the
   way shiki already is.
7. **`branchSegment` quadratic + sequential `pin()`** — `chains.ts:43-65` does
   `rows.unshift(r)` per climb step (O(k²): selecting a 10k-commit branch ≈ 5×10⁷
   element moves), then `ensureRows` refetches evicted pages strictly one at a time
   (`loader.ts:130-156`) — a 15-page span = 15 chained IPC round-trips. Use
   `push`+`reverse`; batch refetches 4-wide like `growRound` (`loader.ts:161-184`).
8. **Hover climbs unbounded chains** — `chainTip` (`chains.ts:23-39`) walks first-parent
   until a *branch* ref; tags don't stop it, so hovering row 15 000 walks ~15k steps,
   allocating via `parseRefs("")` at each undecorated step, per row the cursor crosses
   (`hover.ts:46-58`). Skip parse when `!S.refsOf.has(r)`; memoize per row (layout is
   append-only).
9. **Blob IPC: 25 MB base64 on the main thread** — `queries.ts:343-382` encodes blobs
   to base64 (33 MB string) and structured-clones it; the encode+serialize blocks every
   other IPC handler (`repo:diff` can ship up to the 64 MB cap too). Return binary
   (`Uint8Array` transfers efficiently); truncate diffs main-side at
   `MAX_LINES + slack` with a `{text, totalLines}` shape — the renderer already has the
   truncation UI (`diff-view.tsx:133-159`).
10. **Dangling-edge overlay rebuilt per scroll tick** — `overlay.ts:81-87` reassigns
    `dangling.innerHTML` on every `sync()` (i.e. every scroll event and RO tick,
    `controller.ts:299,373-378,491`) even when nothing changed. Gate on a generation
    counter bumped in `layoutChunk`.
11. **`listRefs` re-probes gone-branches with per-branch `git reflog show` spawns on
    every refresh** (`queries.ts:275-289`) — 150 stale branches ≈ 150 spawns per
    `git:changed`. Cache verdicts per `(branch, tip)` like `trunk` does.
12. **`repoStatus` chains 3 serial spawns** (`queries.ts:45-61`) — replace with one
    `git status --porcelain=v2 --branch -z` or `Promise.all`.

## P2 — worthwhile

13. **No virtualization for file lists / refs tree** — a 3-10k-file commit renders every
    row (each with `FileIcon` state+effect and a ContextMenu wrapper) in a 320-px panel
    (`file-list.tsx:360-376`). Window with `@tanstack/react-virtual`, or cap with a
    "show all N" escape hatch; `content-visibility: auto` on diff line rows is the
    cheap 80% for `WtDiffBody`.
14. **Sidebar filter undeferred** — each keystroke re-filters and force-expands every
    matching folder (`refs-sidebar.tsx:85-90,122-135`); `useDeferredValue` +
    memoization (finding 4). Commit search is already debounced correctly.
15. **All 41 shiki grammars loaded on first highlight** (`shiki-highlighter.ts:26-77`)
    — first diff pays ~41 chunk fetches + grammar parses. Load per-lang on demand via
    `loadLanguage`. Also: a once-rejected `highlighterPromise` is cached forever
    (`:69-79`) — reset on failure.
16. **Watcher watches all of `.git` recursively** (`watcher.ts:57`) including
    `objects/`; a gc/repack floods the main loop with thousands of filtered-in-JS
    events. Watch `HEAD`/`packed-refs`/`refs/`/`logs/refs/stash` narrowly.
17. **`dirty` flag never flushed** — `watcher.ts:52-55` holds changes while unfocused,
    but nothing re-emits on focus, so external commits made while unfocused are dropped
    until a manual action; reads as "slow to pick things up". Flush on
    `browser-window-focus`.
18. **Boot opens persisted tabs serially** (`ipc.ts:90-97`) — 8 tabs ≈ 8 serial spawns
    before first useful paint; `Promise.allSettled` preserving order. Also
    `state.ts:47,53`: sync `existsSync` per recent path (network mounts can block
    window creation) — validate async after window-up.
19. **Sentry statically imported + initialized before first render** in both processes,
    even DSN-less contributor builds (`lib/telemetry.ts:6,12-15`, `main/telemetry.ts:18`)
    — either accept as the price of early crash capture, or buffer
    `onerror`/`unhandledrejection` and dynamic-import after first paint.
20. **hugeicons barrel imports (~45 files)** — pure-const exports should tree-shake in
    prod (verify once with a bundle visualizer), but dev pre-bundles the full 4000+
    icon barrel; per-icon deep imports fix dev parse cost.
21. **Mounted SVG chunk never re-rendered when its chunk grows** —
    `controller.ts:242-247` `mountedG` gate means the trailing, partially-filled chunk
    of each page stays incomplete after the next page lands (masked today by finding 1;
    will surface once fixed). Evict the last mounted chunk from `mountedG` when its
    node/edge counts grow.
22. **`conflict()` reads the whole file before the 4 MB cap check**
    (`queries.ts:126-128`) — `stat` first, like `blob()` already does.
23. Minor: `evict()` re-resolves the full selection per eviction
    (`page-cache.ts:83-94`); `shikiPass` lacks cancellation on fast file switching
    (`diff-view.tsx:51-84,251`); `ErrorBoundary` key builds a huge string for big
    selections (`repo-view.tsx:235`); `useShortcut` re-subscribes per render; tab
    switch does `flushSync` inside `startViewTransition` (`App.tsx:24-27`) — measure if
    switches feel hitchy.

## What's already solid (don't churn)

- End-to-end request cancellation (renderer `requestId` → AbortController → SIGTERM/
  SIGKILL), output caps, timeouts, no sync git anywhere.
- Streaming, append-only graph layout with SHA→int interning, LRU page cache with
  pinning, batched no-thrash measurement, passive scroll listeners, imperative canvas
  island with ref-routed callbacks.
- Zustand-per-tab with sliced selectors and stable actions — no context-value bug; push-
  driven query invalidation, no polling, `refetchOnWindowFocus: false`,
  `keepPreviousData`.
- Shiki via `shiki/core` + JS engine, fully dynamic-imported, singleton highlighter,
  3 000-line diff cap with graceful plain fallback.
- `show: false` + `ready-to-show` + theme-matched background + inline splash (no white
  flash); variable fonts; hidden sourcemaps only on official builds; watcher debounce +
  self-mute; commit bodies fetched on demand; file icons cached per extension.

## Suggested order of attack

1. Graph `refresh()` on page ingest (finding 1) — one line, fixes scroll/clipping/stats.
2. Memoization pass (finding 4) + `staleTime` (5) — kills per-keystroke and per-click
   jank app-wide.
3. Shiki off the main thread + token cache + conflict-editor debounce (3).
4. Main-side log streaming / cached total + stash tips (2), then 9/11/12.
5. Code splitting (6) and the P2 list opportunistically.
