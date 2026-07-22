# Architecture audit — v0.36.0: jenga towers & god components

Audit of the codebase against two structural anti-patterns. **Jenga towers**: stacked
abstractions held together by invariants that live far from where they can break — pull
one block (forget one call, one guard, one convention) and something above falls over
silently. **God components / god files**: units that accumulate unrelated
responsibilities until every change routes through them. Every finding below was
verified against the code at the referenced lines; line references describe the
pre-fix code.

> **Fix status** — every finding below is implemented on this branch. §I.1: a
> `mutation()` combinator (repos.ts) owns the `withLock` + `finally mute()` pair; the 22
> hand-repeated sites fold into it, and the sweep surfaced that `flowStart`/`flowPublish`/
> `flowInit` had NO `mute()` at all — the exact predicted bug class, live — now covered
> (`commit`/`reword` also upgrade from success-only to `finally` muting; the index-only ops
> stay on plain `withLock` by design, documented at the combinator). §I.2: both snapshot
> reads live in git/snapshot.ts with the divergence pinned by snapshot.test.ts. §I.3:
> `commitsOf(rows)` (controller.ts) pins and reads in one task; the four `commit(row)!`
> store sites use it, and `commit(row)`'s doc now states the invariant that keeps the
> detail panel's synchronous reads safe (selection pages are eviction-pinned). §I.4: every
> selection write goes through `applySelection` (store/selection.ts), which pairs the state
> update with the canvas push. §I.5: `resetAndLoad({soft?})` is replaced by `reload()`
> (preserving, the default posture) and `hardReload()` (the spelled-out destructive
> variant). §I.6: `RepoApi` and its factory both derive from one runtime method list over
> `Bridge`; the interface's per-method docs moved to the contract. §I.7: a typed
> `sendEvent` (window.ts) covers all seven event sends. §I.8: the `WtAct` closure
> round-trip is a `"stage" | "unstage"` union resolved inside `runWt`. §II.1: the store's
> ~55 actions live in features/repo/store/ (selection, draft, dialogs, ops, reload,
> merge-queue, mutations), composed by `createRepoStore`. §II.2: detail-panel sheds the
> markdown renderer (lib/markdown.tsx), `RewordForm` and `RestoreDialog` (own files).
> §II.3: App.tsx (293→182 lines) delegates to `useTabs`/`useDialogs`/`useRepoCommand`.
> §II.4: git-console delegates to `useTraceBuffer`/`useCommandHistory`. §II.5: the
> imperative diff2html/shiki machinery lives in lib/d2h-render.ts (diff-view 402→226).
> §II.6: the dry-run orchestration is `useMergePreview`. §II.7: both recursive prop drills
> ride a context (refs-tree `Ctx`, file-list's per-list entries context) with re-render
> sets unchanged. Deferred deliberately, all §I.8/II watch items with no concrete break:
> the `resetOwner` guard centralization (worth it only if the controller grows again), the
> one-way stats triplication, and the shared diff-cap spanning three files.

**Overall verdict.** The codebase is _not_ a rotten tower. The process seams are clean
(zero `renderer → main` imports, zero `shared → up` imports), the IPC surface is
type-keyed end to end, the graph feature's module graph is an acyclic DAG with a
DOM-free layout core, and the fixes claimed by `performance-audit.md` and
`refresh-audit.md` are genuinely present in the code. The classic god component this
project once had — `repo-view.tsx`, memorialized in `repo-store.tsx:1-4` as "22
`useState`, 14 `useEffect`, 10 props to RefsSidebar, 14 to WorktreePanel" — was
refactored out by the store rework and is now a 4-`useState` shell; `RefsSidebar` takes
zero props. The residual risk has moved somewhere subtler: **hand-maintained,
discipline-enforced invariants** introduced _by_ those refactors, plus a few files that
quietly re-accumulated concerns. Those are the blocks the next contributor pulls out
without noticing.

## Part I — Jenga towers

Ranked by how silently the tower falls when the block is pulled.

### 1. The `mute()` invariant is duplicated 22× with no structural enforcement

Every in-app mutation must end with `mute(r)` in its `finally`, so the app's own write
doesn't echo back through the file watcher as an "external change" and trigger a
spurious full reload — the exact double-blink symptom `refresh-audit.md` §7 was written
to kill. The call is hand-repeated at **21 sites in `ops.ts`**
(`ops.ts:136,205,218,242,266,296,311,328,345,361,378,398,421,506,517,538,554,573,588,601,633`)
plus `flow.ts:183`. Nothing enforces it: `console.ts:241` deliberately omits it (typed
console commands _should_ flow through the watcher), which proves it's a per-callsite
decision a reviewer must catch. A new mutation that forgets its `finally { mute(r) }`
compiles, passes tests that don't run the watcher, and ships the double-blink back.

**Fix**: a `mutation(r, op, fn)` combinator in `ops.ts` that wraps `withLock` +
`finally mute(r)` once; the 22 sites become declarative and `runConsole` stays outside
it by construction.

### 2. Two snapshot functions that must stay deliberately different

`ops.ts:69-72` warns that its `refTips` dedup "deliberately does NOT" reuse the graph
fingerprint from `queries.ts` (`computeSnapshot` / `graphSnapshotKey`), because the
dedup erases name-only changes the UI must repaint. So the repo has two
nearly-identical "did anything move?" functions whose _difference_ is the load-bearing
part, kept in sync (apart) by one comment. Change the ref-relevance rule in one —
add worktree HEADs, say — and the other silently diverges: either fetches stop
noticing changes or renames stop repainting.

**Fix**: co-locate both in one module with a shared ref-enumeration core and a test
that pins the intended difference (a name-only change must flip the fingerprint but not
`refTips`).

### 3. `pin(rows)` → synchronous `commit(row)!` — an eviction race held off by discipline

`controller.ts:63-66` documents the contract: call `pin(rows)` first, then `commit(row)`
may be read synchronously; `commit` returns `undefined` if the row's cache page was
evicted. Four call sites in the store trust it with a non-null assertion:
`repo-store.tsx:384,414,434,480` (`g.commit(r)!.h`). The invariant is enforced three
call-sites away from where it can break, by a `!`. Any future path that reads `commit`
without pinning — or an eviction-policy change that lets a page slip between `pin` and
the read — throws on `.h` of `undefined` in the middle of a selection gesture.

**Fix**: replace the pin-then-read pairs with one `commitsOf(rows): Promise<Commit[]>`
on the handle that pins and reads atomically; keep `commit(row)` for the
already-resident hot paths and drop the `!`s.

### 4. Every selection mutation must remember to push `g.setSelection(...)`

Selection lives in two places by design: the store owns hashes
(`repo-store.tsx:8-9`), the graph controller owns row highlights
(`controller.ts:93`), and there is deliberately no syncing effect —
`graph-column.tsx:73-78` documents that the store pushes imperatively. That means the
push is a _convention_, copy-pasted at the tail of `selectRow` (`repo-store.tsx:375`),
`selectBranch` (`:394`), `focusRef` (`:424,:440`), `clearFocus` (`:461`),
`reresolveSelection` (`:494`) and `showWorktree` (`:526`). A new selection action that
forgets the tail call leaves the canvas highlighting stale rows with no error anywhere.

**Fix**: route all selection writes through one internal `applySelection(set, g, …)`
helper that updates the slice _and_ pushes to the controller, so the invariant has a
single home.

### 5. `resetAndLoad()`'s destructive behavior is the default; `soft` is opt-in

`repo-store.tsx:755-756`: unless the caller passes `{ soft: true }`, a reload closes
the open diff/conflict/file-history and forces `view: "commits"` — the original
"lose my place" symptom of `refresh-audit.md` §1. Six call sites remember the flag
(`:614,:816,:828,:970,:985` and `useRepoEvents`); any _new_ reload caller that doesn't
re-ships the regression by default. Destructive should be the spelled-out case, not the
fall-through.

**Fix**: invert the API — `reload()` (soft, the common case) and
`resetView()`/`hardReload()` for the few flows that genuinely mean "discard the UI
state". The type system then makes the destructive choice visible at each call site.

### 6. `RepoApi` is a third, hand-typed restatement of the IPC contract

The chain has three statements of the same ~50 operations: `InvokeChannels`
(`ipc-contract.ts:56-227`, canonical), `Bridge` (`ipc-contract.ts:249-336`, _derived_ —
each entry references `InvokeChannels[...]`, so it can't drift), and `RepoApi`
(`git.ts:132-251`), which is **hand-written**: parameters and return types copied by
eye (e.g. `diff(...)` at `git.ts:186` restates `ipc-contract.ts:169-176`). The factory
(`git.ts:253-313`, fifty `(...) => bridge.x(id, ...)` arrows) catches arity drift at
compile time, but a _return-type_ drift in the `RepoApi` interface is caught by
nothing — the renderer can believe a shape the main process stopped sending.

**Fix**: derive it — `type RepoApi = { [K in keyof Bridge]: DropFirst<Bridge[K]> }`
(dropping the leading `id`), and generate the factory generically over `Object.keys`.
That also deletes ~120 lines of mechanical restatement in `git.ts` and shrinks the
add-one-operation touch count (currently **8–10 sites across 6 files**, walked via
`branchDelete`: contract, Bridge, preload, RepoApi, factory, `ipc.ts` handler, `ops.ts`
impl, store action, call site). The compile-time net covers the middle hops; the two
ends that fail silently are the store action and the component wiring.

### 7. Event channels are sent as raw strings

Invoke channels are fully type-keyed (`handle<K>` `ipc.ts:36`, `invoke<K>`
`preload/index.ts:22` — a typo is a compile error). The six _event_ sends in
`makeHooks` (`ipc.ts:59-63`, e.g. `webContents.send("git:trace", …)`) are not checked
against `EventChannels`: a typo there is a silent runtime no-op — the UI simply stops
receiving traces/progress with no error.

**Fix**: a `send<K extends keyof EventChannels>` wrapper mirroring `handle<K>`.

### 8. Watch-list (stacked but currently sound)

- **`reset()` double-buffer guards** — `controller.ts:581-646` freezes DOM writes via
  `resetOwner`, enforced by **8 scattered `if (resetOwner)` early-returns**
  (`controller.ts:105,259,279,375,402,470,498,510`). Correct today; a new DOM-touching
  method that omits the guard corrupts mid-reset state. Worth centralizing behind a
  single dispatch point if the controller grows again.
- **State triplication on the stats path** — `loader.state.next/total` →
  `controller.emitStats` (`controller.ts:247-254`) → `store.graph.stats`
  (`repo-store.tsx:749-751`). One-way, but three owners for one number.
- **`WtAct` round-trip** — `worktree-panel.tsx:47-50` defines actions as closures over
  `RepoApi` (`STAGE = (a, p) => a.stage(p)`), passes them _into_ the store, and
  `runWt` (`repo-store.tsx:918-926`) calls them with the store's own `api`. The store
  imports the type back from the component (`repo-store.tsx:53`). Wrapper-on-wrapper;
  a plain string union or direct store actions would cut the loop.
- **Renderer concerns encoded in main-side contracts** — `repo:wtdiff` truncation is
  shaped by the renderer's render cap (`ipc-contract.ts:97`, `shared/diff.ts`), with
  the truncation UI far away in `diff-view.tsx`. Documented, but the invariant spans
  three files.

## Part II — God components & god files

The component-level sweep (all feature `.tsx` files > 250 lines, hook/prop counts per
top-level component) found **no classic god component left** — repo-scoped state is
centralized in the store, no inline components are recreated per render, and the wide
prop interfaces of the pre-store era are gone. What remains is file-level accumulation
and a few state-dense shells:

### 1. `repo-store.tsx` (1181 lines) — trending god-_store_

The antidote to the old god component is quietly becoming the new hub. Beyond its six
declared slices (`repo-store.tsx:79-139`) it carries **~55 action methods**
(`:141-265`) spanning selection, commit drafts, eleven `ui` sub-dialog flags, the whole
merge-queue state machine, every git-mutation wrapper, and graph reload orchestration.
Slices reach into each other freely — `selectRow` writes `selection` _and_ `ui`
(`:338-371`), `queueMerge` drives four other concerns (`:602-619`), `doCommit` touches
draft + diff + query cache + reload (`:796-817`). It also imports types from four
sibling features (`:50-53` — diff, graph, status-bar, worktree), making it the funnel
every feature couples through. It is cohesive _today_ because one author holds the
conventions (§I.4, §I.5 live here); it is the file to split **before** it hits 2000
lines: keep one store, but move the action groups (selection+graph, git mutations,
merge queue, dialogs) into separate modules composed into `createRepoStore`.

### 2. `detail-panel.tsx` (672 lines) — a god _file_, not a god component

~15 components in one file, none individually oversized, collectively four unrelated
jobs: a mini-markdown renderer (`Inline`/`Markdown`, `:122-164`), an inline reword form
that performs IPC (`RewordForm`, `:279`), a restore-confirm dialog (`:175`), and three
distinct file-loading strategies (`Single`/`Branch`/`Multi`, `:359,:535,:571`). Split:
markdown → `lib/`, reword + restore → own files; the dispatcher and loaders stay.

### 3. `App.tsx` (293 lines) — the densest residual state cluster

**10 `useState`, 11 `useCallback`, 4 `useEffect`** in one component: tab
list/navigation/mount-tracking/persistence, three dialog open-states with lazy
mounting, repo-command nonce dispatch, boot restore, view transitions. All app-global
(correctly _not_ in the per-repo store), but three extractable hooks are sitting in
plain sight: `useTabs` (tabs/active/mounted/persist + open/close/select), `useDialogs`
(the five dialog flags + openers), and the command-dispatch pair.

### 4. `git-console.tsx` (348 lines) — two features sharing one component

A rAF-batched bounded trace buffer (`:64-96`) and a full typed-command REPL with
history recall (`:122-185`) are bundled in one component — the tell is **7 `useRef`s**.
Extract `useTraceBuffer` and `useCommandHistory`; the component becomes the popover
shell it wants to be.

### 5. `diff-view.tsx` (402 lines) — a thin React router on ~180 lines of imperative DOM

The component itself is fine (routes image / interactive / diff2html / raw,
`:389-399`). The bulk — `shikiPass` (`:70`), `paintLine` (`:109`), `renderRaw`
(`:158`), `syncSides` (`:197`) — is framework-free diff2html/shiki DOM machinery living
in a component module. Move it to `lib/d2h-render.ts`; it gains testability, the
component gains legibility.

### 6. `release-create-dialog.tsx` (319 lines) — orchestration worth a hook

8 `useState` + 5 `useEffect`, half of which implement the live merge dry-run
(seq-guarded latest-wins preview + auto-exclusion, `:84-121`). A `useMergePreview`
hook would halve the component and make the concurrency guard reusable.

### 7. Prop-drilling ledger

The wide interfaces that survive are tree-recursion scaffolding, passed untouched
through every level:

| Interface                              | Fields | Drill path                                                                   |
| -------------------------------------- | ------ | ---------------------------------------------------------------------------- |
| `Ctx` (refs-tree.tsx:34-61)            | ~16    | `Tree → RefDir → Tree (recursion) → RefRow` — the comment at `:32` admits it |
| `Tree` props (file-list.tsx:344-373)   | 11     | `Tree → Tree` recursion                                                      |
| `WtBlock` (worktree-panel.tsx:91-114)  | 11     | one level, borderline                                                        |
| `FileRowProps` (file-list.tsx:142-158) | 10     | header/entries → row                                                         |

For the two recursive drills, a per-tree React context (the values are stable per
render pass) removes the threading without perf cost.

### Explicitly cleared

Big-but-cohesive, no action: `messages.tsx` (1387 lines — the deliberate single i18n
catalog, zero logic), `file-list.tsx`, `worktree-panel.tsx`, `conflict-view.tsx`,
`diff-body.tsx` (its ref-not-state busy guard is deliberate), `refs-sidebar.tsx`
(propless — the payoff of the store refactor), `create-dialog.tsx`,
`settings-dialog.tsx`, the graph feature's module graph (33 files, clean DAG,
DOM-free `layout/`), and `exec.ts` as the single spawn choke point.

## Summary ledger

| #    | Finding                                                                | Class       | Severity | Anchor                                                  |
| ---- | ---------------------------------------------------------------------- | ----------- | -------- | ------------------------------------------------------- |
| I.1  | `mute()` finally-invariant ×22, unenforced                             | jenga       | high     | `ops.ts`, `flow.ts:183`                                 |
| I.2  | Deliberately-divergent snapshot pair                                   | jenga       | high     | `ops.ts:69-72` vs `queries.ts`                          |
| I.3  | `pin` → `commit(row)!` eviction race                                   | jenga       | high     | `controller.ts:63-66`; `repo-store.tsx:384,414,434,480` |
| I.4  | `g.setSelection` tail-call convention ×7                               | jenga       | med      | `repo-store.tsx:375-526`; `graph-column.tsx:73-78`      |
| I.5  | Destructive reload is the default (`soft` opt-in)                      | jenga       | med      | `repo-store.tsx:755-756`                                |
| I.6  | Hand-typed `RepoApi` (3rd contract restatement)                        | jenga       | med      | `git.ts:132-251`                                        |
| I.7  | Event `send()` strings unchecked                                       | jenga       | low      | `ipc.ts:59-63`                                          |
| I.8  | resetOwner ×8 / stats ×3 / `WtAct` loop / diff-cap span                | jenga-watch | low      | see §I.8                                                |
| II.1 | `repo-store.tsx` trending god-store (~55 actions, 4-feature type hub)  | god         | med      | `repo-store.tsx:50-53,141-265`                          |
| II.2 | `detail-panel.tsx` god file (markdown + IPC form + dialog + 3 loaders) | god         | med      | `detail-panel.tsx`                                      |
| II.3 | `App.tsx` 10-state shell (tabs + dialogs + dispatch)                   | god         | low      | `App.tsx:56-199`                                        |
| II.4 | `git-console.tsx` buffer + REPL bundle                                 | god         | low      | `git-console.tsx:64-185`                                |
| II.5 | `diff-view.tsx` imperative DOM block in component module               | god         | low      | `diff-view.tsx:70-235`                                  |
| II.6 | `release-create-dialog.tsx` inline dry-run orchestration               | god         | low      | `release-create-dialog.tsx:84-121`                      |
| II.7 | Recursive prop drills (`Ctx` ~16, `Tree` 11)                           | god         | low      | `refs-tree.tsx:34-61`; `file-list.tsx:344-373`          |

The through-line: the store refactor and the two prior audits traded _visible_
structural debt (one giant component, broken refresh paths) for _invisible_ contract
debt — conventions (`mute`, `setSelection`, `soft`, `pin-then-read`) that only exist in
comments and copy-paste. Each Part I fix converts a convention into a construct; that,
more than any file split, is what keeps this from becoming a tower.
