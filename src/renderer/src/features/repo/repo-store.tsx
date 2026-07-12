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
   `CommitGraph` expects): mutating it notifies no subscriber, only a thin effect
   (in the graph component) syncs `selection.rows` → `graphRef.current.setSelection`.

   The "git op → refresh → resetAndLoad → showOp" quartet, copy-pasted four times in the old
   repo-view.tsx (checkout, stash, branch — the commit has its own shape, a failure doesn't
   reload there), becomes `runGitAction`. */

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createStore, useStore, type StoreApi } from "zustand"

import { describeError, describePayload } from "@/lib/errors"
import {
  onChanged,
  onOp,
  type BranchAct,
  type FileChange,
  type GitRef,
  type OpName,
  type RepoApi,
  type Stash,
  type StashAct,
} from "@/lib/git"
import { messages } from "@/lib/messages"
import { prefs } from "@/lib/prefs"
import { invalidateRepo, queryKeys } from "@/lib/queries"
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
  }
  ops: {
    busyOp: OpName | null
    opState: OpState | null
  }
  graph: {
    stats: Stats | null
  }

  selectRow(row: number, additive: boolean): void
  selectBranch(row: number): Promise<void>
  focusRef(r: GitRef, additive: boolean): Promise<void>
  focusStash(s: Stash): Promise<void>
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
  openDiff(ctx: DiffCtx, file: FileChange): void
  closeDiff(): void
  setDiffMode(v: DiffViewMode): void
  openConflict(file: FileChange): void
  closeConflict(): void
  /** writes the merged output, stages the file (main-side `repo:resolve`), closes the view */
  resolveConflict(path: string, content: string): Promise<void>
  abortMerge(): Promise<void>

  setBusyOp(op: OpName | null): void
  showOp(text: string, color: OpState["color"], action?: OpState["action"]): void
  clearOp(): void
  setStats(stats: Stats): void

  /** closes the diff, returns to the commits view, restarts the graph and re-resolves the selection */
  resetAndLoad(): Promise<void>
  /** git op → status invalidation → resetAndLoad → error badge, in a single place */
  runGitAction(action: () => Promise<void>, opts?: { onSuccess?(): void }): Promise<void>
  doCommit(): Promise<void>
  runStash(action: StashAct, name?: string): Promise<void>
  runBranch(action: BranchAct, name: string): Promise<void>
  checkout(name: string): Promise<void>
  runWt(act: WtAct, paths: string[]): Promise<void>
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

export function createRepoStore(repoId: number, api: RepoApi): StoreApi<RepoStoreState> {
  let okTimer = 0
  /* message draft set aside while an amend borrows the last commit's */
  let draftBackup: { subject: string; description: string } | null = null

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
    },
    ops: { busyOp: null, opState: null },
    graph: { stats: null },

    selectRow(row, additive) {
      const g = get().graphRef.current
      if (!g) return
      const c = g.commit(row)
      if (!c) return
      const key = keyOfRow(g, row)
      set((s) => {
        if (!additive) {
          return {
            selection: { hashes: [c.h], rows: [row], mode: "multi", focusedKeys: new Set(key ? [key] : []) },
            ui: { ...s.ui, view: "commits", diff: null, conflict: null },
          }
        }
        const hashes = new Set(s.selection.hashes)
        const rows = new Set(s.selection.rows)
        const removing = toggleAdditive(rows, [row])
        removing ? hashes.delete(c.h) : hashes.add(c.h)
        const focusedKeys = new Set(s.selection.focusedKeys)
        if (key) removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        return {
          selection: { hashes: [...hashes], rows: [...rows].sort((a, b) => a - b), mode: "multi", focusedKeys },
          ui: { ...s.ui, view: "commits", diff: null, conflict: null },
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
        selection: { hashes, rows, mode: "branch", focusedKeys: new Set(key ? [key] : []) },
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
          selection: { hashes, rows: sorted, mode: r.kind === "tag" ? "multi" : "branch", focusedKeys: new Set([key]) },
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

    clearFocus() {
      set((s) => ({
        selection: { hashes: [], rows: [], mode: s.selection.mode, focusedKeys: new Set() },
        ui: { ...s.ui, diff: null, conflict: null },
      }))
      get().graphRef.current?.setSelection([])
    },

    async reresolveSelection() {
      const g = get().graphRef.current
      const { hashes } = get().selection
      if (!g || !hashes.length) {
        set((s) => ({ selection: { ...s.selection, rows: [] } }))
        return
      }
      const rows = [...(await g.rowsOf(hashes))].sort((a, b) => a - b)
      await g.pin(rows)
      const resolvedHashes = rows.map((r) => g.commit(r)!.h)
      set((s) => ({ selection: { ...s.selection, rows, hashes: resolvedHashes } }))
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
      set((s) => ({ selection: { ...s.selection, rows: [], hashes: [] }, ui: { ...s.ui, diff: null, conflict: null, view: "wt" } }))
      get().graphRef.current?.setSelection([])
    },
    showCommits() {
      set((s) => ({ ui: { ...s.ui, view: "commits" } }))
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

    async resetAndLoad() {
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: null, view: "commits" } }))
      await get().graphRef.current?.reset()
      await get().reresolveSelection()
      await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    },

    async runGitAction(action, opts) {
      const err = await action().then(() => null, describeError)
      if (!err) opts?.onSuccess?.()
      invalidateRepo(queryClient, repoId)
      await get().resetAndLoad()
      if (err) get().showOp(err, "danger")
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
      invalidateRepo(queryClient, repoId)
      await get().resetAndLoad()
    },

    runStash(action, name) {
      return get().runGitAction(() => api.stash(action, name), {
        onSuccess: () => {
          if (action === "push") set((s) => ({ commitDraft: { ...s.commitDraft, subject: "" } }))
        },
      })
    },

    runBranch(action, name) {
      return get().runGitAction(() => api.branch(action, name))
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
  }))
}

const RepoStoreContext = createContext<StoreApi<RepoStoreState> | null>(null)

export function RepoProvider({ repoId, api, children }: { repoId: number; api: RepoApi; children: ReactNode }) {
  /* created once per mounted tab: App keeps visited tabs mounted (keep-mounted), the
     store follows the same lifetime as RepoView for this repo. */
  const store = useRef<StoreApi<RepoStoreState> | null>(null)
  store.current ??= createRepoStore(repoId, api)
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
    living inline in RepoView's layout. */
export function useRepoEvents(): void {
  const store = useRepoStoreApi()
  const repoId = useRepoStore((s) => s.repoId)
  const queryClient = useQueryClient()

  /* Refs moved outside the application: commit, rebase or checkout from a terminal.
     Main only notifies when in the foreground and stays quiet after our own commands. */
  useEffect(
    () =>
      onChanged((p) => {
        if (p.id !== repoId) return
        invalidateRepo(queryClient, repoId)
        void store.getState().resetAndLoad()
      }),
    [repoId, queryClient, store]
  )

  /* --- Git operations: the click launches, but all the feedback goes through onOp (main
     process auto-fetch emits without a renderer-side caller). --- */
  useEffect(
    () =>
      onOp(async (p) => {
        if (p.id !== repoId) return
        const s = store.getState()
        s.setBusyOp(p.state === "start" ? p.op : null)
        if (p.state === "start") return
        if (p.state === "error") {
          await queryClient.invalidateQueries({ queryKey: queryKeys.status(repoId) })
          return s.showOp(describePayload(p), "danger")
        }
        invalidateRepo(queryClient, repoId)
        if (p.op === "pull") {
          await s.resetAndLoad()
        } else if (p.added > 0) {
          /* the graph isn't reloaded automatically: that would lose the scroll and the selection */
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
}
