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
import type {
  BlobData,
  BlobRef,
  BranchAct,
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
  MergePreview,
  MergeState,
  OpName,
  OpVariant,
  ResetMode,
  Stash,
  StashAct,
  Repo,
  Status,
  Worktree,
  WorktreeAct,
  WorktreeInfo,
  WtSource,
} from "../../../shared/types.ts"

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

export type RepoApi = {
  log(skip: number, count: number): Promise<Commit[]>
  total(): Promise<number>
  /** short hashes of matching commits, all criteria combined; `content` searches the diffs too.
      `requestId`: see `cancel` — the query layer (lib/queries.ts) wires the AbortSignal to it. */
  search(q: string, content: boolean, requestId?: string): Promise<string[]>
  refs(): Promise<GitRef[]>
  /** `null`: the repo has never seen `git flow init` */
  flow(): Promise<FlowPrefixes | null>
  /** context of the current flow branch; `null` if the reference trunk is missing */
  flowInfo(branch: string, kind: keyof FlowPrefixes): Promise<FlowInfo | null>
  /** write the `gitflow.*` config from the form then `git flow init -d`; resolves the prefixes */
  flowInit(cfg: FlowInitConfig): Promise<FlowPrefixes | null>
  /** `git flow <kind> start <name|version> [<base>]` — `base`: start point, default trunk when omitted */
  flowStart(kind: FlowKind, name: string, base?: string): Promise<void>
  /** `git flow <kind> publish <name>` */
  flowPublish(kind: FlowKind, name: string): Promise<void>
  /** feature/bugfix finish with the banner's options — merge `--no-ff` or rebase + fast-forward,
      branch deleted or kept. Full branch name, like `branch` */
  flowFinish(name: string, opts: FlowFinishOpts): Promise<void>
  /** merge into HEAD, pull/push of a given branch, or `git flow <type> finish` */
  branch(action: BranchAct, name: string): Promise<void>
  /** `git merge [--no-ff] <name>` into HEAD — a conflict rejects with MERGE_CONFLICT and
      leaves the merge state for the conflict view */
  merge(name: string, noFF: boolean): Promise<void>
  /** dry-run of merging `branches` (in order) into `base` — the worktree never moves */
  mergePreview(base: string, branches: string[]): Promise<MergePreview[]>
  /** `git branch -D <name>`, plus the `push --delete` of its upstream when `deleteRemote` */
  branchDelete(name: string, deleteRemote: boolean): Promise<void>
  /** `git push <remote> --delete <branch>` of a remote-tracking ref ("origin/topic") */
  remoteBranchDelete(name: string): Promise<void>
  /** `git tag -d <name>`, plus `git push <remote> --delete refs/tags/<name>` when `remote` */
  tagDelete(name: string, remote: string | null): Promise<void>
  /** `git branch <name> <from>` (a commit hash), then a stash-guarded checkout when `checkout` */
  branchCreate(name: string, from: string, checkout: boolean): Promise<void>
  /** lightweight tag on the given commit */
  tagCreate(name: string, at: string): Promise<void>
  /** `git reset --<mode> <to>` of the current branch */
  reset(mode: ResetMode, to: string): Promise<void>
  /** `git revert --no-edit <hash>` (with `-m 1` for a merge commit) */
  revert(hash: string): Promise<void>
  /** `git cherry-pick <hash>` onto HEAD (with `-m 1` for a merge commit) */
  cherryPick(hash: string): Promise<void>
  files(hash: string, parent: string | null, requestId?: string): Promise<FileChange[]>
  /** history of one file: the commits that touched `path`, walked from `from` with
      `--follow` — each entry carries the file's status and path at that commit */
  fileLog(from: string, path: string, requestId?: string): Promise<FileLogEntry[]>
  /** overwrites the working file with its content at `hash` (`git restore --source`);
      the index never moves — the renderer confirms first, like discard */
  restore(hash: string, path: string): Promise<void>
  /** message body (`%b`), trailers included */
  body(hash: string, requestId?: string): Promise<string>
  /** diff text, truncated main-side past DIFF_MAX_LINES (shared/diff.ts) — `totalLines`
      carries the exact length of the full output for the truncation footer */
  diff(hash: string, parent: string | null, path: string, oldPath: string | null, requestId?: string): Promise<DiffText>
  /** raw bytes of one side of a binary path (image preview); `null` if absent on that side */
  blob(path: string, ref: BlobRef): Promise<BlobData | null>
  status(): Promise<Status>
  /** `variant`: the remote-ahead banner's one-shot override (`push --force-with-lease`,
      `pull --ff`) — plain ops never pass one */
  op(name: OpName, variant?: OpVariant): Promise<void>
  worktree(): Promise<Worktree>
  wtdiff(path: string, source: WtSource): Promise<DiffText>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** partial staging: sub-patch applied to the index alone; `reverse` unstages */
  applyPatch(patch: string, reverse: boolean): Promise<void>
  /** discards working-tree changes: tracked paths restored from the index, untracked deleted */
  discard(paths: string[], untracked: string[]): Promise<void>
  /** partial discard: sub-patch reverse-applied to the working tree alone */
  discardPatch(patch: string): Promise<void>
  /** `amend` rewrites the last commit (message, and staged tree if any) instead of creating a new one */
  commit(message: string, amend: boolean): Promise<void>
  /** rewrites HEAD's message alone (`--amend --only`): the staged tree stays out of the amend */
  reword(message: string): Promise<void>
  /** subject and body of the last commit, to prefill an amend */
  headMessage(): Promise<CommitMessage>
  /** switches to a local branch; the dirty tree is stashed then reapplied */
  checkout(name: string): Promise<void>
  /** entries of `git stash list`, most recent first */
  stashes(): Promise<Stash[]>
  /** `push` stashes the tree (optional message); the others target a `stash@{N}` name */
  stash(action: StashAct, arg?: string): Promise<void>
  /** entries of `git worktree list`, main worktree first */
  worktrees(): Promise<WorktreeInfo[]>
  /** `remove` targets a listed worktree path; `prune` sweeps the stale entries */
  worktreeAct(action: WorktreeAct, path?: string): Promise<void>
  /** destination picker then `git worktree add`; `null` when the dialog is cancelled */
  worktreeAdd(branch: string): Promise<Repo | null>
  /** destination picker then `git worktree add -b <branch> <dir> <from>` — worktree anchored
      on a commit, with a fresh branch created there; `null` when the dialog is cancelled */
  worktreeAddFrom(branch: string, from: string): Promise<Repo | null>
  /** opens a listed worktree as a repo — the caller surfaces it as a tab */
  worktreeOpen(path: string): Promise<Repo>
  worktreeReveal(path: string): Promise<void>
  /** the conflict-capable operation in progress (merge/rebase/cherry-pick/revert) and the
      A/B labels of the conflict view: current branch (ours) and incoming side (theirs) */
  mergeState(): Promise<MergeState>
  /** the three index stages + working file of a conflicted path */
  conflict(path: string): Promise<ConflictFile>
  /** writes the merged output to the working file and stages it — the conflict is resolved */
  resolve(path: string, content: string): Promise<void>
  /** aborts whatever conflict-capable operation is in progress — main re-detects it from
      the on-disk state, so this is always `git <current op> --abort` */
  mergeAbort(): Promise<void>
  /** object-DB shape (`git count-objects -vH`) — the maintenance modal's report */
  countObjects(): Promise<CountObjects>
  /** `git fsck --full`; progress streamed via `onProgress` */
  fsck(): Promise<void>
  /** `git gc`; no progress without a TTY — footer shows an indeterminate spinner */
  gc(): Promise<void>
  /** one command typed in the console popup — parsed and policed main-side (git/console.ts),
      output streamed back on the trace event like every other command */
  consoleRun(command: string): Promise<void>
  /** Windows icon of the file, `null` if it doesn't exist on disk */
  fileIcon(path: string): Promise<string | null>
  openFile(path: string): Promise<string>
  /** kills the process associated with `requestId`, if it's still running (see main-side work, AUDIT.md §4) */
  cancel(requestId: string): Promise<void>
}

export const repoApi = (id: number): RepoApi => ({
  log: (skip, count) => bridge.log(id, skip, count),
  total: () => bridge.total(id),
  search: (q, content, requestId) => bridge.search(id, q, content, requestId),
  refs: () => bridge.refs(id),
  flow: () => bridge.flow(id),
  flowInfo: (branch, kind) => bridge.flowInfo(id, branch, kind),
  flowInit: (cfg) => bridge.flowInit(id, cfg),
  flowStart: (kind, name, base) => bridge.flowStart(id, kind, name, base),
  flowPublish: (kind, name) => bridge.flowPublish(id, kind, name),
  flowFinish: (name, opts) => bridge.flowFinish(id, name, opts),
  branch: (action, name) => bridge.branch(id, action, name),
  merge: (name, noFF) => bridge.merge(id, name, noFF),
  mergePreview: (base, branches) => bridge.mergePreview(id, base, branches),
  branchDelete: (name, deleteRemote) => bridge.branchDelete(id, name, deleteRemote),
  remoteBranchDelete: (name) => bridge.remoteBranchDelete(id, name),
  tagDelete: (name, remote) => bridge.tagDelete(id, name, remote),
  branchCreate: (name, from, checkout) => bridge.branchCreate(id, name, from, checkout),
  tagCreate: (name, at) => bridge.tagCreate(id, name, at),
  reset: (mode, to) => bridge.reset(id, mode, to),
  revert: (hash) => bridge.revert(id, hash),
  cherryPick: (hash) => bridge.cherryPick(id, hash),
  files: (hash, parent, requestId) => bridge.files(id, hash, parent, requestId),
  fileLog: (from, path, requestId) => bridge.fileLog(id, from, path, requestId),
  restore: (hash, path) => bridge.restore(id, hash, path),
  body: (hash, requestId) => bridge.body(id, hash, requestId),
  diff: (hash, parent, path, oldPath, requestId) => bridge.diff(id, hash, parent, path, oldPath, requestId),
  blob: (path, ref) => bridge.blob(id, path, ref),
  status: () => bridge.status(id),
  op: (name, variant) => bridge.op(id, name, variant),
  worktree: () => bridge.worktree(id),
  wtdiff: (path, source) => bridge.wtdiff(id, path, source),
  stage: (paths) => bridge.stage(id, paths),
  unstage: (paths) => bridge.unstage(id, paths),
  applyPatch: (patch, reverse) => bridge.applyPatch(id, patch, reverse),
  discard: (paths, untracked) => bridge.discard(id, paths, untracked),
  discardPatch: (patch) => bridge.discardPatch(id, patch),
  commit: (message, amend) => bridge.commit(id, message, amend),
  reword: (message) => bridge.reword(id, message),
  headMessage: () => bridge.headMessage(id),
  checkout: (name) => bridge.checkout(id, name),
  stashes: () => bridge.stashes(id),
  stash: (action, arg) => bridge.stash(id, action, arg),
  worktrees: () => bridge.worktrees(id),
  worktreeAct: (action, path) => bridge.worktreeAct(id, action, path),
  worktreeAdd: (branch) => bridge.worktreeAdd(id, branch),
  worktreeAddFrom: (branch, from) => bridge.worktreeAddFrom(id, branch, from),
  worktreeOpen: (path) => bridge.worktreeOpen(id, path),
  worktreeReveal: (path) => bridge.worktreeReveal(id, path),
  mergeState: () => bridge.mergeState(id),
  conflict: (path) => bridge.conflict(id, path),
  resolve: (path, content) => bridge.resolve(id, path, content),
  mergeAbort: () => bridge.mergeAbort(id),
  countObjects: () => bridge.countObjects(id),
  fsck: () => bridge.fsck(id),
  gc: () => bridge.gc(id),
  consoleRun: (command) => bridge.consoleRun(id, command),
  fileIcon: (path) => bridge.fileIcon(id, path),
  openFile: (path) => bridge.openFile(id, path),
  cancel: (requestId) => bridge.cancel(id, requestId),
})

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length

/** display name of a linked worktree: its folder name */
export const worktreeName = (w: WorktreeInfo) => w.path.split(/[\\/]/).pop() || w.path
