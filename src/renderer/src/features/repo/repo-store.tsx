/* Per-repo client store (AUDIT.md §5, "renderer state" workstream): a vanilla zustand store
   per open tab, created inside a `<RepoProvider>` and consumed by selector — the antidote to
   the `repo-view.tsx` god-component (22 `useState`, 14 `useEffect`, 10 props to RefsSidebar, 14
   to WorktreePanel). Slices: `selection`, `commitDraft`, `ui`, `mergeQueue`, `ops`, `graph`.

   This file is the store's contract and assembly: the state shape (`RepoStoreState`), the
   slice initializers, and the provider/hooks. The ~55 actions live in ./store/, grouped by
   what they own (architecture audit, §II.1) — selection.ts (and the one place that mirrors
   every selection write to the canvas), draft.ts, dialogs.ts, ops.ts, reload.ts (the
   soft/hard reload pair), merge-queue.ts, mutations.ts — each a `create*Actions(ctx)`
   composed into `createRepoStore` below. An action group needing another goes through
   `ctx.get()`, same as before the split; the interface here is what keeps the pieces honest.

   `graphRef` lives in the store as a non-reactive ref (same shape as the `RefObject` that
   `CommitGraph` expects): mutating it notifies no subscriber. The selection actions push
   `selection.rows` to the canvas imperatively (store/selection.ts `applySelection`) — there
   is no mirror effect on the graph component's side. */

import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createStore, useStore, type StoreApi } from "zustand"

import { describePayload } from "@/lib/errors"
import {
  onChanged,
  onOp,
  onProgress,
  onQueue,
  onWtChanged,
  type BranchAct,
  type FileChange,
  type GitRef,
  type OpName,
  type Repo,
  type RepoApi,
  type ResetMode,
  type Stash,
  type StashAct,
  type WorktreeAct,
  type WorktreeInfo,
} from "@/lib/git"
import type { BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { prefs } from "@/lib/prefs"
import { invalidateRepo, invalidateWtDiffs, queryKeys } from "@/lib/queries"
import type { DiffCtx, DiffViewMode } from "@/features/diff/diff-view"
import type { GraphHandle, Stats } from "@/features/graph/controller"
import type { OpState } from "@/features/repo/status-bar"

import { createDialogActions } from "./store/dialogs"
import { createDraftActions } from "./store/draft"
import { createMergeQueueActions } from "./store/merge-queue"
import { createMutationActions } from "./store/mutations"
import { createOpsActions } from "./store/ops"
import { createReloadActions } from "./store/reload"
import { createSelectionActions } from "./store/selection"

export type SelMode = "multi" | "branch"

/** The staging panel's two per-path index moves — everything else it runs has a dedicated
    store action. A plain name resolved against `api` in `runWt`, instead of the old
    `WtAct` closures the panel built over the very `RepoApi` the store already holds
    (architecture audit, §I.8). */
export type WtStageAct = "stage" | "unstage"

export type MergeQueueItemState = "pending" | "merging" | "merged" | "conflict"

/** The ordered merge queue armed by the release modal (or the selection menu): its branches
    are merged into `target` one at a time, each on an explicit click — never chained. The
    queue is session state, not git state: a restart falls back to a plain release with
    unmerged features, resumable from the branches' own merge actions. */
export type MergeQueue = {
  /** branch the queue merges into — the banner shows while HEAD sits on it */
  target: string
  items: { branch: string; state: MergeQueueItemState }[]
}

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
    /** file-history view (detail panel's context menu) — exclusive with `diff`/`conflict`,
        same overlay slot; `from` anchors the walk on the commit the menu was opened from */
    fileHistory: { path: string; from: string } | null
    /** inline `git flow <kind> start` banner open in RepoView — openable from the app menu
        (command channel) and from the sidebar's flow shortcut; `base` pre-selects the start
        point (the promoted moves pass the trunk HEAD sits on) */
    flowStart: { kind: BranchFlow; base?: string } | null
    /** finish confirmation of a feature/bugfix: every finish entry point routes here instead of
        running (the flow banner rolls to its options row — merge/rebase, delete); the kind is
        resolved from the gitflow prefixes at interception. Exclusive with `flowStart`. */
    flowFinish: { branch: string; kind: BranchFlow } | null
    /** inline "create branch at commit" banner (graph context menu) — `from` is the full SHA */
    branchCreate: { from: string } | null
    /** inline "create worktree at commit" banner (graph context menu); exclusive with `branchCreate` */
    worktreeCreate: { from: string } | null
    /** "create a release from these branches" modal (sidebar selection menu) — `branches`
        keeps the selection order, which seeds the merge order */
    releaseCreate: { branches: string[] } | null
    /** a push was refused because the remote branch is ahead (`git:op` error REMOTE_AHEAD):
        the banner offers the ways out — fast-forward pull, force push, or cancel */
    remoteAhead: { behind: number } | null
  }
  /** ordered merge queue (release composition) — see MergeQueue */
  mergeQueue: MergeQueue | null
  ops: {
    busyOp: OpName | null
    opState: OpState | null
    /** live `NN%` of the running network op (fetch/pull/push), streamed from git's `--progress`;
        `null` between commands or before git emits its first percentage. Footer feed, cf. status-bar. */
    opProgress: { op: OpName; percent: number } | null
    /** main-side mutation queue (`git:queue`): the label holding the lock and the labels
        waiting behind it, in run order — footer "N queued" indicator, toolbar greying */
    queue: { running: string | null; pending: string[] }
    /** a gitflow operation (start/finish/publish/init) is running its git commands — the flow
        banners roll the traced commands with the shimmer sweeping them (cf. FlowBanner).
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
  openBranchCreate(from: string): void
  closeBranchCreate(): void
  openWorktreeCreate(from: string): void
  closeWorktreeCreate(): void
  openReleaseCreate(branches: string[]): void
  closeReleaseCreate(): void
  openRemoteAhead(behind: number): void
  closeRemoteAhead(): void
  /** the banner's way out: `pull --ff` (integrate the remote's commits, merging if diverged)
      or `push --force-with-lease` (overwrite them). Resolves when the op settles — feedback
      travels on the usual `git:op` events (footer feed, badge on failure). */
  resolveRemoteAhead(choice: "pull" | "force"): Promise<void>
  /** arms the merge queue on `target` with `branches`, in order (replaces any previous queue) */
  armMergeQueue(target: string, branches: string[]): void
  /** drops the queue (remaining merges only — the release itself is untouched) */
  closeMergeQueue(): void
  /** one explicit merge: `git merge --no-ff <branch>` into HEAD. Success advances the item to
      `merged`; a conflict parks it on `conflict` — resolution and abort belong to the
      repo-wide ConflictBanner; any other failure puts it back to `pending` with the error
      badge. */
  queueMerge(branch: string): Promise<void>
  /** Re-reads the pending/conflict items against the target (mergePreview): an item that
      landed outside the queue's own click — a conflict resolved and committed by hand, a
      manual merge — moves to `merged`; a conflict whose merge is no longer in progress
      (aborted, via the ConflictBanner or a terminal) falls back to `pending`. */
  queueRecheck(): Promise<void>
  openDiff(ctx: DiffCtx, file: FileChange): void
  closeDiff(): void
  setDiffMode(v: DiffViewMode): void
  /** opens the file-history overlay: the commits that touched `path`, walked from `from` */
  openFileHistory(from: string, path: string): void
  closeFileHistory(): void
  /** `git restore --source=<hash> --worktree` of one path — confirmed upstream (dialog),
      then the worktree caches refresh so the restored state shows up as an unstaged change */
  restoreFile(hash: string, path: string): Promise<void>
  openConflict(file: FileChange): void
  closeConflict(): void
  /** writes the merged output, stages the file (main-side `repo:resolve`), closes the view */
  resolveConflict(path: string, content: string): Promise<void>
  abortMerge(): Promise<void>

  setBusyOp(op: OpName | null): void
  /** live footer percentage of a running network op; `null` clears it (op settled or reset) */
  setOpProgress(progress: { op: OpName; percent: number } | null): void
  /** mirrors a `git:queue` event into `ops.queue` */
  setQueue(queue: { running: string | null; pending: string[] }): void
  /** raises/clears `ops.flowBusy` around a gitflow command (cf. runFlow/runBranch/runFlowPublish) */
  setFlowBusy(v: boolean): void
  showOp(text: string, color: OpState["color"], action?: OpState["action"]): void
  clearOp(): void
  setStats(stats: Stats): void

  /** Restarts the graph (scroll-preserving, cf. controller.ts) and re-resolves the selection,
      leaving the current view and any open diff alone — the right call for anything
      background-initiated (watcher event, commit from the staging panel): a change the user
      didn't just ask for must never rip their workspace away (refresh audit, §1/§4).
      Overlapping reloads coalesce into one trailing rerun instead of stacking. */
  reload(): Promise<void>
  /** `reload()` plus the teardown of a user-initiated context switch (checkout, pull…):
      closes the diff/conflict/history overlay and returns to the commits view. The
      destructive variant is the one a caller must spell out — preservation used to be the
      opt-in `soft` flag, and every caller that forgot it shipped the "lose my place"
      regression back (architecture audit, §I.5). */
  hardReload(): Promise<void>
  /** git op → status invalidation → hardReload → error badge, in a single place */
  runGitAction(action: () => Promise<void>, opts?: { onSuccess?(): void }): Promise<void>
  /** Like `runGitAction`, but returns the error text (or `null`) instead of flashing a badge —
      the git-flow init/start surfaces show it inline and stay open on failure. */
  runFlow(action: () => Promise<void>): Promise<string | null>
  doCommit(): Promise<void>
  /** `git commit --amend --only` of HEAD's message alone (detail panel's inline edit).
      Returns the error text (or `null`): the form shows it inline and stays open on failure. */
  rewordHead(subject: string, description: string): Promise<string | null>
  runStash(action: StashAct, name?: string): Promise<void>
  runBranch(action: BranchAct, name: string): Promise<void>
  /** `git flow <kind> publish` through `runGitAction`, flagging `ops.flowBusy` like finish/start */
  runFlowPublish(kind: BranchFlow, name: string): Promise<void>
  /** `git branch -D`, plus the remote branch when `deleteRemote` — reloads and badges like the rest */
  deleteBranch(name: string, deleteRemote: boolean): Promise<void>
  /** `git push <remote> --delete` of a remote-tracking ref ("origin/topic"), confirmed upstream */
  deleteRemoteBranch(name: string): Promise<void>
  /** `git tag -d`, plus its remote counterpart when `remote` — confirmed upstream like deleteBranch */
  deleteTag(name: string, remote: string | null): Promise<void>
  /** `git branch <name> <from>` (+ checkout) through `runFlow`: the banner shows the error inline */
  createBranch(name: string, from: string, checkout: boolean): Promise<string | null>
  /** lightweight `git tag <name> <at>` through `runFlow`: the dialog shows the error inline */
  createTag(name: string, at: string): Promise<string | null>
  /** `git reset --<mode> <to>` of the current branch — the mode modal confirmed upstream */
  resetTo(mode: ResetMode, to: string): Promise<void>
  /** `git revert --no-edit <hash>` — a conflict lands in the usual conflicts view */
  revertCommit(hash: string): Promise<void>
  /** `git cherry-pick <hash>` onto HEAD — a conflict lands in the usual conflicts view */
  cherryPickCommit(hash: string): Promise<void>
  checkout(name: string): Promise<void>
  runWt(act: WtStageAct, paths: string[]): Promise<void>
  /** whole-file discard: tracked paths restored from the index, untracked deleted */
  runDiscard(paths: string[], untracked: string[]): Promise<void>
  /** remove/prune of a linked worktree; the graph reloads (the chip must disappear) */
  runWorktree(action: WorktreeAct, path?: string): Promise<void>
  /** opens a listed worktree as a new tab (via `onOpenRepo`, wired to App's `openTab`) */
  openWorktree(path: string): Promise<void>
  /** destination picker + `git worktree add <dir> <branch>`, then opens the new tab */
  addWorktree(branch: string): Promise<void>
  /** destination picker + `git worktree add -b <branch> <dir> <from>`, then opens the new tab;
      returns the error text for the banner (`null` on success or cancelled picker) */
  addWorktreeFrom(branch: string, from: string): Promise<string | null>
}

/** What every action group closes over — handed once to each `create*Actions` (./store/). */
export interface ActionCtx {
  set: StoreApi<RepoStoreState>["setState"]
  get: () => RepoStoreState
  api: RepoApi
  repoId: number
  onOpenRepo: (repo: Repo) => void
}

export function createRepoStore(
  repoId: number,
  api: RepoApi,
  onOpenRepo: (repo: Repo) => void
): StoreApi<RepoStoreState> {
  return createStore<RepoStoreState>((set, get) => {
    const ctx: ActionCtx = { set, get, api, repoId, onOpenRepo }
    return {
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
        fileHistory: null,
        diffMode: prefs.diffView.get() || "unified",
        flowStart: null,
        flowFinish: null,
        branchCreate: null,
        worktreeCreate: null,
        releaseCreate: null,
        remoteAhead: null,
      },
      mergeQueue: null,
      ops: { busyOp: null, opState: null, opProgress: null, queue: { running: null, pending: [] }, flowBusy: false },
      graph: { stats: null },

      ...createSelectionActions(ctx),
      ...createDraftActions(ctx),
      ...createDialogActions(ctx),
      ...createOpsActions(ctx),
      ...createReloadActions(ctx),
      ...createMergeQueueActions(ctx),
      ...createMutationActions(ctx),
    }
  })
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
    N full reloads at once for N−1 invisible graphs (refresh audit, §8). A background
    auto-fetch gets the same treatment: its commits load on arrival, the clickable reload
    badge being reserved for a fetch that lands under the user's eyes. */
export function useRepoEvents(active: boolean): void {
  const store = useRepoStoreApi()
  const repoId = useRepoStore((s) => s.repoId)
  const queryClient = useQueryClient()

  const activeRef = useRef(active)
  activeRef.current = active
  const pendingChange = useRef(false)
  /* working-tree-only change (IDE edit) observed while the tab was in the background —
     flushed on activation like pendingChange, but with the cheaper wt-scoped invalidation */
  const pendingWt = useRef(false)
  /* commits brought in by auto-fetch but not yet folded into a graph reload — accumulated
     across fetches, the count feeds the "N new commits" acknowledgment of whichever reload
     lands them: the badge's Reload click, a manual op's reload, or the activation flush */
  const pendingAdded = useRef(0)

  /* One definition of "an external change must refresh this repo" — shared by the live
     handler and the deferred flush below, so a background tab replays exactly the reaction
     a foreground tab would have had. Plain (soft) reload: an external change is
     background-initiated — it must never close the user's diff, eject them from the staging
     view, or move their scroll. */
  const externalReload = useCallback(() => {
    invalidateRepo(queryClient, repoId)
    invalidateWtDiffs(queryClient, repoId)
    void store.getState().reload()
  }, [queryClient, repoId, store])

  /* The working tree moved outside the app (IDE edit — main/watcher.ts watchWorktree): refs
     didn't move, so no graph reload — only what tracks the tree is stale. Status and merge
     state ride along (dirty markers, a conflict resolved in the editor), conflict contents too. */
  const externalWtRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.status(repoId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.mergeState(repoId) })
    void queryClient.invalidateQueries({ queryKey: queryKeys.conflictAll(repoId) })
    invalidateWtDiffs(queryClient, repoId)
  }, [queryClient, repoId])

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

  useEffect(
    () =>
      onWtChanged((p) => {
        if (p.id !== repoId) return
        if (!activeRef.current) {
          pendingWt.current = true
          return
        }
        externalWtRefresh()
      }),
    [repoId, externalWtRefresh]
  )

  /* Deferred change lands when the tab is brought back to the foreground: arriving at a tab
     reloads it directly — that instant can't disturb any in-progress work — instead of
     greeting the user with a "Reload" button; fetched commits announce themselves through
     the plain self-clearing acknowledgment badge. Leaving a tab folds a still-unclicked
     reload badge into that same flush (the graph never incorporated those commits), so a
     return never resurrects it either. */
  useEffect(() => {
    if (!active) {
      if (pendingAdded.current > 0) {
        store.getState().clearOp()
        pendingChange.current = true
      }
      return
    }
    if (pendingWt.current) {
      /* wt-scoped flush; overlapping keys with a simultaneous externalReload below dedupe
         inside TanStack Query, and conflict contents are covered by neither path but this one */
      pendingWt.current = false
      externalWtRefresh()
    }
    if (!pendingChange.current) return
    pendingChange.current = false
    const added = pendingAdded.current
    pendingAdded.current = 0
    if (added > 0) store.getState().showOp(messages.app.newCommits(added), "primary")
    externalReload()
  }, [active, externalReload, externalWtRefresh, store])

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
          /* a push refused because the remote is ahead isn't a dead end: the banner takes it
             (fast-forward pull / force push / cancel) instead of the danger badge */
          if (p.op === "push" && p.code === "REMOTE_AHEAD") return s.openRemoteAhead(parseInt(p.detail ?? "", 10) || 0)
          return s.showOp(describePayload(p), "danger")
        }
        /* a pull or push that went through leaves any remote-ahead banner without a subject
           (a toolbar pull the user ran instead of the banner's own buttons, say) */
        if (s.ui.remoteAhead && (p.op === "pull" || p.op === "push")) s.closeRemoteAhead()
        invalidateRepo(queryClient, repoId)
        /* Rien n'a bougé (push/pull « up to date », fetch sans nouveauté) : le graph est déjà
           juste, recharger ne ferait que secouer scroll et sélection pour rien. */
        if (!p.changed) return
        /* Une op manuelle est une action explicite : on recharge pour que le graph reflète les
           refs qui ont bougé — commits récupérés (pull), marqueurs « à pusher » et position du
           ref distant (push), branches élaguées (fetch --prune) —, le badge « N nouveaux
           commits » (fetch seul) ne servant plus que d'accusé de réception. Un auto-fetch ne
           doit rester non intrusif — badge cliquable seul — que pour l'onglet au premier plan,
           où recharger arracherait le scroll ou la sélection à l'utilisateur qui regarde ;
           en arrière-plan il n'y a rien à préserver : le flush d'activation recharge de
           lui-même à l'arrivée sur l'onglet (comme un changement externe différé) et le badge
           y redevient un simple accusé de réception. L'élagage pur (aucun commit) suit les
           mêmes chemins, sans badge — au premier plan, le graph attend le prochain
           rechargement. */
        if (!p.auto) {
          pendingAdded.current += p.added
          if (pendingAdded.current > 0) s.showOp(messages.app.newCommits(pendingAdded.current), "primary")
          pendingAdded.current = 0
          await s.hardReload()
        } else if (!activeRef.current) {
          pendingAdded.current += p.added
          pendingChange.current = true
        } else {
          pendingAdded.current += p.added
          if (pendingAdded.current > 0)
            s.showOp(messages.app.newCommits(pendingAdded.current), "primary", {
              label: messages.app.reload,
              run: () => {
                pendingAdded.current = 0
                s.clearOp()
                void s.hardReload()
              },
            })
        }
      }),
    [repoId, queryClient, store]
  )

  /* Mutation-queue transitions (main/repos.ts withLock): what runs and what waits behind it.
     Feeds the footer's "N queued" indicator and the toolbar's per-op greying. */
  useEffect(
    () =>
      onQueue((p) => {
        if (p.id !== repoId) return
        store.getState().setQueue({ running: p.running, pending: p.pending })
      }),
    [repoId, store]
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
