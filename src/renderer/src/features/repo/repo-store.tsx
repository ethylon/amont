/* Per-repo client store (AUDIT.md §5, "renderer state" workstream): a vanilla zustand store
   per open tab, created inside a `<RepoProvider>` and consumed by selector — the antidote to
   the `repo-view.tsx` god-component (22 `useState`, 14 `useEffect`, 10 props to RefsSidebar, 14
   to WorktreePanel). Four slices:
   - `selection`: keyed by commit HASH (not by row index) — the additive/subtractive
     ctrl-click invariant lives in `toggleAdditive`, a single place for both
     commits (`selectRow`) and refs (`focusRef`). After a graph reset, `resetAndLoad`
     re-resolves rows via `graph.rowsOf(hashes)`: the selection survives pull/checkout/stash
     as long as the commits still exist, rather than being cleared outright.
   - `commitDraft`: subject/description/amend of the commit draft.
   - `ui`: side panel, current view, open diff.
   - `ops`: in-flight network operation, status badge (auto-cleared by a timer).
   `graphRef` lives in the store as a non-reactive ref (same shape as the `RefObject` that
   `CommitGraph` expects): mutating it notifies no subscriber. The selection actions here push
   `selection.rows` to the canvas imperatively (`graphRef.current.setSelection`) — there is no
   mirror effect on the graph component's side.

   The "git op → refresh → resetAndLoad → showOp" quartet, copy-pasted four times in the old
   repo-view.tsx (checkout, stash, branch — the commit has its own shape, a failure doesn't
   reload there), becomes `runGitAction`. */

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createStore, useStore, type StoreApi } from "zustand"

import { describeError, describePayload } from "@/lib/errors"
import {
  onChanged,
  onOp,
  onProgress,
  type BranchAct,
  type FileChange,
  type FlowPrefixes,
  type GitRef,
  type OpName,
  type Repo,
  type RepoApi,
  type Stash,
  type StashAct,
  type WorktreeAct,
  type WorktreeInfo,
} from "@/lib/git"
import type { BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { prefs } from "@/lib/prefs"
import { invalidateRepo, invalidateWtDiffs, queryKeys } from "@/lib/queries"
import { queryClient } from "@/lib/query-client"
import type { DiffCtx, DiffViewMode } from "@/features/diff/diff-view"
import type { GraphHandle, Stats } from "@/features/graph/controller"
import type { OpState } from "@/features/repo/status-bar"
import type { WtAct } from "@/features/worktree/worktree-panel"

export type SelMode = "multi" | "branch"

export interface RepoStoreState {
  readonly repoId: number
  readonly api: RepoApi
  /** non-reactive ref, same shape as a `RefObject<GraphHandle | null>` — filled/cleared from
      the sole `onReady` channel of `<CommitGraph>` (AUDIT.md §7, phase 5, item 6) */
  readonly graphRef: { current: GraphHandle | null }

  selection: {
    hashes: string[]
    /** resolved rows, sorted ascending — what the canvas and DetailPanel consume */
    rows: number[]
    mode: SelMode
    focusedKeys: Set<string>
  }
  commitDraft: {
    subject: string
    description: string
    amend: boolean
  }
  ui: {
    sidebarOpen: boolean
    view: "commits" | "wt"
    diff: { ctx: DiffCtx; file: FileChange } | null
    diffMode: DiffViewMode
    /** conflicted file open in the resolution view — exclusive with `diff`, same overlay slot */
    conflict: FileChange | null
    /** inline `git flow <kind> start` banner open in RepoView — openable from the app menu
        (command channel) and from the sidebar's flow shortcut; `base` pre-selects the start
        point (the promoted moves pass the trunk HEAD sits on) */
    flowStart: { kind: BranchFlow; base?: string } | null
    /** finish confirmation of a feature/bugfix: every finish entry point routes here instead of
        running (the flow banner rolls to its options row — merge/rebase, delete); the kind is
        resolved from the gitflow prefixes at interception. Exclusive with `flowStart`. */
    flowFinish: { branch: string; kind: BranchFlow } | null
  }
  ops: {
    busyOp: OpName | null
    opState: OpState | null
    /** live `NN%` of the running network op (fetch/pull/push), streamed from git's `--progress`;
        `null` between commands or before git emits its first percentage. Footer feed, cf. status-bar. */
    opProgress: { op: OpName; percent: number } | null
    /** a gitflow operation (start/finish/publish/init) is running its git commands — the flow
        banners swap the kind icon for a spinner and roll the traced commands (cf. FlowBanner).
        Scoped to the commands themselves, not the invalidation/reload that follows: the ticker
        must never churn through the reload's read commands. */
    flowBusy: boolean
  }
  graph: {
    stats: Stats | null
  }

  selectRow(row: number, additive: boolean): void
  selectBranch(row: number): Promise<void>
  focusRef(r: GitRef, additive: boolean): Promise<void>
  focusStash(s: Stash): Promise<void>
  focusWorktree(w: WorktreeInfo): Promise<void>
  clearFocus(): void
  /** re-resolves `selection.hashes` into rows after a graph reset (pull/checkout/stash);
      a hash that's become unfindable (amend, rebase) is silently dropped. */
  reresolveSelection(): Promise<void>

  setSubject(v: string): void
  setDescription(v: string): void
  /** checked: borrows subject/body of the last commit, setting the draft aside;
      unchecked: restores the draft that was set aside */
  toggleAmend(on: boolean): Promise<void>

  toggleSidebar(): void
  showWorktree(): void
  showCommits(): void
  openFlowStart(kind: BranchFlow, base?: string): void
  closeFlowStart(): void
  openFlowFinish(branch: string, kind: BranchFlow): void
  closeFlowFinish(): void
  openDiff(ctx: DiffCtx, file: FileChange): void
  closeDiff(): void
  setDiffMode(v: DiffViewMode): void
  openConflict(file: FileChange): void
  closeConflict(): void
  /** writes the merged output, stages the file (main-side `repo:resolve`), closes the view */
  resolveConflict(path: string, content: string): Promise<void>
  abortMerge(): Promise<void>

  setBusyOp(op: OpName | null): void
  /** live footer percentage of a running network op; `null` clears it (op settled or reset) */
  setOpProgress(progress: { op: OpName; percent: number } | null): void
  /** raises/clears `ops.flowBusy` around a gitflow command (cf. runFlow/runBranch/runFlowPublish) */
  setFlowBusy(v: boolean): void
  showOp(text: string, color: OpState["color"], action?: OpState["action"]): void
  clearOp(): void
  setStats(stats: Stats): void

  /** Restarts the graph (scroll-preserving, cf. controller.ts) and re-resolves the selection.
      Default (user-initiated context switch — checkout, pull…): also closes the diff and
      returns to the commits view. `soft` (background-initiated: watcher event, commit from
      the staging panel) leaves the current view and any open diff alone — a change the user
      didn't just ask for must never rip their workspace away (refresh audit, §1/§4).
      Overlapping calls coalesce into one trailing rerun instead of stacking full reloads. */
  resetAndLoad(opts?: { soft?: boolean }): Promise<void>
  /** git op → status invalidation → resetAndLoad → error badge, in a single place */
  runGitAction(action: () => Promise<void>, opts?: { onSuccess?(): void }): Promise<void>
  /** Like `runGitAction`, but returns the error text (or `null`) instead of flashing a badge —
      the git-flow init/start surfaces show it inline and stay open on failure. */
  runFlow(action: () => Promise<void>): Promise<string | null>
  doCommit(): Promise<void>
  runStash(action: StashAct, name?: string): Promise<void>
  runBranch(action: BranchAct, name: string): Promise<void>
  /** `git flow <kind> publish` through `runGitAction`, flagging `ops.flowBusy` like finish/start */
  runFlowPublish(kind: BranchFlow, name: string): Promise<void>
  /** `git branch -D`, plus the remote branch when `deleteRemote` — reloads and badges like the rest */
  deleteBranch(name: string, deleteRemote: boolean): Promise<void>
  checkout(name: string): Promise<void>
  runWt(act: WtAct, paths: string[]): Promise<void>
  /** whole-file discard: tracked paths restored from the index, untracked deleted */
  runDiscard(paths: string[], untracked: string[]): Promise<void>
  /** remove/prune of a linked worktree; the graph reloads (the chip must disappear) */
  runWorktree(action: WorktreeAct, path?: string): Promise<void>
  /** opens a listed worktree as a new tab (via `onOpenRepo`, wired to App's `openTab`) */
  openWorktree(path: string): Promise<void>
  /** destination picker + `git worktree add <dir> <branch>`, then opens the new tab */
  addWorktree(branch: string): Promise<void>
}

/** Ctrl-click: toggles a set of items at once — removes if the first is already in,
    adds otherwise. Same invariant for commit rows (`selectRow`) and branch
    segments (`focusRef`): a single place decides "remove" vs "add". */
function toggleAdditive<T>(set: Set<T>, items: T[]): boolean {
  const removing = items.length > 0 && set.has(items[0])
  for (const it of items) removing ? set.delete(it) : set.add(it)
  return removing
}

const keyOfRow = (g: GraphHandle, row: number): string | null => {
  const b = g.branchesOf(row)[0]
  return b ? `${b.kind}:${b.name}` : null
}

/* Selection updates are the hottest store writes (one per commit click): reuse the previous
   Set/array when the contents haven't actually changed, so selector-based subscribers
   (RefsSidebar on `focusedKeys`, RepoView on `rows`) and downstream memos see a stable
   reference instead of re-rendering on every click of an already-selected commit. */
const sameSet = (prev: Set<string>, next: Set<string>): Set<string> =>
  prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next
const sameArr = <T,>(prev: T[], next: T[]): T[] =>
  prev.length === next.length && next.every((v, i) => prev[i] === v) ? prev : next

export function createRepoStore(
  repoId: number,
  api: RepoApi,
  onOpenRepo: (repo: Repo) => void
): StoreApi<RepoStoreState> {
  let okTimer = 0
  /* message draft set aside while an amend borrows the last commit's */
  let draftBackup: { subject: string; description: string } | null = null
  /* Coalesced graph reload (refresh audit, §2): an external rebase fires one watcher event
     per ref move — at most one rerun queues behind the running reload (it reads the
     then-current repo state, satisfying every caller that landed mid-flight), and further
     callers share that queued rerun's promise. A permanent chain rather than a nullable
     in-flight marker: with a marker, the microtask between "run settled" and "trailing rerun
     starts" let a caller's continuation slip a concurrent duplicate in. */
  let reloadChain: Promise<void> = Promise.resolve()
  let reloadDepth = 0

  return createStore<RepoStoreState>((set, get) => ({
    repoId,
    api,
    graphRef: { current: null },

    selection: { hashes: [], rows: [], mode: "multi", focusedKeys: new Set() },
    commitDraft: { subject: "", description: "", amend: false },
    ui: {
      sidebarOpen: true,
      view: "commits",
      diff: null,
      conflict: null,
      diffMode: prefs.diffView.get() || "unified",
      flowStart: null,
      flowFinish: null,
    },
    ops: { busyOp: null, opState: null, opProgress: null, flowBusy: false },
    graph: { stats: null },

    selectRow(row, additive) {
      const g = get().graphRef.current
      if (!g) return
      const c = g.commit(row)
      if (!c) return
      const key = keyOfRow(g, row)
      set((s) => {
        /* the click clears any open diff/conflict and returns to commits; reuse `ui`
           untouched when it's already there — a new object would wake `s.ui` subscribers */
        const ui =
          s.ui.view === "commits" && !s.ui.diff && !s.ui.conflict
            ? s.ui
            : { ...s.ui, view: "commits" as const, diff: null, conflict: null }
        if (!additive) {
          return {
            selection: {
              hashes: sameArr(s.selection.hashes, [c.h]),
              rows: sameArr(s.selection.rows, [row]),
              mode: "multi",
              focusedKeys: sameSet(s.selection.focusedKeys, new Set(key ? [key] : [])),
            },
            ui,
          }
        }
        const hashes = new Set(s.selection.hashes)
        const rows = new Set(s.selection.rows)
        const removing = toggleAdditive(rows, [row])
        removing ? hashes.delete(c.h) : hashes.add(c.h)
        const focusedKeys = new Set(s.selection.focusedKeys)
        if (key) removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        return {
          selection: {
            hashes: [...hashes],
            rows: [...rows].sort((a, b) => a - b),
            mode: "multi",
            focusedKeys: sameSet(s.selection.focusedKeys, focusedKeys),
          },
          ui,
        }
      })
      /* explicit `active`: `row` is the row that just acted (click, ctrl-click, arrow…) — the
         keyboard cursor (roving tabindex, AUDIT.md §8) follows it, whether or not it ends up
         sorted at the head of `rows` once the Set is put back in ascending order. */
      g.setSelection(get().selection.rows, row)
    },

    async selectBranch(row) {
      const g = get().graphRef.current
      if (!g) return
      const rows = g.branchSegment(row).sort((a, b) => a - b)
      await g.pin(rows) // the detail panel reads `commit(row)` synchronously across the whole selection
      const key = keyOfRow(g, row)
      const hashes = rows.map((r) => g.commit(r)!.h)
      set((s) => ({
        selection: {
          hashes,
          rows,
          mode: "branch",
          focusedKeys: sameSet(s.selection.focusedKeys, new Set(key ? [key] : [])),
        },
        ui: { ...s.ui, view: "commits", diff: null, conflict: null },
      }))
      g.setSelection(rows, row)
    },

    async focusRef(r, additive) {
      const g = get().graphRef.current
      if (!g) return
      const key = `${r.kind}:${r.name}`
      const removing = additive && get().selection.focusedKeys.has(key)
      if (!removing) await g.jumpTo(r.tip)
      const row = (await g.rowsOf([r.tip]))[0]
      if (row === undefined) return
      const seg = r.kind === "tag" ? [row] : g.branchSegment(row)
      await g.pin(seg) // the detail panel reads `commit(row)` synchronously across the whole selection

      if (!additive) {
        const sorted = [...seg].sort((a, b) => a - b)
        const hashes = sorted.map((x) => g.commit(x)!.h)
        set((s) => ({
          selection: {
            hashes,
            rows: sorted,
            mode: r.kind === "tag" ? "multi" : "branch",
            focusedKeys: sameSet(s.selection.focusedKeys, new Set([key])),
          },
          ui: { ...s.ui, view: "commits", diff: null, conflict: null },
        }))
        g.setSelection(get().selection.rows, row)
        return
      }

      set((s) => {
        const focusedKeys = new Set(s.selection.focusedKeys)
        const rows = new Set(s.selection.rows)
        for (const x of seg) removing ? rows.delete(x) : rows.add(x)
        removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        const sortedRows = [...rows].sort((a, b) => a - b)
        const hashes = sortedRows.map((x) => g.commit(x)!.h)
        return {
          selection: { hashes, rows: sortedRows, mode: "multi", focusedKeys },
          ui: { ...s.ui, view: "commits", diff: null, conflict: null },
        }
      })
      g.setSelection(get().selection.rows, row)
    },

    async focusStash(s) {
      await get().graphRef.current?.jumpTo(s.h)
    },

    async focusWorktree(w) {
      await get().graphRef.current?.jumpTo(w.head)
    },

    clearFocus() {
      set((s) => ({
        selection: {
          hashes: sameArr(s.selection.hashes, []),
          rows: sameArr(s.selection.rows, []),
          mode: s.selection.mode,
          focusedKeys: sameSet(s.selection.focusedKeys, new Set()),
        },
        ui: { ...s.ui, diff: null, conflict: null },
      }))
      get().graphRef.current?.setSelection([])
    },

    async reresolveSelection() {
      const g = get().graphRef.current
      const { hashes, rows: prevRows } = get().selection
      if (!g || !hashes.length) {
        set((s) => ({ selection: { ...s.selection, rows: [] } }))
        return
      }
      /* bounded re-resolution (refresh audit, §6): the selection lived around `prevRows`
         before the reset — search there (plus generous slack for commits pulled in on top),
         not the whole history. Without the cap, amending a selected commit made `rowsOf`
         page in the entire repo chasing a hash that no longer exists. rows are kept sorted
         ascending, so the last element is the max (a spread over a branch-sized selection
         would blow the argument limit). */
      const bound = (prevRows.length ? prevRows[prevRows.length - 1] : 0) + 10_000
      const rows = [...(await g.rowsOf(hashes, bound))].sort((a, b) => a - b)
      await g.pin(rows)
      const resolvedHashes = rows.map((r) => g.commit(r)!.h)
      /* partial resolution (bound hit, page failure): keep the original hash list — the
         missing commits may still exist beyond the search bound and the next reload retries;
         only a complete resolution rewrites it (shedding duplicates the graph folded) */
      set((s) => ({
        selection: {
          ...s.selection,
          rows,
          hashes: rows.length === hashes.length ? resolvedHashes : s.selection.hashes,
        },
      }))
      /* reclaims the keyboard cursor (AUDIT.md §8): without this, the selection restored after a
         pull/checkout/stash would stay displayed while the keyboard cursor — primed on row 0
         by controller.ts `reset()` just before — would point elsewhere. */
      g.setSelection(rows, rows[0])
    },

    setSubject(v) {
      set((s) => ({ commitDraft: { ...s.commitDraft, subject: v } }))
    },
    setDescription(v) {
      set((s) => ({ commitDraft: { ...s.commitDraft, description: v } }))
    },
    async toggleAmend(on) {
      if (!on) {
        const draft = draftBackup
        draftBackup = null
        set(() => ({
          commitDraft: { subject: draft?.subject ?? "", description: draft?.description ?? "", amend: false },
        }))
        return
      }
      const msg = await api.headMessage().catch(() => null)
      if (!msg) return
      draftBackup = { subject: get().commitDraft.subject, description: get().commitDraft.description }
      set(() => ({ commitDraft: { subject: msg.subject, description: msg.body, amend: true } }))
    },

    toggleSidebar() {
      set((s) => ({ ui: { ...s.ui, sidebarOpen: !s.ui.sidebarOpen } }))
    },
    showWorktree() {
      set((s) => ({
        selection: { ...s.selection, rows: [], hashes: [] },
        ui: { ...s.ui, diff: null, conflict: null, view: "wt" },
      }))
      get().graphRef.current?.setSelection([])
    },
    showCommits() {
      set((s) => ({ ui: { ...s.ui, view: "commits" } }))
    },
    openFlowStart(kind, base) {
      set((s) => ({ ui: { ...s.ui, flowStart: { kind, base }, flowFinish: null } }))
    },
    closeFlowStart() {
      set((s) => ({ ui: { ...s.ui, flowStart: null } }))
    },
    openFlowFinish(branch, kind) {
      set((s) => ({ ui: { ...s.ui, flowFinish: { branch, kind }, flowStart: null } }))
    },
    closeFlowFinish() {
      set((s) => ({ ui: { ...s.ui, flowFinish: null } }))
    },
    openDiff(ctx, file) {
      set((s) => ({ ui: { ...s.ui, diff: { ctx, file } } }))
    },
    closeDiff() {
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: null } }))
    },
    setDiffMode(v) {
      prefs.diffView.set(v)
      set((s) => ({ ui: { ...s.ui, diffMode: v } }))
    },
    openConflict(file) {
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: file } }))
    },
    closeConflict() {
      set((s) => ({ ui: { ...s.ui, conflict: null } }))
    },

    /* Same shape as runWt (failure = badge, no reload): resolving only moves the file from
       `conflicts` to `staged`, the graph has nothing to relayout. The conflict cache is
       invalidated here rather than in `invalidateRepo` — a background refetch elsewhere
       would clobber an in-progress edit of another file (cf. conflict-queries.ts). */
    async resolveConflict(path, content) {
      try {
        await api.resolve(path, content)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      set((s) => ({ ui: { ...s.ui, conflict: null } }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conflictAll(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mergeState(repoId) }),
      ])
    },

    abortMerge() {
      return get().runGitAction(() => api.mergeAbort())
    },

    setBusyOp(op) {
      set((s) => ({ ops: { ...s.ops, busyOp: op } }))
    },
    setOpProgress(progress) {
      set((s) => ({ ops: { ...s.ops, opProgress: progress } }))
    },
    setFlowBusy(v) {
      set((s) => ({ ops: { ...s.ops, flowBusy: v } }))
    },
    /* the badge clears itself; only an action ("Reload") keeps it in place */
    showOp(text, color, action) {
      clearTimeout(okTimer)
      set((s) => ({ ops: { ...s.ops, opState: { text, color, action } } }))
      if (!action) okTimer = window.setTimeout(() => set((s) => ({ ops: { ...s.ops, opState: null } })), 6000)
    },
    clearOp() {
      clearTimeout(okTimer)
      set((s) => ({ ops: { ...s.ops, opState: null } }))
    },
    setStats(stats) {
      set((s) => ({ graph: { ...s.graph, stats } }))
    },

    resetAndLoad(opts) {
      /* the UI intent of a hard reload applies immediately, even when the graph rerun is
         coalesced into an already-queued one */
      if (!opts?.soft) set((s) => ({ ui: { ...s.ui, diff: null, conflict: null, view: "commits" } }))
      /* running + queued = 2: a third caller is satisfied by the queued rerun, which starts
         after the current one and reads fresh state */
      if (reloadDepth >= 2) return reloadChain
      reloadDepth++
      reloadChain = reloadChain
        .catch(() => {}) // a failed run must not poison the runs chained behind it
        .then(async () => {
          try {
            await get().graphRef.current?.reset()
            await get().reresolveSelection()
            await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
          } finally {
            reloadDepth--
          }
        })
      return reloadChain
    },

    async runGitAction(action, opts) {
      /* a branch pull/push/delete streams `--progress` into the footer (via onProgress); clear any
         leftover before, and once the action settles, so the live percentage never outlives it */
      get().setOpProgress(null)
      const err = await action().then(() => null, describeError)
      get().setOpProgress(null)
      if (!err) opts?.onSuccess?.()
      invalidateRepo(queryClient, repoId)
      await get().resetAndLoad()
      if (err) get().showOp(err, "danger")
    },

    async runFlow(action) {
      get().setFlowBusy(true)
      const err = await action().then(() => null, describeError)
      get().setFlowBusy(false)
      invalidateRepo(queryClient, repoId)
      await get().resetAndLoad()
      return err
    },

    async doCommit() {
      const { subject, description, amend } = get().commitDraft
      const subj = subject.trim()
      const body = description.trim()
      try {
        await api.commit(body ? `${subj}\n\n${body}` : subj, amend)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      set(() => ({ commitDraft: { subject: "", description: "", amend: false } }))
      draftBackup = null
      /* a staged-source diff shows content that just left the tree — close it; unstaged/
         untracked files weren't touched by the commit, their diff stays */
      const open = get().ui.diff
      if (open && "wt" in open.ctx && open.ctx.wt === "staged") set((s) => ({ ui: { ...s.ui, diff: null } }))
      invalidateRepo(queryClient, repoId)
      invalidateWtDiffs(queryClient, repoId)
      /* soft: committing from the staging panel must not eject the user from it — with
         nothing left to commit, RepoView's emptied-tree effect switches views on its own */
      await get().resetAndLoad({ soft: true })
    },

    runStash(action, name) {
      return get().runGitAction(() => api.stash(action, name), {
        onSuccess: () => {
          if (action === "push") set((s) => ({ commitDraft: { ...s.commitDraft, subject: "" } }))
        },
      })
    },

    runBranch(action, name) {
      if (action !== "finish") return get().runGitAction(() => api.branch(action, name))
      /* a feature/bugfix finish never runs straight away: every entry point (menu, sidebar
         shortcut, refs menu) lands here, and the flow banner rolls to its confirmation row
         instead — the submit goes through `api.flowFinish` with the chosen options. The kind
         comes from the flow query's cache: the finish entry points only exist once it's loaded. */
      const prefixes = queryClient.getQueryData<FlowPrefixes | null>(queryKeys.flow(repoId))
      const kind = prefixes && (["feature", "bugfix"] as const).find((k) => prefixes[k] && name.startsWith(prefixes[k]))
      if (kind) {
        get().openFlowFinish(name, kind)
        return Promise.resolve()
      }
      /* release/hotfix keep the plain `git flow finish`, flagged so the flow banner animates
         while it runs (merge + tag + back-merge can take a while) */
      return get().runGitAction(async () => {
        get().setFlowBusy(true)
        try {
          await api.branch("finish", name)
        } finally {
          get().setFlowBusy(false)
        }
      })
    },

    runFlowPublish(kind, name) {
      return get().runGitAction(async () => {
        get().setFlowBusy(true)
        try {
          await api.flowPublish(kind, name)
        } finally {
          get().setFlowBusy(false)
        }
      })
    },

    deleteBranch(name, deleteRemote) {
      return get().runGitAction(() => api.branchDelete(name, deleteRemote))
    },

    checkout(name) {
      return get().runGitAction(() => api.checkout(name))
    },

    async runWt(act, paths) {
      try {
        await act(api, paths)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    },

    /* Same shape as runWt (failure = badge, no reload), plus: the diff caches refresh — the
       discarded file's diff may be on screen — and a diff open on a discarded path closes,
       there is nothing left to show. */
    async runDiscard(paths, untracked) {
      try {
        await api.discard(paths, untracked)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      const open = get().ui.diff
      if (open && "wt" in open.ctx && [...paths, ...untracked].includes(open.file.path))
        set((s) => ({ ui: { ...s.ui, diff: null } }))
      await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
      /* wt diffs only: the discard touched the tree/index, never a commit↔commit diff */
      invalidateWtDiffs(queryClient, repoId)
    },

    runWorktree(action, path) {
      return get().runGitAction(() => api.worktreeAct(action, path))
    },

    async openWorktree(path) {
      try {
        onOpenRepo(await api.worktreeOpen(path))
      } catch (e) {
        get().showOp(describeError(e), "danger")
      }
    },

    async addWorktree(branch) {
      let repo: Repo | null
      try {
        repo = await api.worktreeAdd(branch)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      if (!repo) return // dialog cancelled
      invalidateRepo(queryClient, repoId)
      /* soft: the new worktree opens as its own tab — this tab only needs the chip to appear
         on its branch tip, not a view/diff teardown */
      await get().resetAndLoad({ soft: true })
      onOpenRepo(repo)
    },
  }))
}

const RepoStoreContext = createContext<StoreApi<RepoStoreState> | null>(null)

export function RepoProvider({
  repoId,
  api,
  onOpenRepo,
  children,
}: {
  repoId: number
  api: RepoApi
  /** surfaces a repo opened from inside the tab (a linked worktree) as a new tab — App's `openTab` */
  onOpenRepo: (repo: Repo) => void
  children: ReactNode
}) {
  /* created once per mounted tab: App keeps visited tabs mounted (keep-mounted), the
     store follows the same lifetime as RepoView for this repo. The callback goes through a
     ref: App recreates `openTab` on every tab/active change, the store must call the live one. */
  const openRef = useRef(onOpenRepo)
  openRef.current = onOpenRepo
  const store = useRef<StoreApi<RepoStoreState> | null>(null)
  store.current ??= createRepoStore(repoId, api, (repo) => openRef.current(repo))
  return <RepoStoreContext.Provider value={store.current}>{children}</RepoStoreContext.Provider>
}

/** Access to the store instance (for imperative `.getState()`/`.setState()` — git event
    subscriptions, graph callbacks). Prefer `useRepoStore(selector)` in render. */
export function useRepoStoreApi(): StoreApi<RepoStoreState> {
  const store = useContext(RepoStoreContext)
  if (!store) throw new Error("useRepoStoreApi must be used inside <RepoProvider>")
  return store
}

export function useRepoStore<T>(selector: (s: RepoStoreState) => T): T {
  return useStore(useRepoStoreApi(), selector)
}

/** Subscriptions to the repo's git events (`git:changed`, `git:op`) — a single place that
    translates main's push into query invalidations and store actions, rather than
    living inline in RepoView's layout. `active` defers external-change reloads of a
    background tab until it's shown again: a window refocus with N dirty tabs used to pay
    N full reloads at once for N−1 invisible graphs (refresh audit, §8). */
export function useRepoEvents(active: boolean): void {
  const store = useRepoStoreApi()
  const repoId = useRepoStore((s) => s.repoId)
  const queryClient = useQueryClient()

  const activeRef = useRef(active)
  activeRef.current = active
  const pendingChange = useRef(false)

  /* One definition of "an external change must refresh this repo" — shared by the live
     handler and the deferred flush below, so a background tab replays exactly the reaction
     a foreground tab would have had. Soft reload: an external change is background-initiated
     — it must never close the user's diff, eject them from the staging view, or move their
     scroll. */
  const externalReload = useCallback(() => {
    invalidateRepo(queryClient, repoId)
    invalidateWtDiffs(queryClient, repoId)
    void store.getState().resetAndLoad({ soft: true })
  }, [queryClient, repoId, store])

  /* Refs moved outside the application: commit, rebase or checkout from a terminal.
     Main only notifies when in the foreground, stays quiet after our own commands, and
     (emitChanged gate, main/watcher.ts) only when the graph fingerprint actually moved. */
  useEffect(
    () =>
      onChanged((p) => {
        if (p.id !== repoId) return
        if (!activeRef.current) {
          pendingChange.current = true
          return
        }
        externalReload()
      }),
    [repoId, externalReload]
  )

  /* deferred external change lands when the tab is brought back to the foreground */
  useEffect(() => {
    if (!active || !pendingChange.current) return
    pendingChange.current = false
    externalReload()
  }, [active, externalReload])

  /* --- Git operations: the click launches, but all the feedback goes through onOp (main
     process auto-fetch emits without a renderer-side caller). --- */
  useEffect(
    () =>
      onOp(async (p) => {
        if (p.id !== repoId) return
        const s = store.getState()
        s.setBusyOp(p.state === "start" ? p.op : null)
        /* start: drop a stale percentage until git emits the new op's first one; end: the run is
           over, so the live footer percentage goes with it (settled state takes the feed) */
        s.setOpProgress(null)
        if (p.state === "start") return
        if (p.state === "error") {
          await queryClient.invalidateQueries({ queryKey: queryKeys.status(repoId) })
          return s.showOp(describePayload(p), "danger")
        }
        invalidateRepo(queryClient, repoId)
        /* Rien n'a bougé (push/pull « up to date », fetch sans nouveauté) : le graph est déjà
           juste, recharger ne ferait que secouer scroll et sélection pour rien. */
        if (!p.changed) return
        /* Une op manuelle est une action explicite : on recharge pour que le graph reflète les
           refs qui ont bougé — commits récupérés (pull), marqueurs « à pusher » et position du
           ref distant (push), branches élaguées (fetch --prune) —, le badge « N nouveaux
           commits » (fetch seul) ne servant plus que d'accusé de réception. Un auto-fetch reste
           non intrusif — badge cliquable seul, pour qu'un fetch d'arrière-plan n'arrache jamais
           le scroll ni la sélection à l'utilisateur ; sans nouveau commit (élagage pur), il n'a
           même pas de badge à montrer et le graph attend le prochain rechargement. */
        if (!p.auto) {
          if (p.added > 0) s.showOp(messages.app.newCommits(p.added), "primary")
          await s.resetAndLoad()
        } else if (p.added > 0) {
          s.showOp(messages.app.newCommits(p.added), "primary", {
            label: messages.app.reload,
            run: () => {
              s.clearOp()
              void s.resetAndLoad()
            },
          })
        }
      }),
    [repoId, queryClient, store]
  )

  /* Live `--progress` percentage of the running network op → footer feed, mirroring how the
     maintenance modal consumes fsck/gc (cf. use-repo-menu-tools). The maintenance ops (fsck/gc)
     travel on the same channel but are handled there; here we only pick up fetch/pull/push. */
  useEffect(
    () =>
      onProgress((p) => {
        if (p.id !== repoId) return
        if (p.op === "fetch" || p.op === "pull" || p.op === "push")
          store.getState().setOpProgress({ op: p.op, percent: p.percent })
      }),
    [repoId, store]
  )
}
