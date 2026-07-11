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

export type FileChange = {
  /** A, M, D, R, C, ? or a conflict pair (UU, AA…) */
  st: string
  path: string
  old?: string | null
}

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
}

export type BranchAct = "merge" | "delete" | "pull" | "push" | "finish"

export type WtSource = "staged" | "unstaged" | "untracked"

/** Subject (first line) and description (body) of a commit message, as entered. */
export type CommitMessage = { subject: string; body: string }

export type Worktree = Record<"staged" | "unstaged" | "untracked" | "conflicts", FileChange[]>

export type OpName = "fetch" | "pull" | "push"

/* The "error" case carries a structured code rather than a pre-formatted French message (fix
   from the "errors" workstream, AUDIT.md §4): the renderer composes the displayed text. Since
   this channel is an event (`webContents.send`), not an `invoke` error, it escapes Electron's
   restriction that only lets `.message` through on a throw — `code`/`detail` travel as-is,
   without the JSON detour that `shared/errors.ts` requires on the invoke side. */
export type OpEvent = { id: number } & (
  | { op: OpName; state: "start"; auto: boolean }
  | { op: OpName; state: "done"; auto: boolean; added: number }
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
