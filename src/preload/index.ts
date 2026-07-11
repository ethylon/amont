import { contextBridge, ipcRenderer } from 'electron';

import type { Bridge, EventChannels, InvokeChannels } from '../shared/ipc-contract.ts';

/* Les appels repo prennent l'id de l'onglet en premier argument : le renderer n'a jamais
   de chemin en direct, sauf ceux que main lui a montrés (récents, scan).
   Aucune API Node ici : le sha256 des avatars vit dans le renderer (cf. lib/sha256),
   c'est ce qui permet de garder le sandbox Chromium activé.

   Projection générique du contrat partagé plutôt que 34 lignes de câblage manuel : chaque
   méthode invoke() a la signature exacte de son canal, dérivée d'ipc-contract.ts — un canal
   renommé ou un argument ajouté casse ici à la compilation. Les abonnements on* retournent
   désormais un vrai désabonnement (`ipcRenderer.off`), ce que le preload n'offrait pas avant
   ce refactor — d'où le singleton `fanout` que le renderer devait poser par-dessus. */

function invoke<K extends keyof InvokeChannels>(channel: K): InvokeChannels[K] {
  return ((...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as InvokeChannels[K];
}

function on<K extends keyof EventChannels>(channel: K) {
  return (cb: (payload: EventChannels[K]) => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, payload: EventChannels[K]) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.off(channel, listener);
  };
}

const bridge: Bridge = {
  state: invoke('app:state'),
  repos: invoke('app:repos'),
  setTabs: invoke('app:tabs'),
  openDialog: invoke('repo:openDialog'),
  openPath: invoke('repo:openPath'),
  close: invoke('repo:close'),
  chooseRoot: invoke('root:choose'),
  scanRoot: invoke('root:scan'),

  onOp: on('git:op'),
  onChanged: on('git:changed'),
  onTrace: on('git:trace'),

  log: invoke('repo:log'),
  total: invoke('repo:total'),
  search: invoke('repo:search'),
  refs: invoke('repo:refs'),
  flow: invoke('repo:flow'),
  flowInfo: invoke('repo:flowInfo'),
  branch: invoke('repo:branch'),
  files: invoke('repo:files'),
  body: invoke('repo:body'),
  headMessage: invoke('repo:headMessage'),
  diff: invoke('repo:diff'),
  status: invoke('repo:status'),
  op: invoke('repo:op'),
  worktree: invoke('repo:worktree'),
  wtdiff: invoke('repo:wtdiff'),
  stage: invoke('repo:stage'),
  unstage: invoke('repo:unstage'),
  commit: invoke('repo:commit'),
  checkout: invoke('repo:checkout'),
  stashes: invoke('repo:stashes'),
  stash: invoke('repo:stash'),
  fileIcon: invoke('repo:fileIcon'),
  openFile: invoke('repo:openFile'),
};

contextBridge.exposeInMainWorld('gitgraph', bridge);
