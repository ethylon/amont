/* Typed client for the bridge exposed by the preload. Domain types live in shared/ —
   this module re-exports them so renderer imports don't all have to move — and the
   bridge's shape (Bridge) is derived from the shared IPC contract (src/shared/ipc-contract.ts),
   compiled identically on the main and preload sides. */

export type {
  BlobData,
  BlobRef,
  BootState,
  BranchAct,
  ChangeEvent,
  Commit,
  CommitMessage,
  ConflictFile,
  CountObjects,
  DiffText,
  FileChange,
  FileLogEntry,
  FlowFinishOpts,
  FlowInfo,
  FlowInitConfig,
  FlowKind,
  FlowPrefixes,
  GitRef,
  MaintKind,
  MergeOp,
  MergePreview,
  MergePreviewStatus,
  MergeState,
  OpEvent,
  OpName,
  OpVariant,
  OpenResult,
  ProgressEvent,
  QueueEvent,
  Repo,
  RepoRef,
  ResetMode,
  Stash,
  StashAct,
  Status,
  TraceLine,
  UpdateStatus,
  Worktree,
  WorktreeAct,
  WorktreeInfo,
  WtSource,
} from "../../../shared/types.ts"

export type { PullMode, Settings } from "../../../shared/settings.ts"
/* the settings registry is a plain-data value (no node/electron deps): safe to bundle renderer-side,
   so the toolbar's options cards read defaults/options from the same source the main process does */
export { pullModeFlag, SETTINGS, SETTINGS_DEFAULTS } from "../../../shared/settings.ts"

import type { Bridge } from "../../../shared/ipc-contract.ts"
import type { Worktree, WorktreeInfo } from "../../../shared/types.ts"

declare global {
  interface Window {
    amont: Bridge
  }
}

const bridge = window.amont

export const host = {
  repos: bridge.repos,
  setTabs: bridge.setTabs,
  openDialog: bridge.openDialog,
  openPath: bridge.openPath,
  close: bridge.close,
  chooseRoot: bridge.chooseRoot,
  scanRoot: bridge.scanRoot,
  telemetryState: bridge.telemetryState,
  setTelemetry: bridge.setTelemetry,
  getSettings: bridge.getSettings,
  setSettings: bridge.setSettings,
  chooseCreateDir: bridge.chooseCreateDir,
  initRepo: bridge.initRepo,
  initBare: bridge.initBare,
  cloneRepo: bridge.cloneRepo,
  checkForUpdates: bridge.checkForUpdates,
  installUpdate: bridge.installUpdate,
}

/* The preload now handles unsubscription itself (`ipcRenderer.off`, see src/preload):
   each call to onOp/onChanged/onTrace sets its own IPC listener and removes it in turn,
   no more need for the `fanout` singleton that multiplexed a single listener never removed. */
export const onOp = bridge.onOp
export const onChanged = bridge.onChanged
export const onTrace = bridge.onTrace
export const onProgress = bridge.onProgress
export const onQueue = bridge.onQueue
export const onUpdate = bridge.onUpdate

/* Opens the repos of restored tabs. Called once, explicitly, from main.tsx —
   rather than an import-time side effect (the old `bootState`, evaluated as soon as this module
   was imported, including by a test that had no use for it). `app:state` stays idempotent on the
   main side: a second call wouldn't reopen anything, it would just reflect the current registry. */
export const boot = () => bridge.state()

/* Repo-scoped bridge methods: everything whose first argument is the repo id. One runtime
   list, from which BOTH the `RepoApi` type and the factory derive — the interface used to be
   a third hand-typed restatement of the contract, free to drift on a return type without a
   compile error (architecture audit, §I.6). Now a signature change in `InvokeChannels`
   (shared/ipc-contract.ts) flows through `Bridge` straight into `RepoApi`; per-channel
   documentation lives on the contract, its single home. */
const REPO_METHODS = [
  "log",
  "total",
  "search",
  "refs",
  "flow",
  "flowInfo",
  "flowInit",
  "flowStart",
  "flowPublish",
  "flowFinish",
  "branch",
  "merge",
  "mergePreview",
  "branchDelete",
  "remoteBranchDelete",
  "tagDelete",
  "branchCreate",
  "tagCreate",
  "reset",
  "revert",
  "cherryPick",
  "files",
  "fileLog",
  "restore",
  "body",
  "diff",
  "blob",
  "status",
  "op",
  "worktree",
  "wtdiff",
  "stage",
  "unstage",
  "applyPatch",
  "discard",
  "discardPatch",
  "commit",
  "reword",
  "headMessage",
  "checkout",
  "stashes",
  "stash",
  "worktrees",
  "worktreeAct",
  "worktreeAdd",
  "worktreeAddFrom",
  "worktreeOpen",
  "worktreeReveal",
  "mergeState",
  "conflict",
  "resolve",
  "mergeAbort",
  "countObjects",
  "fsck",
  "gc",
  "consoleRun",
  "fileIcon",
  "openFile",
  "cancel",
] as const satisfies readonly (keyof Bridge)[]

type RepoMethod = (typeof REPO_METHODS)[number]
/* a listed method that doesn't take the id first degrades to `never` here, so its call
   sites — not the factory — fail to compile */
type DropId<F> = F extends (id: number, ...rest: infer A) => infer R ? (...args: A) => R : never

export type RepoApi = { [K in RepoMethod]: DropId<Bridge[K]> }

export const repoApi = (id: number): RepoApi =>
  Object.fromEntries(
    REPO_METHODS.map((k) => [k, (...args: unknown[]) => (bridge[k] as (...a: unknown[]) => unknown)(id, ...args)])
  ) as RepoApi

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length

/** display name of a linked worktree: its folder name */
export const worktreeName = (w: WorktreeInfo) => w.path.split(/[\\/]/).pop() || w.path
