/* Le contrat IPC partagé : UNE map typée par canal, plutôt que trois copies manuelles
   synchronisées à la main (main, preload, miroir renderer — cf. AUDIT.md §3). Main et
   preload compilent contre les mêmes signatures ; un renommage de canal ou un argument
   ajouté casse à la compilation dans les trois process, plus seulement à l'exécution.

   Ce fichier CAPTURE le contrat existant, il ne le réforme pas : mêmes noms de canaux,
   mêmes payloads qu'avant ce refactor. Les erreurs structurées viennent au chantier suivant. */

import type {
  BootState, BranchAct, ChangeEvent, Commit, CommitMessage, FileChange, FlowInfo, FlowPrefixes,
  GitRef, OpEvent, OpName, OpenResult, RepoRef, Stash, StashAct, Status, TraceLine, Worktree,
  WtSource,
} from "./types"

/** Un canal par entrée `invoke`/`handle` : la signature complète, arguments compris. */
export type InvokeChannels = {
  "app:state": () => Promise<BootState>
  "app:repos": () => Promise<{ root: string | null; recents: RepoRef[] }>
  "app:tabs": (paths: string[], active: string | null) => Promise<void>
  "repo:openDialog": () => Promise<OpenResult>
  "repo:openPath": (path: string) => Promise<Exclude<OpenResult, null>>
  "repo:close": (id: number) => Promise<void>
  "root:choose": () => Promise<string | null>
  "root:scan": () => Promise<RepoRef[]>

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
  "repo:log": (id: number, skip: number, count: number) => Promise<Commit[]>
  "repo:refs": (id: number) => Promise<GitRef[]>
  "repo:files": (id: number, hash: string, parent: string | null) => Promise<FileChange[]>
  "repo:body": (id: number, hash: string) => Promise<string>
  "repo:headMessage": (id: number) => Promise<CommitMessage>
  "repo:diff": (
    id: number,
    hash: string,
    parent: string | null,
    path: string,
    oldPath: string | null
  ) => Promise<string>
  "repo:search": (id: number, q: string, content: boolean) => Promise<string[]>
  "repo:total": (id: number) => Promise<number>
  "repo:checkout": (id: number, name: string) => Promise<void>
  "repo:stashes": (id: number) => Promise<Stash[]>
  "repo:stash": (id: number, action: StashAct, arg?: string) => Promise<void>
}

/** Nom de canal `invoke`/`handle` — dérivé du contrat, jamais redéclaré à la main. */
export type InvokeChannel = keyof InvokeChannels

/** Un canal par événement poussé par main (`webContents.send` / `ipcRenderer.on`). */
export type EventChannels = {
  "git:op": OpEvent
  "git:changed": ChangeEvent
  "git:trace": TraceLine
}

export type EventChannel = keyof EventChannels

/** Ce que le preload expose en `window.gitgraph`. Les noms de méthode diffèrent des noms de
    canal (`state` ↔ `app:state`, `log` ↔ `repo:log`…) : ils restent ceux que le renderer
    consomme déjà, cette table est la seule correspondance entre les deux mondes. Les
    abonnements `on*` retournent un désabonnement (`ipcRenderer.off` côté preload) — un vrai
    par consommateur, plus le singleton `fanout` qu'imposait l'ancienne API sans unsubscribe. */
export type Bridge = {
  state: InvokeChannels["app:state"]
  repos: InvokeChannels["app:repos"]
  setTabs: InvokeChannels["app:tabs"]
  openDialog: InvokeChannels["repo:openDialog"]
  openPath: InvokeChannels["repo:openPath"]
  close: InvokeChannels["repo:close"]
  chooseRoot: InvokeChannels["root:choose"]
  scanRoot: InvokeChannels["root:scan"]

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
  fileIcon: InvokeChannels["repo:fileIcon"]
  openFile: InvokeChannels["repo:openFile"]
}
