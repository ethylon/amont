import { createHash } from 'node:crypto';
import { contextBridge, ipcRenderer } from 'electron';

/* Les appels repo prennent l'id de l'onglet en premier argument : le renderer n'a jamais
   de chemin en direct, sauf ceux que main lui a montrés (récents, scan). */
contextBridge.exposeInMainWorld('gitgraph', {
  /* Clé Gravatar. `crypto.subtle` ne hache qu'en asynchrone ; le graphe, rendu ligne par ligne
     en impératif, devrait alors poser ses avatars après coup. Node hache en synchrone, ici. */
  sha256: (text) => createHash('sha256').update(text).digest('hex'),

  state: () => ipcRenderer.invoke('app:state'),
  repos: () => ipcRenderer.invoke('app:repos'),
  setTabs: (paths, active) => ipcRenderer.invoke('app:tabs', paths, active),
  openDialog: () => ipcRenderer.invoke('repo:openDialog'),
  openPath: (path) => ipcRenderer.invoke('repo:openPath', path),
  close: (id) => ipcRenderer.invoke('repo:close', id),
  chooseRoot: () => ipcRenderer.invoke('root:choose'),
  scanRoot: () => ipcRenderer.invoke('root:scan'),
  onOp: (cb) => ipcRenderer.on('git:op', (_ev, payload) => cb(payload)),
  onChanged: (cb) => ipcRenderer.on('git:changed', (_ev, payload) => cb(payload)),

  log: (id, skip, count) => ipcRenderer.invoke('repo:log', id, skip, count),
  total: (id) => ipcRenderer.invoke('repo:total', id),
  search: (id, q, content) => ipcRenderer.invoke('repo:search', id, q, content),
  refs: (id) => ipcRenderer.invoke('repo:refs', id),
  flow: (id) => ipcRenderer.invoke('repo:flow', id),
  branch: (id, action, name) => ipcRenderer.invoke('repo:branch', id, action, name),
  files: (id, hash, parent) => ipcRenderer.invoke('repo:files', id, hash, parent),
  body: (id, hash) => ipcRenderer.invoke('repo:body', id, hash),
  diff: (id, hash, parent, path, oldPath) => ipcRenderer.invoke('repo:diff', id, hash, parent, path, oldPath),
  status: (id) => ipcRenderer.invoke('repo:status', id),
  op: (id, name) => ipcRenderer.invoke('repo:op', id, name),
  worktree: (id) => ipcRenderer.invoke('repo:worktree', id),
  wtdiff: (id, path, source) => ipcRenderer.invoke('repo:wtdiff', id, path, source),
  stage: (id, paths) => ipcRenderer.invoke('repo:stage', id, paths),
  unstage: (id, paths) => ipcRenderer.invoke('repo:unstage', id, paths),
  commit: (id, message) => ipcRenderer.invoke('repo:commit', id, message),
  checkout: (id, name) => ipcRenderer.invoke('repo:checkout', id, name),
  fileIcon: (id, path) => ipcRenderer.invoke('repo:fileIcon', id, path),
  openFile: (id, path) => ipcRenderer.invoke('repo:openFile', id, path),
});
