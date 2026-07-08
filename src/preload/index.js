import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gitgraph', {
  current: () => ipcRenderer.invoke('repo:current'),
  openRepo: () => ipcRenderer.invoke('repo:open'),
  log: (skip, count, mode) => ipcRenderer.invoke('repo:log', skip, count, mode),
  total: (mode) => ipcRenderer.invoke('repo:total', mode),
  files: (hash, parent) => ipcRenderer.invoke('repo:files', hash, parent),
  diff: (hash, parent, path, oldPath) => ipcRenderer.invoke('repo:diff', hash, parent, path, oldPath),
  status: () => ipcRenderer.invoke('repo:status'),
  op: (name) => ipcRenderer.invoke('repo:op', name),
  onOp: (cb) => ipcRenderer.on('git:op', (_ev, payload) => cb(payload)),
  worktree: () => ipcRenderer.invoke('repo:worktree'),
  wtdiff: (path, source) => ipcRenderer.invoke('repo:wtdiff', path, source),
  stage: (paths) => ipcRenderer.invoke('repo:stage', paths),
  unstage: (paths) => ipcRenderer.invoke('repo:unstage', paths),
  commit: (message) => ipcRenderer.invoke('repo:commit', message),
});
