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
  FileChange,
  FlowInfo,
  FlowInitConfig,
  FlowKind,
  FlowPrefixes,
  GitRef,
  MaintKind,
  MergeState,
  OpEvent,
  OpName,
  OpenResult,
  ProgressEvent,
  Repo,
  RepoRef,
  Stash,
  StashAct,
  Status,
  TraceLine,
  Worktree,
  WtSource,
} from "../../../shared/types.ts"

import type { Bridge } from "../../../shared/ipc-contract.ts"
import type {
  BlobData,
  BlobRef,
  BranchAct,
  Commit,
  CommitMessage,
  ConflictFile,
  CountObjects,
  FileChange,
  FlowInfo,
  FlowInitConfig,
  FlowKind,
  FlowPrefixes,
  GitRef,
  MergeState,
  OpName,
  Stash,
  StashAct,
  Status,
  Worktree,
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
  chooseCreateDir: bridge.chooseCreateDir,
  initRepo: bridge.initRepo,
  initBare: bridge.initBare,
  cloneRepo: bridge.cloneRepo,
}

/* The preload now handles unsubscription itself (`ipcRenderer.off`, see src/preload):
   each call to onOp/onChanged/onTrace sets its own IPC listener and removes it in turn,
   no more need for the `fanout` singleton that multiplexed a single listener never removed. */
export const onOp = bridge.onOp
export const onChanged = bridge.onChanged
export const onTrace = bridge.onTrace
export const onProgress = bridge.onProgress

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
  /** `git flow <kind> start <name|version>` */
  flowStart(kind: FlowKind, name: string): Promise<void>
  /** `git flow <kind> publish <name>` */
  flowPublish(kind: FlowKind, name: string): Promise<void>
  /** merge into HEAD, deletion, pull/push of a given branch, or `git flow <type> finish` */
  branch(action: BranchAct, name: string): Promise<void>
  files(hash: string, parent: string | null, requestId?: string): Promise<FileChange[]>
  /** message body (`%b`), trailers included */
  body(hash: string, requestId?: string): Promise<string>
  diff(hash: string, parent: string | null, path: string, oldPath: string | null, requestId?: string): Promise<string>
  /** raw bytes of one side of a binary path (image preview); `null` if absent on that side */
  blob(path: string, ref: BlobRef): Promise<BlobData | null>
  status(): Promise<Status>
  op(name: OpName): Promise<void>
  worktree(): Promise<Worktree>
  wtdiff(path: string, source: WtSource): Promise<string>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** `amend` rewrites the last commit (message, and staged tree if any) instead of creating a new one */
  commit(message: string, amend: boolean): Promise<void>
  /** subject and body of the last commit, to prefill an amend */
  headMessage(): Promise<CommitMessage>
  /** switches to a local branch; the dirty tree is stashed then reapplied */
  checkout(name: string): Promise<void>
  /** entries of `git stash list`, most recent first */
  stashes(): Promise<Stash[]>
  /** `push` stashes the tree (optional message); the others target a `stash@{N}` name */
  stash(action: StashAct, arg?: string): Promise<void>
  /** the A/B labels of the conflict view: current branch (ours) and merged-in branch (theirs) */
  mergeState(): Promise<MergeState>
  /** the three index stages + working file of a conflicted path */
  conflict(path: string): Promise<ConflictFile>
  /** writes the merged output to the working file and stages it — the conflict is resolved */
  resolve(path: string, content: string): Promise<void>
  mergeAbort(): Promise<void>
  /** object-DB shape (`git count-objects -vH`) — the maintenance modal's report */
  countObjects(): Promise<CountObjects>
  /** `git fsck --full`; progress streamed via `onProgress` */
  fsck(): Promise<void>
  /** `git gc`; progress streamed via `onProgress` */
  gc(): Promise<void>
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
  flowStart: (kind, name) => bridge.flowStart(id, kind, name),
  flowPublish: (kind, name) => bridge.flowPublish(id, kind, name),
  branch: (action, name) => bridge.branch(id, action, name),
  files: (hash, parent, requestId) => bridge.files(id, hash, parent, requestId),
  body: (hash, requestId) => bridge.body(id, hash, requestId),
  diff: (hash, parent, path, oldPath, requestId) => bridge.diff(id, hash, parent, path, oldPath, requestId),
  blob: (path, ref) => bridge.blob(id, path, ref),
  status: () => bridge.status(id),
  op: (name) => bridge.op(id, name),
  worktree: () => bridge.worktree(id),
  wtdiff: (path, source) => bridge.wtdiff(id, path, source),
  stage: (paths) => bridge.stage(id, paths),
  unstage: (paths) => bridge.unstage(id, paths),
  commit: (message, amend) => bridge.commit(id, message, amend),
  headMessage: () => bridge.headMessage(id),
  checkout: (name) => bridge.checkout(id, name),
  stashes: () => bridge.stashes(id),
  stash: (action, arg) => bridge.stash(id, action, arg),
  mergeState: () => bridge.mergeState(id),
  conflict: (path) => bridge.conflict(id, path),
  resolve: (path, content) => bridge.resolve(id, path, content),
  mergeAbort: () => bridge.mergeAbort(id),
  countObjects: () => bridge.countObjects(id),
  fsck: () => bridge.fsck(id),
  gc: () => bridge.gc(id),
  fileIcon: (path) => bridge.fileIcon(id, path),
  openFile: (path) => bridge.openFile(id, path),
  cancel: (requestId) => bridge.cancel(id, requestId),
})

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length
