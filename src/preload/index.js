import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('gitgraph', {
  current: () => ipcRenderer.invoke('repo:current'),
  openRepo: () => ipcRenderer.invoke('repo:open'),
  log: (skip, count, mode) => ipcRenderer.invoke('repo:log', skip, count, mode),
  total: (mode) => ipcRenderer.invoke('repo:total', mode),
  files: (hash, parent) => ipcRenderer.invoke('repo:files', hash, parent),
  diff: (hash, parent, path, oldPath) => ipcRenderer.invoke('repo:diff', hash, parent, path, oldPath),
});
