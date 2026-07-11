/* Typed client for the bridge exposed by the preload. Domain types live in shared/ —
   this module re-exports them so renderer imports don't all have to move — and the
   bridge's shape (Bridge) is derived from the shared IPC contract (src/shared/ipc-contract.ts),
   compiled identically on the main and preload sides. */

export type {
  BootState, BranchAct, ChangeEvent, Commit, CommitMessage, FileChange, FlowInfo, FlowPrefixes,
  GitRef, OpEvent, OpName, OpenResult, Repo, RepoRef, Stash, StashAct, Status, TraceLine, Worktree,
  WtSource,
} from "../../../shared/types.ts"

import type { Bridge } from "../../../shared/ipc-contract.ts"
import type {
  BranchAct, Commit, CommitMessage, FileChange, FlowInfo, FlowPrefixes, GitRef, OpName, Stash,
  StashAct, Status, Worktree, WtSource,
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
}

/* The preload now handles unsubscription itself (`ipcRenderer.off`, see src/preload):
   each call to onOp/onChanged/onTrace sets its own IPC listener and removes it in turn,
   no more need for the `fanout` singleton that multiplexed a single listener never removed. */
export const onOp = bridge.onOp
export const onChanged = bridge.onChanged
export const onTrace = bridge.onTrace

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
  /** merge into HEAD, deletion, pull/push of a given branch, or `git flow <type> finish` */
  branch(action: BranchAct, name: string): Promise<void>
  files(hash: string, parent: string | null, requestId?: string): Promise<FileChange[]>
  /** message body (`%b`), trailers included */
  body(hash: string, requestId?: string): Promise<string>
  diff(hash: string, parent: string | null, path: string, oldPath: string | null, requestId?: string): Promise<string>
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
  branch: (action, name) => bridge.branch(id, action, name),
  files: (hash, parent, requestId) => bridge.files(id, hash, parent, requestId),
  body: (hash, requestId) => bridge.body(id, hash, requestId),
  diff: (hash, parent, path, oldPath, requestId) => bridge.diff(id, hash, parent, path, oldPath, requestId),
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
  fileIcon: (path) => bridge.fileIcon(id, path),
  openFile: (path) => bridge.openFile(id, path),
  cancel: (requestId) => bridge.cancel(id, requestId),
})

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length
