import { contextBridge, ipcRenderer } from "electron"

import type { Bridge, EventChannels, InvokeChannels } from "../shared/ipc-contract.ts"

/* Repo calls take the tab id as their first argument: the renderer never has a
   path directly, except for those main has shown it (recents, scan).
   No Node API here: the avatar sha256 lives in the renderer (cf. lib/sha256),
   which is what lets us keep the Chromium sandbox enabled.

   Generic projection of the shared contract rather than 34 lines of manual wiring: each
   invoke() method has the exact signature of its channel, derived from ipc-contract.ts — a
   renamed channel or an added argument breaks here at compile time. The on* subscriptions now
   return a real unsubscribe (`ipcRenderer.off`), which the preload didn't offer before
   this refactor — hence the `fanout` singleton the renderer used to have to layer on top. */

function invoke<K extends keyof InvokeChannels>(channel: K): InvokeChannels[K] {
  return ((...args: unknown[]) => ipcRenderer.invoke(channel, ...args)) as InvokeChannels[K]
}

function on<K extends keyof EventChannels>(channel: K) {
  return (cb: (payload: EventChannels[K]) => void) => {
    const listener = (_ev: Electron.IpcRendererEvent, payload: EventChannels[K]) => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.off(channel, listener)
  }
}

const bridge: Bridge = {
  state: invoke("app:state"),
  repos: invoke("app:repos"),
  setTabs: invoke("app:tabs"),
  openDialog: invoke("repo:openDialog"),
  openPath: invoke("repo:openPath"),
  close: invoke("repo:close"),
  chooseRoot: invoke("root:choose"),
  scanRoot: invoke("root:scan"),

  onOp: on("git:op"),
  onChanged: on("git:changed"),
  onTrace: on("git:trace"),

  log: invoke("repo:log"),
  total: invoke("repo:total"),
  search: invoke("repo:search"),
  refs: invoke("repo:refs"),
  flow: invoke("repo:flow"),
  flowInfo: invoke("repo:flowInfo"),
  branch: invoke("repo:branch"),
  files: invoke("repo:files"),
  body: invoke("repo:body"),
  headMessage: invoke("repo:headMessage"),
  diff: invoke("repo:diff"),
  status: invoke("repo:status"),
  op: invoke("repo:op"),
  worktree: invoke("repo:worktree"),
  wtdiff: invoke("repo:wtdiff"),
  stage: invoke("repo:stage"),
  unstage: invoke("repo:unstage"),
  commit: invoke("repo:commit"),
  checkout: invoke("repo:checkout"),
  stashes: invoke("repo:stashes"),
  stash: invoke("repo:stash"),
  mergeState: invoke("repo:mergeState"),
  conflict: invoke("repo:conflict"),
  resolve: invoke("repo:resolve"),
  mergeAbort: invoke("repo:mergeAbort"),
  fileIcon: invoke("repo:fileIcon"),
  openFile: invoke("repo:openFile"),
  cancel: invoke("repo:cancel"),
}

contextBridge.exposeInMainWorld("amont", bridge)
