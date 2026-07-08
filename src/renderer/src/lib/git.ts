/* Miroir typé de ce que le preload expose. Le renderer ne voit jamais un chemin de repo. */

export type Commit = {
  /** hash court, 8 caractères */
  h: string
  /** parents, hashes courts ; le premier est le first-parent */
  p: string[]
  d: string
  a: string
  /** refs brutes de `%D` : "HEAD -> develop, tag: v4.2.0" */
  r: string
  s: string
}

export type FileChange = {
  /** A, M, D, R, C, ? ou un couple de conflit (UU, AA…) */
  st: string
  path: string
  old?: string | null
}

export type Repo = { path: string; name: string; total: number }
export type OpenResult = Repo | { error: string } | null

export type Status = {
  branch: string | null
  head: string | null
  ahead: number | null
  behind: number | null
}

export type WtSource = "staged" | "unstaged" | "untracked"

export type Worktree = Record<"staged" | "unstaged" | "untracked" | "conflicts", FileChange[]>

export type OpName = "fetch" | "pull" | "push"

export type OpEvent =
  | { op: OpName; state: "start"; auto: boolean }
  | { op: OpName; state: "done"; auto: boolean; added: number }
  | { op: OpName; state: "error"; auto: boolean; message: string }

export type LogMode = "all" | "mainline"

export type GitApi = {
  current(): Promise<Repo | null>
  openRepo(): Promise<OpenResult>
  log(skip: number, count: number, mode: LogMode): Promise<Commit[]>
  total(mode: LogMode): Promise<number>
  files(hash: string, parent: string | null): Promise<FileChange[]>
  diff(hash: string, parent: string | null, path: string, oldPath: string | null): Promise<string>
  status(): Promise<Status>
  op(name: OpName): Promise<void>
  onOp(cb: (payload: OpEvent) => void): void
  worktree(): Promise<Worktree>
  wtdiff(path: string, source: WtSource): Promise<string>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  commit(message: string): Promise<void>
}

declare global {
  interface Window {
    gitgraph: GitApi
  }
}

export const api = window.gitgraph

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length
