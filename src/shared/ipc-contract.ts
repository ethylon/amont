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
  BlobData,
  BlobRef,
  BootState,
  BranchAct,
  ChangeEvent,
  Commit,
  CommitMessage,
  CountObjects,
  FileChange,
  FlowInfo,
  FlowInitConfig,
  FlowKind,
  ConflictFile,
  DiffText,
  FlowPrefixes,
  GitRef,
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
  UpdateStatus,
  Worktree,
  WorktreeAct,
  WorktreeInfo,
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

  /* Crash reporting (cf. main/telemetry.ts). `available` is false unless a DSN was baked in —
     the home screen only shows the opt-out toggle then. */
  "telemetry:state": () => Promise<{ available: boolean; enabled: boolean }>
  "telemetry:set": (enabled: boolean) => Promise<void>

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
  /** Diff text, truncated main-side a slack past DIFF_MAX_LINES (shared/diff.ts) — same
      shape and reason as `repo:diff` below. */
  "repo:wtdiff": (id: number, path: string, source: WtSource) => Promise<DiffText>
  "repo:stage": (id: number, paths: string[]) => Promise<void>
  "repo:unstage": (id: number, paths: string[]) => Promise<void>
  /** Partial staging: applies a sub-patch to the index alone (`git apply --cached`);
      `reverse` unstages. The patch is built renderer-side (diff-parse.ts). */
  "repo:applyPatch": (id: number, patch: string, reverse: boolean) => Promise<void>
  /** Discards working-tree changes: tracked paths restored from the index (`git restore`),
      untracked paths deleted (`git clean -f`). Irreversible — the renderer confirms first. */
  "repo:discard": (id: number, paths: string[], untracked: string[]) => Promise<void>
  /** Partial discard (hunk or lines): reverse-applies a sub-patch to the working tree alone
      (`git apply --reverse`); the index never moves. Built renderer-side like applyPatch's. */
  "repo:discardPatch": (id: number, patch: string) => Promise<void>
  "repo:commit": (id: number, message: string, amend: boolean) => Promise<void>
  "repo:flow": (id: number) => Promise<FlowPrefixes | null>
  "repo:flowInfo": (id: number, branch: string, kind: keyof FlowPrefixes) => Promise<FlowInfo | null>
  /** Write the `gitflow.*` config from the form then `git flow init -d`; resolves the prefixes. */
  "flow:init": (id: number, cfg: FlowInitConfig) => Promise<FlowPrefixes | null>
  /** `git flow <kind> start <name|version> [<base>]` — `base` is the start point to branch off
      (a local branch); omitted, git-flow uses its own default trunk (develop, master for hotfix). */
  "flow:start": (id: number, kind: FlowKind, name: string, base?: string) => Promise<void>
  /** `git flow <kind> publish <name>`. */
  "flow:publish": (id: number, kind: FlowKind, name: string) => Promise<void>
  "repo:branch": (id: number, action: BranchAct, name: string) => Promise<void>
  /** `git branch -d <name>`, then — when `deleteRemote` — `git push <remote> --delete` of its
      upstream. Split from `repo:branch`: the renderer confirms it and passes the remote choice. */
  "repo:branchDelete": (id: number, name: string, deleteRemote: boolean) => Promise<void>
  "repo:log": (id: number, skip: number, count: number, requestId?: string) => Promise<Commit[]>
  "repo:refs": (id: number) => Promise<GitRef[]>
  "repo:files": (id: number, hash: string, parent: string | null, requestId?: string) => Promise<FileChange[]>
  "repo:body": (id: number, hash: string, requestId?: string) => Promise<string>
  "repo:headMessage": (id: number) => Promise<CommitMessage>
  /** Diff text, truncated main-side a slack past DIFF_MAX_LINES (shared/diff.ts): the
      renderer never renders more than the cap, so the payload stops shipping up to the 64 MB
      output cap across IPC — `totalLines` keeps its "N more lines" footer exact. */
  "repo:diff": (
    id: number,
    hash: string,
    parent: string | null,
    path: string,
    oldPath: string | null,
    requestId?: string
  ) => Promise<DiffText>
  /** Raw bytes of one side of a binary preview (image viewer, cf. features/diff): a
      Uint8Array crosses IPC as binary under structured clone — no base64 detour — and the
      renderer shows it through a `blob:` object URL. `null` when the path is absent on
      that side. */
  "repo:blob": (id: number, path: string, ref: BlobRef) => Promise<BlobData | null>
  "repo:search": (id: number, q: string, content: boolean, requestId?: string) => Promise<string[]>
  "repo:total": (id: number) => Promise<number>
  "repo:checkout": (id: number, name: string) => Promise<void>
  "repo:stashes": (id: number) => Promise<Stash[]>
  "repo:stash": (id: number, action: StashAct, arg?: string) => Promise<void>
  /* Linked worktrees (`git worktree`). `worktreeOpen` only accepts a path listed by
     `git worktree list` for this repo — never an arbitrary path, same confinement model
     as `openable` (cf. main/state.ts). */
  "repo:worktrees": (id: number) => Promise<WorktreeInfo[]>
  /** `remove` targets a listed worktree path; `prune` sweeps the stale administrative entries. */
  "repo:worktreeAct": (id: number, action: WorktreeAct, path?: string) => Promise<void>
  /** system picker for the destination folder then `git worktree add <dir> <branch>`;
      `null` when the dialog is cancelled — the created worktree is opened as a tab right away. */
  "repo:worktreeAdd": (id: number, branch: string) => Promise<OpenResult>
  /** opens a listed worktree as a new tab (same `Repo` result as `repo:openPath`). */
  "repo:worktreeOpen": (id: number, path: string) => Promise<Repo>
  /** reveals a listed worktree in the system file explorer. */
  "repo:worktreeReveal": (id: number, path: string) => Promise<void>
  "repo:mergeState": (id: number) => Promise<MergeState>
  "repo:conflict": (id: number, path: string) => Promise<ConflictFile>
  /** Writes `content` to the working file and stages it (`git add`): the conflict is resolved. */
  "repo:resolve": (id: number, path: string, content: string) => Promise<void>
  "repo:mergeAbort": (id: number) => Promise<void>
  /** Database maintenance (Repository menu). `countObjects` reads the DB shape; `fsck`/`gc` run
      long and stream progress via the `git:progress` event. */
  "repo:countObjects": (id: number) => Promise<CountObjects>
  "repo:fsck": (id: number) => Promise<void>
  "repo:gc": (id: number) => Promise<void>
  /** Kills the git process associated with `requestId` for this repo, if it's still running
      (AUDIT.md §2 B4). Silent no-op if the request has already finished or doesn't exist. */
  "repo:cancel": (id: number, requestId: string) => Promise<void>

  /* Auto-update (main/updater.ts). Le retour passe par l'événement `update:status`, pas par
     ces promesses : le téléchargement est long, l'invoke ne fait que déclencher. */
  /** Check manuel (Help ▸ Check for updates) ; pousse `update:status` avec origin "manual". */
  "update:check": () => Promise<void>
  /** Quitte et installe la mise à jour téléchargée (`quitAndInstall`). */
  "update:install": () => Promise<void>
}

/** `invoke`/`handle` channel name — derived from the contract, never redeclared by hand. */
export type InvokeChannel = keyof InvokeChannels

/** One channel per event pushed by main (`webContents.send` / `ipcRenderer.on`). */
export type EventChannels = {
  "git:op": OpEvent
  "git:changed": ChangeEvent
  "git:trace": TraceLine
  "git:progress": ProgressEvent
  "update:status": UpdateStatus
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
  telemetryState: InvokeChannels["telemetry:state"]
  setTelemetry: InvokeChannels["telemetry:set"]
  chooseCreateDir: InvokeChannels["create:chooseDir"]
  initRepo: InvokeChannels["create:init"]
  initBare: InvokeChannels["create:bare"]
  cloneRepo: InvokeChannels["create:clone"]

  checkForUpdates: InvokeChannels["update:check"]
  installUpdate: InvokeChannels["update:install"]

  onOp(cb: (payload: EventChannels["git:op"]) => void): () => void
  onChanged(cb: (payload: EventChannels["git:changed"]) => void): () => void
  onTrace(cb: (payload: EventChannels["git:trace"]) => void): () => void
  onProgress(cb: (payload: EventChannels["git:progress"]) => void): () => void
  onUpdate(cb: (payload: EventChannels["update:status"]) => void): () => void

  log: InvokeChannels["repo:log"]
  total: InvokeChannels["repo:total"]
  search: InvokeChannels["repo:search"]
  refs: InvokeChannels["repo:refs"]
  flow: InvokeChannels["repo:flow"]
  flowInfo: InvokeChannels["repo:flowInfo"]
  flowInit: InvokeChannels["flow:init"]
  flowStart: InvokeChannels["flow:start"]
  flowPublish: InvokeChannels["flow:publish"]
  branch: InvokeChannels["repo:branch"]
  branchDelete: InvokeChannels["repo:branchDelete"]
  files: InvokeChannels["repo:files"]
  body: InvokeChannels["repo:body"]
  headMessage: InvokeChannels["repo:headMessage"]
  diff: InvokeChannels["repo:diff"]
  blob: InvokeChannels["repo:blob"]
  status: InvokeChannels["repo:status"]
  op: InvokeChannels["repo:op"]
  worktree: InvokeChannels["repo:worktree"]
  wtdiff: InvokeChannels["repo:wtdiff"]
  stage: InvokeChannels["repo:stage"]
  unstage: InvokeChannels["repo:unstage"]
  applyPatch: InvokeChannels["repo:applyPatch"]
  discard: InvokeChannels["repo:discard"]
  discardPatch: InvokeChannels["repo:discardPatch"]
  commit: InvokeChannels["repo:commit"]
  checkout: InvokeChannels["repo:checkout"]
  stashes: InvokeChannels["repo:stashes"]
  stash: InvokeChannels["repo:stash"]
  worktrees: InvokeChannels["repo:worktrees"]
  worktreeAct: InvokeChannels["repo:worktreeAct"]
  worktreeAdd: InvokeChannels["repo:worktreeAdd"]
  worktreeOpen: InvokeChannels["repo:worktreeOpen"]
  worktreeReveal: InvokeChannels["repo:worktreeReveal"]
  mergeState: InvokeChannels["repo:mergeState"]
  conflict: InvokeChannels["repo:conflict"]
  resolve: InvokeChannels["repo:resolve"]
  mergeAbort: InvokeChannels["repo:mergeAbort"]
  countObjects: InvokeChannels["repo:countObjects"]
  fsck: InvokeChannels["repo:fsck"]
  gc: InvokeChannels["repo:gc"]
  fileIcon: InvokeChannels["repo:fileIcon"]
  openFile: InvokeChannels["repo:openFile"]
  cancel: InvokeChannels["repo:cancel"]
}
