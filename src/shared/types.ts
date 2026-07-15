/* Domain types, shared by the three processes (main, preload, renderer). Moved
   from renderer/lib/git.ts: they describe the shape of the data that crosses the IPC boundary,
   not just what the renderer expects of it — main produces them, preload relays them as-is.
   See ipc-contract.ts for the map of channels that carries them. */

import type { ErrorPayload } from "./errors.ts"

/** `Omit` that distributes over the members of a discriminated union rather than collapsing
    onto their common keys alone (`keyof (A | B)` keeps only the intersection of keys —
    a non-distributed `Omit` would lose the fields specific to each variant here). Useful for
    building the payload of an event (`TraceLine`, `OpEvent`) without its `id`, added at the
    last moment by the emitter that already knows it (cf. main/ipc.ts `makeHooks`). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type Commit = {
  /** Full SHA (40 characters) — fix B1 (AUDIT.md §2): the renderer interns these hashes into
      sequential integer ids at ingestion (cf. renderer/features/graph/ids.ts), 8-character
      truncation becomes a display-only concern again. */
  h: string
  /** parents, full SHAs; the first is the first-parent */
  p: string[]
  d: string
  a: string
  /** author's e-mail, the only avatar key git knows */
  e: string
  /** raw refs from `%D --decorate=full`: "HEAD -> refs/heads/develop, tag: refs/tags/v4.2.0" */
  r: string
  s: string
  /** set by the release/hotfix collapse (cf. renderer/features/graph/layout/collapse.ts): this line merges the two merges
      of a version — the master side (absorbed) and the develop side (surviving). */
  cap?: {
    /** full SHA of the absorbed master merge; still resolved by the capsule in layoutChunk */
    absorbed: string
    /** semver tag of the release, `null` if the pair didn't carry one */
    version: string | null
    /** source branch: "release/1.6.2", "hotfix/1.6.3" */
    from: string
    flow: "release" | "hotfix"
    /** [master target, develop target] */
    targets: [string, string]
  }
  /** set by the stash collapse (cf. renderer/features/graph/layout/collapse.ts): this line is a stash entry,
      its plumbing parents have been removed — only the base parent remains. */
  stash?: {
    /** entry name `stash@{N}`, the handle for apply/pop/drop actions */
    name: string
    /** full SHA of the untracked-files commit (`stash push -u`), `null` without them */
    untracked: string | null
  }
  /** set at ingestion (cf. renderer/features/graph/data/loader.ts): linked worktrees whose HEAD
      sits on this commit — the row shows one openable chip per entry. */
  wt?: WorktreeInfo[]
}

/** An entry from `git stash list`. `p` keeps all parents: base, index, untracked. */
export type Stash = {
  name: string
  /** full SHA of the stash commit, its line in the graph */
  h: string
  p: string[]
  d: string
  a: string
  e: string
  /** reflog subject: "WIP on x: …" or "On x: message" */
  s: string
}

export type StashAct = "push" | "apply" | "pop" | "drop"

/** An entry from `git worktree list --porcelain`, bare entries excluded. Not to be confused
    with `Worktree` (the working-tree file status): this one describes a checkout location. */
export type WorktreeInfo = {
  /** absolute path, normalized to platform separators */
  path: string
  /** full SHA of the checked-out commit, its anchor in the graph */
  head: string
  /** short branch name, `null` when the HEAD is detached */
  branch: string | null
  /** the repository's main worktree (always first in the list) */
  main: boolean
  /** the worktree answering this query — the one already open in this tab */
  current: boolean
  locked: boolean
  /** its directory is gone from disk: only `git worktree prune` can clean it up */
  prunable: boolean
}

export type WorktreeAct = "remove" | "prune"

export type FileChange = {
  /** A, M, D, R, C, ? or a conflict pair (UU, AA…) */
  st: string
  path: string
  old?: string | null
}

/** One side of a binary/image preview (cf. `repo:blob`): which version of a path to read.
    `commit` reads `<rev>:<path>` from the object DB, `index` reads the staged blob (`:path`),
    `worktree` reads the file straight from disk. */
export type BlobRef = { kind: "commit"; rev: string } | { kind: "index" } | { kind: "worktree" }

/** The bytes of one side of an image diff, raw: Electron's structured clone carries a
    Uint8Array as binary, where the old base64 detour re-encoded up to 25 MB into a ~33 MB
    string on the main thread before serializing it (performance audit, finding 9a). `bytes`
    is null when the blob exists but is larger than the preview cap — the renderer then shows
    the size only. The whole result is null when the path is absent on that side (an added
    file has no "before", a deleted file no "after"). */
export type BlobData = { size: number; bytes: Uint8Array | null }

/** Diff text as shipped by `repo:diff`/`repo:wtdiff`: truncated on the main side a small
    slack past DIFF_MAX_LINES (cf. shared/diff.ts) instead of carrying up to the 64 MB output
    cap across IPC. `totalLines` is the exact line count of the full git output
    (`split("\n")` semantics, trailing empty line included): the renderer's render-path gates
    and its "N more lines" footer key off it, never off `text` itself. */
export type DiffText = { text: string; totalLines: number }

/** An open repo. `id` is the only handle accepted by git calls. */
export type Repo = { id: number; path: string; name: string }
/** A known but unopened repo: recent, or found under the root. */
export type RepoRef = { path: string; name: string }
/** `null`: dialog cancelled. An opening failure (not a repo…) now throws a structured
    AppError (fix from the "errors" workstream, AUDIT.md §4) instead of returning `{ error }` —
    same convention as the rest of the contract. */
export type OpenResult = Repo | null

export type BootState = {
  root: string | null
  recents: RepoRef[]
  /** restored tabs, already open on the main side */
  tabs: Repo[]
  active: number | null
}

export type Status = {
  branch: string | null
  head: string | null
  ahead: number | null
  behind: number | null
}

/** A ref from `for-each-ref`. `ahead`/`behind` are only populated for a tracked branch. */
export type GitRef = {
  /** without the `refs/…/` prefix: "feature/x", "origin/master", "v4.2.0" */
  name: string
  kind: "head" | "remote" | "tag"
  head: boolean
  /** tracked remote, short form ("origin/master"); empty if the branch has none */
  upstream: string
  ahead: number
  behind: number
  /** local branch already merged into the integration branch */
  merged: boolean
  /** local branch whose remote counterpart has been deleted */
  gone: boolean
  /** full SHA of the commit pointed to, peeled for an annotated tag: the target of a focus in the graph */
  tip: string
}

/** The prefixes from `git flow init`, or `null` if the repo doesn't use git-flow. */
export type FlowPrefixes = Partial<Record<"feature" | "bugfix" | "release" | "hotfix", string>>

/** Read-only context of the current flow branch: cockpit and context card. */
export type FlowInfo = {
  /** commits specific to the branch, absent from its base */
  commits: number
  /** epoch (s) of the first specific commit, `null` as long as the branch has nothing */
  startedAt: number | null
  /** displayable starting point: last tag (release/hotfix) or trunk (feature/bugfix) */
  base: string | null
  /** branches where the finish will land */
  targets: string[]
  /** tag that the finish will create — version from the branch name, otherwise a bump of the last tag */
  nextTag: string | null
  /** the branch has no remote-tracking branch yet: `git flow <kind> publish` is still available */
  unpushed: boolean
}

/** Deletion is not here: it needs its own argument (delete the remote too) and its own
    confirmation, so it travels on `repo:branchDelete` rather than this generic passthrough. */
export type BranchAct = "merge" | "pull" | "push" | "finish"

/** The four git-flow work types (feature/bugfix/release/hotfix). */
export type FlowKind = keyof FlowPrefixes

/** The `gitflow.*` config the initialization form writes before `git flow init -d` (avoiding the
    interactive prompt that would hang without a TTY). Trunk branch names + the five prefixes. */
export type FlowInitConfig = {
  master: string
  develop: string
  feature: string
  bugfix: string
  release: string
  hotfix: string
  support: string
  /** version-tag prefix (`gitflow.prefix.versiontag`) — often "v" or empty. */
  versiontag: string
}

/** Parsed `git count-objects -vH`. Counts are numbers; sizes stay the human-readable strings
    `-H` produces ("48.00 KiB") — the maintenance modal only displays them. */
export type CountObjects = {
  count: number
  size: string
  inPack: number
  packs: number
  sizePack: string
  prunePackable: number
  garbage: number
  sizeGarbage: string
}

/** Long-running database maintenance: `git fsck --full` (verify) / `git gc` (compact). */
export type MaintKind = "fsck" | "gc"

/** Operations that stream a determinate `NN%` from git's stderr (`--progress`): the two
    maintenance jobs and the three network ops (fetch/pull/push). `gc` never reports one. */
export type ProgressOp = MaintKind | OpName

/** Live progress of a `--progress` run, streamed from git's stderr (`NN%`). Consumed by the
    maintenance modal (fsck/gc) and the footer feed (fetch/pull/push), cf. features/repo. */
export type ProgressEvent = { id: number; op: ProgressOp; percent: number }

/* L'auto-update (main/updater.ts). `origin` distingue le check silencieux du démarrage du
   check manuel (Help ▸ Check for updates) : le renderer n'affiche les états intermédiaires
   (checking, up to date, erreur) que pour un check manuel — seul "ready" apparaît en auto.
   "unavailable" : build non packagée (dev), l'updater est inerte. */
export type UpdateState =
  | { kind: "checking" }
  | { kind: "none" }
  | { kind: "downloading"; version: string; percent: number }
  | { kind: "ready"; version: string }
  | { kind: "error"; message: string }
  | { kind: "unavailable" }

export type UpdateStatus = { origin: "auto" | "manual" } & UpdateState

export type WtSource = "staged" | "unstaged" | "untracked"

/** Subject (first line) and description (body) of a commit message, as entered. */
export type CommitMessage = { subject: string; body: string }

export type Worktree = Record<"staged" | "unstaged" | "untracked" | "conflicts", FileChange[]>

/** The merge in progress, if any — the source of the "who is A, who is B" labels of the
    conflict view. `ours` is the checked-out branch (side A, stage 2 of the index), `theirs`
    the branch being merged in (side B, stage 3, i.e. MERGE_HEAD). A conflict can exist
    without a merge (stash pop, cherry-pick): `merging` is false and both labels are null —
    the renderer falls back to generic "ours"/"theirs" wording. */
export type MergeState = {
  merging: boolean
  /** side A label: current branch name, or null (detached HEAD, no merge) */
  ours: string | null
  /** side B label: a branch pointing at MERGE_HEAD, else its short hash, or null */
  theirs: string | null
}

/** The versions of one conflicted path. A missing index stage is null: no `base` for an
    add/add, no `ours` when deleted on our side, no `theirs` when deleted on theirs. */
export type ConflictFile = {
  base: string | null
  ours: string | null
  theirs: string | null
  /** working-file content, conflict markers included — the starting point of the editable
      merged output */
  merged: string
}

export type OpName = "fetch" | "pull" | "push"

/* The "error" case carries a structured code rather than a pre-formatted French message (fix
   from the "errors" workstream, AUDIT.md §4): the renderer composes the displayed text. Since
   this channel is an event (`webContents.send`), not an `invoke` error, it escapes Electron's
   restriction that only lets `.message` through on a throw — `code`/`detail` travel as-is,
   without the JSON detour that `shared/errors.ts` requires on the invoke side. */
export type OpEvent = { id: number } & (
  | { op: OpName; state: "start"; auto: boolean }
  | {
      op: OpName
      state: "done"
      auto: boolean
      /** commits brought in by a fetch — feeds the "N new commits" badge (0 for pull/push) */
      added: number
      /** any ref tip moved (push updates the remote-tracking ref, `--prune` removes tips
          without adding a commit): the renderer's cue to reload the graph */
      changed: boolean
    }
  | ({ op: OpName; state: "error"; auto: boolean } & ErrorPayload)
)

/** `.git` moved under our feet. Main only emits it when the app is in the foreground. */
export type ChangeEvent = { id: number }

/** A console line: operation header, launched command, stderr output, or outcome. */
export type TraceLine = { id: number } & (
  | { kind: "group"; text: string; ts: number }
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string }
  | { kind: "exit"; ok: boolean; ms: number }
)
