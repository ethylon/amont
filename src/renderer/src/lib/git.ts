/* Miroir typé de ce que le preload expose. Les opérations git sont liées à un repo par
   `repoApi(id)` : un onglet ne peut pas parler au dépôt d'un autre onglet. */

export type Commit = {
  /** hash court, 8 caractères */
  h: string
  /** parents, hashes courts ; le premier est le first-parent */
  p: string[]
  d: string
  a: string
  /** e-mail de l'auteur, seule clé d'avatar que git connaisse */
  e: string
  /** refs brutes de `%D --decorate=full` : "HEAD -> refs/heads/develop, tag: refs/tags/v4.2.0" */
  r: string
  s: string
  /** posé par le collapse release/hotfix (cf. graph-layout) : cette ligne fusionne les deux merges
      d'une version — côté master (absorbé) et côté develop (survivant). */
  cap?: {
    /** hash court du merge master fusionné ; reste résolu par la capsule dans layoutChunk */
    absorbed: string
    /** tag semver de la release, `null` si la paire n'en portait pas */
    version: string | null
    /** branche source : "release/1.6.2", "hotfix/1.6.3" */
    from: string
    flow: "release" | "hotfix"
    /** [cible master, cible develop] */
    targets: [string, string]
  }
}

export type FileChange = {
  /** A, M, D, R, C, ? ou un couple de conflit (UU, AA…) */
  st: string
  path: string
  old?: string | null
}

/** Un dépôt ouvert. `id` est l'unique poignée acceptée par les appels git. */
export type Repo = { id: number; path: string; name: string }
/** Un dépôt connu mais pas ouvert : récent, ou trouvé sous la racine. */
export type RepoRef = { path: string; name: string }
export type OpenResult = Repo | { error: string } | null

export type BootState = {
  root: string | null
  recents: RepoRef[]
  /** onglets restaurés, déjà ouverts côté main */
  tabs: Repo[]
  active: number | null
}

export type Status = {
  branch: string | null
  head: string | null
  ahead: number | null
  behind: number | null
}

/** Une ref de `for-each-ref`. `ahead`/`behind` ne sont renseignés que pour une branche suivie. */
export type GitRef = {
  /** sans le préfixe `refs/…/` : "feature/x", "origin/master", "v4.2.0" */
  name: string
  kind: "head" | "remote" | "tag"
  head: boolean
  /** distante suivie, forme courte ("origin/master") ; vide si la branche n'en a pas */
  upstream: string
  ahead: number
  behind: number
  /** branche locale déjà fusionnée dans la branche d'intégration */
  merged: boolean
  /** branche locale dont la contrepartie distante a été supprimée */
  gone: boolean
}

/** Les préfixes de `git flow init`, ou `null` si le dépôt ignore git-flow. */
export type FlowPrefixes = Partial<Record<"feature" | "bugfix" | "release" | "hotfix", string>>

export type BranchAct = "merge" | "delete" | "pull" | "push" | "finish"

export type WtSource = "staged" | "unstaged" | "untracked"

/** Sujet (première ligne) et description (corps) d'un message de commit, tels que saisis. */
export type CommitMessage = { subject: string; body: string }

export type Worktree = Record<"staged" | "unstaged" | "untracked" | "conflicts", FileChange[]>

export type OpName = "fetch" | "pull" | "push"

export type OpEvent = { id: number } & (
  | { op: OpName; state: "start"; auto: boolean }
  | { op: OpName; state: "done"; auto: boolean; added: number }
  | { op: OpName; state: "error"; auto: boolean; message: string }
)

/** `.git` a bougé sous nos pieds. Main ne l'émet qu'application au premier plan. */
export type ChangeEvent = { id: number }

/** Une ligne de la console : en-tête d'opération, commande lancée, sortie stderr, ou issue. */
export type TraceLine = { id: number } & (
  | { kind: "group"; text: string; ts: number }
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string }
  | { kind: "exit"; ok: boolean; ms: number }
)

type Bridge = {
  /** hex minuscule ; hache dans le preload, `crypto.subtle` étant asynchrone */
  sha256(text: string): string
  state(): Promise<BootState>
  repos(): Promise<{ root: string | null; recents: RepoRef[] }>
  setTabs(paths: string[], active: string | null): Promise<void>
  openDialog(): Promise<OpenResult>
  openPath(path: string): Promise<Exclude<OpenResult, null>>
  close(id: number): Promise<void>
  chooseRoot(): Promise<string | null>
  scanRoot(): Promise<RepoRef[]>
  onOp(cb: (payload: OpEvent) => void): void
  onChanged(cb: (payload: ChangeEvent) => void): void
  onTrace(cb: (payload: TraceLine) => void): void

  log(id: number, skip: number, count: number): Promise<Commit[]>
  total(id: number): Promise<number>
  search(id: number, q: string, content: boolean): Promise<string[]>
  refs(id: number): Promise<GitRef[]>
  flow(id: number): Promise<FlowPrefixes | null>
  branch(id: number, action: BranchAct, name: string): Promise<void>
  files(id: number, hash: string, parent: string | null): Promise<FileChange[]>
  body(id: number, hash: string): Promise<string>
  diff(id: number, hash: string, parent: string | null, path: string, oldPath: string | null): Promise<string>
  status(id: number): Promise<Status>
  op(id: number, name: OpName): Promise<void>
  worktree(id: number): Promise<Worktree>
  wtdiff(id: number, path: string, source: WtSource): Promise<string>
  stage(id: number, paths: string[]): Promise<void>
  unstage(id: number, paths: string[]): Promise<void>
  commit(id: number, message: string, amend: boolean): Promise<void>
  headMessage(id: number): Promise<CommitMessage>
  checkout(id: number, name: string): Promise<void>
  fileIcon(id: number, path: string): Promise<string | null>
  openFile(id: number, path: string): Promise<string>
}

declare global {
  interface Window {
    gitgraph: Bridge
  }
}

const bridge = window.gitgraph

export const host = {
  sha256: bridge.sha256,
  repos: bridge.repos,
  setTabs: bridge.setTabs,
  openDialog: bridge.openDialog,
  openPath: bridge.openPath,
  close: bridge.close,
  chooseRoot: bridge.chooseRoot,
  scanRoot: bridge.scanRoot,
}

/* Un seul écouteur IPC par canal — le preload n'expose pas de désabonnement — redistribué aux
   vues. Sans ça, StrictMode doublerait les événements et une vue démontée en recevrait encore. */
function fanout<T>(listen: (cb: (p: T) => void) => void) {
  const subscribers = new Set<(p: T) => void>()
  listen((p) => subscribers.forEach((f) => f(p)))
  return (cb: (p: T) => void) => {
    subscribers.add(cb)
    return () => void subscribers.delete(cb)
  }
}

export const onOp = fanout<OpEvent>(bridge.onOp)
export const onChanged = fanout<ChangeEvent>(bridge.onChanged)
export const onTrace = fanout<TraceLine>(bridge.onTrace)

/* Évalué à l'import, donc une seule fois : `app:state` ouvre les repos des onglets restaurés
   et n'est pas idempotent vis-à-vis du double montage de StrictMode. */
export const bootState = bridge.state()

export type RepoApi = {
  log(skip: number, count: number): Promise<Commit[]>
  total(): Promise<number>
  /** hashes courts des commits correspondants, tous critères confondus ; `content` fouille les diffs */
  search(q: string, content: boolean): Promise<string[]>
  refs(): Promise<GitRef[]>
  /** `null` : le dépôt n'a jamais vu `git flow init` */
  flow(): Promise<FlowPrefixes | null>
  /** merge dans HEAD, suppression, pull/push d'une branche donnée, ou `git flow <type> finish` */
  branch(action: BranchAct, name: string): Promise<void>
  files(hash: string, parent: string | null): Promise<FileChange[]>
  /** corps du message (`%b`), trailers compris */
  body(hash: string): Promise<string>
  diff(hash: string, parent: string | null, path: string, oldPath: string | null): Promise<string>
  status(): Promise<Status>
  op(name: OpName): Promise<void>
  worktree(): Promise<Worktree>
  wtdiff(path: string, source: WtSource): Promise<string>
  stage(paths: string[]): Promise<void>
  unstage(paths: string[]): Promise<void>
  /** `amend` réécrit le dernier commit (message, et arbre indexé s'il y en a) au lieu d'en créer un */
  commit(message: string, amend: boolean): Promise<void>
  /** sujet et corps du dernier commit, pour préremplir un amend */
  headMessage(): Promise<CommitMessage>
  /** bascule sur une branche locale ; l'arbre sale est stashé puis réappliqué */
  checkout(name: string): Promise<void>
  /** icône Windows du fichier, `null` s'il n'existe pas sur le disque */
  fileIcon(path: string): Promise<string | null>
  openFile(path: string): Promise<string>
}

export const repoApi = (id: number): RepoApi => ({
  log: (skip, count) => bridge.log(id, skip, count),
  total: () => bridge.total(id),
  search: (q, content) => bridge.search(id, q, content),
  refs: () => bridge.refs(id),
  flow: () => bridge.flow(id),
  branch: (action, name) => bridge.branch(id, action, name),
  files: (hash, parent) => bridge.files(id, hash, parent),
  body: (hash) => bridge.body(id, hash),
  diff: (hash, parent, path, oldPath) => bridge.diff(id, hash, parent, path, oldPath),
  status: () => bridge.status(id),
  op: (name) => bridge.op(id, name),
  worktree: () => bridge.worktree(id),
  wtdiff: (path, source) => bridge.wtdiff(id, path, source),
  stage: (paths) => bridge.stage(id, paths),
  unstage: (paths) => bridge.unstage(id, paths),
  commit: (message, amend) => bridge.commit(id, message, amend),
  headMessage: () => bridge.headMessage(id),
  checkout: (name) => bridge.checkout(id, name),
  fileIcon: (path) => bridge.fileIcon(id, path),
  openFile: (path) => bridge.openFile(id, path),
})

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length
