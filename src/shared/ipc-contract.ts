/* The shared IPC contract: ONE typed map per channel, rather than three manual copies
   kept in sync by hand (main, preload, renderer mirror — cf. AUDIT.md §3). Main and
   preload compile against the same signatures; a renamed channel or an added
   argument breaks at compile time across all three processes, not just at runtime.

   The "main" workstream (AUDIT.md §4): `repo:cancel` is the new cancellation channel — the
   renderer generates a `requestId` (a plain string, since a real AbortSignal wouldn't survive
   IPC's structured clone) and passes it as the last optional argument to reads long enough to
   be worth cancelling; main kills the associated process. Every fallible channel now throws a
   structured error (`shared/errors.ts`) instead of a pre-formatted French string — same
   payload, message reconstructed on the renderer side. */

import type {
  BootState,
  BranchAct,
  ChangeEvent,
  Commit,
  CommitMessage,
  FileChange,
  FlowInfo,
  ConflictFile,
  FlowPrefixes,
  GitRef,
  MergeState,
  OpEvent,
  OpName,
  OpenResult,
  Repo,
  RepoRef,
  Stash,
  StashAct,
  Status,
  TraceLine,
  Worktree,
  WtSource,
} from "./types"

/** One channel per `invoke`/`handle` entry: the full signature, arguments included. */
export type InvokeChannels = {
  "app:state": () => Promise<BootState>
  "app:repos": () => Promise<{ root: string | null; recents: RepoRef[] }>
  "app:tabs": (paths: string[], active: string | null) => Promise<void>
  "repo:openDialog": () => Promise<OpenResult>
  "repo:openPath": (path: string) => Promise<Exclude<OpenResult, null>>
  "repo:close": (id: number) => Promise<void>
  "root:choose": () => Promise<string | null>
  "root:scan": () => Promise<RepoRef[]>

  /* Creation page (the "+" in the tab strip). The renderer never supplies an arbitrary
     destination: `create:chooseDir` shows the system picker and main remembers the choice —
     same confinement model as `openable` (cf. main/state.ts, main/create.ts). */
  "create:chooseDir": () => Promise<string | null>
  /** `git init` in a new `dir/name` folder, opened as a tab right away. */
  "create:init": (dir: string, name: string) => Promise<Repo>
  /** `git init --bare` in `dir/name(.git)` — a remote-style repo, no working tree to open;
      resolves to the created path, for the confirmation message. */
  "create:bare": (dir: string, name: string) => Promise<string>
  /** `git clone url` into a new `dir/name` folder, opened as a tab right away. */
  "create:clone": (dir: string, url: string, name: string) => Promise<Repo>

  "repo:op": (id: number, name: OpName) => Promise<void>
  "repo:status": (id: number) => Promise<Status>
  "repo:fileIcon": (id: number, path: string) => Promise<string | null>
  "repo:openFile": (id: number, path: string) => Promise<string>
  "repo:worktree": (id: number) => Promise<Worktree>
  "repo:wtdiff": (id: number, path: string, source: WtSource) => Promise<string>
  "repo:stage": (id: number, paths: string[]) => Promise<void>
  "repo:unstage": (id: number, paths: string[]) => Promise<void>
  "repo:commit": (id: number, message: string, amend: boolean) => Promise<void>
  "repo:flow": (id: number) => Promise<FlowPrefixes | null>
  "repo:flowInfo": (id: number, branch: string, kind: keyof FlowPrefixes) => Promise<FlowInfo | null>
  "repo:branch": (id: number, action: BranchAct, name: string) => Promise<void>
  "repo:log": (id: number, skip: number, count: number, requestId?: string) => Promise<Commit[]>
  "repo:refs": (id: number) => Promise<GitRef[]>
  "repo:files": (id: number, hash: string, parent: string | null, requestId?: string) => Promise<FileChange[]>
  "repo:body": (id: number, hash: string, requestId?: string) => Promise<string>
  "repo:headMessage": (id: number) => Promise<CommitMessage>
  "repo:diff": (
    id: number,
    hash: string,
    parent: string | null,
    path: string,
    oldPath: string | null,
    requestId?: string
  ) => Promise<string>
  "repo:search": (id: number, q: string, content: boolean, requestId?: string) => Promise<string[]>
  "repo:total": (id: number) => Promise<number>
  "repo:checkout": (id: number, name: string) => Promise<void>
  "repo:stashes": (id: number) => Promise<Stash[]>
  "repo:stash": (id: number, action: StashAct, arg?: string) => Promise<void>
  "repo:mergeState": (id: number) => Promise<MergeState>
  "repo:conflict": (id: number, path: string) => Promise<ConflictFile>
  /** Writes `content` to the working file and stages it (`git add`): the conflict is resolved. */
  "repo:resolve": (id: number, path: string, content: string) => Promise<void>
  "repo:mergeAbort": (id: number) => Promise<void>
  /** Kills the git process associated with `requestId` for this repo, if it's still running
      (AUDIT.md §2 B4). Silent no-op if the request has already finished or doesn't exist. */
  "repo:cancel": (id: number, requestId: string) => Promise<void>
}

/** `invoke`/`handle` channel name — derived from the contract, never redeclared by hand. */
export type InvokeChannel = keyof InvokeChannels

/** One channel per event pushed by main (`webContents.send` / `ipcRenderer.on`). */
export type EventChannels = {
  "git:op": OpEvent
  "git:changed": ChangeEvent
  "git:trace": TraceLine
}

export type EventChannel = keyof EventChannels

/** What the preload exposes as `window.amont`. Method names differ from channel
    names (`state` ↔ `app:state`, `log` ↔ `repo:log`…): they stay the ones the renderer
    already consumes, this table is the sole correspondence between the two worlds. The
    `on*` subscriptions return an unsubscribe (`ipcRenderer.off` on the preload side) — a real
    one per consumer, instead of the `fanout` singleton the old API without unsubscribe used to force. */
export type Bridge = {
  state: InvokeChannels["app:state"]
  repos: InvokeChannels["app:repos"]
  setTabs: InvokeChannels["app:tabs"]
  openDialog: InvokeChannels["repo:openDialog"]
  openPath: InvokeChannels["repo:openPath"]
  close: InvokeChannels["repo:close"]
  chooseRoot: InvokeChannels["root:choose"]
  scanRoot: InvokeChannels["root:scan"]
  chooseCreateDir: InvokeChannels["create:chooseDir"]
  initRepo: InvokeChannels["create:init"]
  initBare: InvokeChannels["create:bare"]
  cloneRepo: InvokeChannels["create:clone"]

  onOp(cb: (payload: EventChannels["git:op"]) => void): () => void
  onChanged(cb: (payload: EventChannels["git:changed"]) => void): () => void
  onTrace(cb: (payload: EventChannels["git:trace"]) => void): () => void

  log: InvokeChannels["repo:log"]
  total: InvokeChannels["repo:total"]
  search: InvokeChannels["repo:search"]
  refs: InvokeChannels["repo:refs"]
  flow: InvokeChannels["repo:flow"]
  flowInfo: InvokeChannels["repo:flowInfo"]
  branch: InvokeChannels["repo:branch"]
  files: InvokeChannels["repo:files"]
  body: InvokeChannels["repo:body"]
  headMessage: InvokeChannels["repo:headMessage"]
  diff: InvokeChannels["repo:diff"]
  status: InvokeChannels["repo:status"]
  op: InvokeChannels["repo:op"]
  worktree: InvokeChannels["repo:worktree"]
  wtdiff: InvokeChannels["repo:wtdiff"]
  stage: InvokeChannels["repo:stage"]
  unstage: InvokeChannels["repo:unstage"]
  commit: InvokeChannels["repo:commit"]
  checkout: InvokeChannels["repo:checkout"]
  stashes: InvokeChannels["repo:stashes"]
  stash: InvokeChannels["repo:stash"]
  mergeState: InvokeChannels["repo:mergeState"]
  conflict: InvokeChannels["repo:conflict"]
  resolve: InvokeChannels["repo:resolve"]
  mergeAbort: InvokeChannels["repo:mergeAbort"]
  fileIcon: InvokeChannels["repo:fileIcon"]
  openFile: InvokeChannels["repo:openFile"]
  cancel: InvokeChannels["repo:cancel"]
}
