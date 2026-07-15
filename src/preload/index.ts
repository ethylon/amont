/* Sentry's preload shim: exposes the IPC hooks @sentry/electron/renderer needs to forward
   renderer errors to the main process. Required here because the renderer is sandboxed
   (sandbox: true, nodeIntegration: false — cf. main/window.ts) and can't do IPC itself.
   Inert when main initialized no client (no DSN). Imported first, before anything can throw. */
import "@sentry/electron/preload"

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
  telemetryState: invoke("telemetry:state"),
  setTelemetry: invoke("telemetry:set"),
  getSettings: invoke("settings:get"),
  setSettings: invoke("settings:set"),
  chooseCreateDir: invoke("create:chooseDir"),
  initRepo: invoke("create:init"),
  initBare: invoke("create:bare"),
  cloneRepo: invoke("create:clone"),

  checkForUpdates: invoke("update:check"),
  installUpdate: invoke("update:install"),

  onOp: on("git:op"),
  onUpdate: on("update:status"),
  onChanged: on("git:changed"),
  onTrace: on("git:trace"),
  onProgress: on("git:progress"),

  log: invoke("repo:log"),
  total: invoke("repo:total"),
  search: invoke("repo:search"),
  refs: invoke("repo:refs"),
  flow: invoke("repo:flow"),
  flowInfo: invoke("repo:flowInfo"),
  flowInit: invoke("flow:init"),
  flowStart: invoke("flow:start"),
  flowPublish: invoke("flow:publish"),
  branch: invoke("repo:branch"),
  branchDelete: invoke("repo:branchDelete"),
  files: invoke("repo:files"),
  body: invoke("repo:body"),
  headMessage: invoke("repo:headMessage"),
  diff: invoke("repo:diff"),
  blob: invoke("repo:blob"),
  status: invoke("repo:status"),
  op: invoke("repo:op"),
  worktree: invoke("repo:worktree"),
  wtdiff: invoke("repo:wtdiff"),
  stage: invoke("repo:stage"),
  unstage: invoke("repo:unstage"),
  applyPatch: invoke("repo:applyPatch"),
  discard: invoke("repo:discard"),
  discardPatch: invoke("repo:discardPatch"),
  commit: invoke("repo:commit"),
  checkout: invoke("repo:checkout"),
  stashes: invoke("repo:stashes"),
  stash: invoke("repo:stash"),
  worktrees: invoke("repo:worktrees"),
  worktreeAct: invoke("repo:worktreeAct"),
  worktreeAdd: invoke("repo:worktreeAdd"),
  worktreeOpen: invoke("repo:worktreeOpen"),
  worktreeReveal: invoke("repo:worktreeReveal"),
  mergeState: invoke("repo:mergeState"),
  conflict: invoke("repo:conflict"),
  resolve: invoke("repo:resolve"),
  mergeAbort: invoke("repo:mergeAbort"),
  countObjects: invoke("repo:countObjects"),
  fsck: invoke("repo:fsck"),
  gc: invoke("repo:gc"),
  fileIcon: invoke("repo:fileIcon"),
  openFile: invoke("repo:openFile"),
  cancel: invoke("repo:cancel"),
}

contextBridge.exposeInMainWorld("amont", bridge)
