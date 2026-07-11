/* Client typé du bridge exposé par le preload. Les types du domaine vivent dans shared/ —
   ce module les ré-exporte pour ne pas faire bouger tous les imports du renderer — et la
   forme du bridge (Bridge) est dérivée du contrat IPC partagé (src/shared/ipc-contract.ts),
   compilé identiquement côté main et préload. */

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
    gitgraph: Bridge
  }
}

const bridge = window.gitgraph

export const host = {
  repos: bridge.repos,
  setTabs: bridge.setTabs,
  openDialog: bridge.openDialog,
  openPath: bridge.openPath,
  close: bridge.close,
  chooseRoot: bridge.chooseRoot,
  scanRoot: bridge.scanRoot,
}

/* Le preload gère désormais lui-même le désabonnement (`ipcRenderer.off`, cf. src/preload) :
   chaque appel à onOp/onChanged/onTrace pose son propre listener IPC et le retire à son tour,
   plus besoin du singleton `fanout` qui multiplexait un unique listener jamais désinscrit. */
export const onOp = bridge.onOp
export const onChanged = bridge.onChanged
export const onTrace = bridge.onTrace

/* Ouvre les repos des onglets restaurés. Appelée une fois, explicitement, depuis main.tsx —
   plutôt qu'un side-effect à l'import (l'ancien `bootState`, évalué dès que ce module était
   importé, y compris par un test qui n'en a rien à faire). `app:state` reste idempotent côté
   main : un second appel ne rouvrirait rien, il refléterait juste le registre courant. */
export const boot = () => bridge.state()

export type RepoApi = {
  log(skip: number, count: number): Promise<Commit[]>
  total(): Promise<number>
  /** hashes courts des commits correspondants, tous critères confondus ; `content` fouille les diffs */
  search(q: string, content: boolean): Promise<string[]>
  refs(): Promise<GitRef[]>
  /** `null` : le dépôt n'a jamais vu `git flow init` */
  flow(): Promise<FlowPrefixes | null>
  /** contexte de la branche de flow courante ; `null` si le tronc de référence manque */
  flowInfo(branch: string, kind: keyof FlowPrefixes): Promise<FlowInfo | null>
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
  /** entrées de `git stash list`, de la plus récente à la plus ancienne */
  stashes(): Promise<Stash[]>
  /** `push` remise l'arbre (message optionnel) ; les autres visent un nom `stash@{N}` */
  stash(action: StashAct, arg?: string): Promise<void>
  /** icône Windows du fichier, `null` s'il n'existe pas sur le disque */
  fileIcon(path: string): Promise<string | null>
  openFile(path: string): Promise<string>
  /** kill le process associé à `requestId`, s'il tourne encore (cf. chantier main, AUDIT.md §4) */
  cancel(requestId: string): Promise<void>
}

export const repoApi = (id: number): RepoApi => ({
  log: (skip, count) => bridge.log(id, skip, count),
  total: () => bridge.total(id),
  search: (q, content) => bridge.search(id, q, content),
  refs: () => bridge.refs(id),
  flow: () => bridge.flow(id),
  flowInfo: (branch, kind) => bridge.flowInfo(id, branch, kind),
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
  stashes: () => bridge.stashes(id),
  stash: (action, arg) => bridge.stash(id, action, arg),
  fileIcon: (path) => bridge.fileIcon(id, path),
  openFile: (path) => bridge.openFile(id, path),
  cancel: (requestId) => bridge.cancel(id, requestId),
})

export const worktreeCount = (w: Worktree) =>
  w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length
