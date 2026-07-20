/* IPC registrar (AUDIT.md §4): the single point through which every `ipcMain.handle` passes —
   verifies that the call comes from the main window and types arguments/return value against
   the shared contract — then wires each channel to repos/state/scan/git. The business logic
   lives in the dedicated modules; this file only connects it to IPC. */

import { resolve } from "node:path"

import { dialog, ipcMain, shell, type IpcMainInvokeEvent } from "electron"

import { AppError } from "../shared/errors.ts"
import type { InvokeChannel, InvokeChannels } from "../shared/ipc-contract.ts"
import type { BootState, Repo } from "../shared/types.ts"
import * as create from "./create.ts"
import { runConsole } from "./git/console.ts"
import * as flow from "./git/flow.ts"
import * as maintenance from "./git/maintenance.ts"
import { mergePreview } from "./git/merge-preview.ts"
import * as ops from "./git/ops.ts"
import { BRANCH } from "./git/parse.ts"
import * as queries from "./git/queries.ts"
import * as repos from "./repos.ts"
import { scan } from "./scan.ts"
import { getSettings, onSettingsChange, setSettings } from "./settings.ts"
import { openable, persisted, saveState } from "./state.ts"
import { captureIpcError, setTelemetryEnabled, telemetryState } from "./telemetry.ts"
import { checkForUpdates, installUpdate } from "./updater.ts"
import { basename } from "./util.ts"
import { getMainWindow } from "./window.ts"

/* --- Generic registrar ---
   A single passage point for every `ipcMain.handle`: verifies that the call comes from the
   main window (no other webContents should ever reach these handlers — there's no additional
   view in this app) and types the arguments/return value against the shared contract. A
   renamed channel or an argument added to the contract now breaks at compile time across all
   three processes, not just at runtime. */
function handle<K extends InvokeChannel>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, ...args: Parameters<InvokeChannels[K]>) => ReturnType<InvokeChannels[K]>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== getMainWindow()?.webContents) throw new AppError("NOT_ALLOWED", "unexpected sender")
    /* Telemetry net at the boundary: an unexpected code is captured here whether the renderer
       will surface it (toast) or swallow it into a fallback (`stashes() → []`) — then
       re-thrown untouched, so the renderer contract doesn't move. Expected codes
       (MERGE_CONFLICT, NOT_A_REPO…) pass through without a glance. */
    try {
      return await fn(event, ...(args as Parameters<InvokeChannels[K]>))
    } catch (e) {
      captureIpcError(channel, e)
      throw e
    }
  })
}

/* --- Per-repo hooks ---
   Built once per opening, injected into the RepoHandle (repos.ts) then into the
   git runner (git/exec.ts): none of these modules read `mainWindow` themselves. */
const makeHooks = (id: number): repos.RepoHooks => ({
  trace: (line) => getMainWindow()?.webContents.send("git:trace", { id, ...line }),
  op: (payload) => getMainWindow()?.webContents.send("git:op", { id, ...payload }),
  progress: (payload) => getMainWindow()?.webContents.send("git:progress", { id, ...payload }),
  queue: (payload) => getMainWindow()?.webContents.send("git:queue", { id, ...payload }),
  changed: () => getMainWindow()?.webContents.send("git:changed", { id }),
  isFocused: () => getMainWindow()?.isFocused() ?? false,
  /* fingerprint for the watcher's emitChanged gate (refresh audit, §2): a .git event whose
     HEAD/refs/stash snapshot is unchanged never wakes the renderer. async: `use` throws
     once the repo is closed — the rejection makes the gate fail open, and closed repos
     have no watchers left to fire anyway. */
  graphKey: async () => queries.graphSnapshotKey(repos.use(id)),
})

const openRepoPub = (path: string): Promise<Repo> => repos.openRepo(path, makeHooks)

/* --- Targeted cancellation ---
   `requestId` (a string from the renderer) resolves to an AbortController on the main side; a
   real AbortSignal wouldn't survive IPC's structured clone (main workstream fix, AUDIT.md
   §2 B4). Channels that don't provide a `requestId` run without a signal, as
   before this refactor. */
function withCancel<T>(
  r: repos.RepoHandle,
  requestId: string | undefined,
  fn: (signal?: AbortSignal) => Promise<T>
): Promise<T> {
  if (!requestId) return fn()
  const controller = new AbortController()
  r.requests.set(requestId, controller)
  /* Async boundary: some handlers (files/body/diff) validate their arguments synchronously
     and throw before returning a promise. Without this, that throw would escape before the
     .finally() is attached and leave the controller in the map for good — a renderer feeding
     malformed hashes could grow it without bound. */
  return Promise.resolve()
    .then(() => fn(controller.signal))
    .finally(() => r.requests.delete(requestId))
}

export function registerIpc(): void {
  repos.setAutofetch((r) => void ops.runOp(r, "fetch", true))
  /* an autofetch on/off or interval change re-arms the open repos' timers, live (repos.ts).
     Wired here rather than inside settings.ts, which must not depend on repos.ts (it already
     reads getSettings() the other way). */
  onSettingsChange(() => repos.rescheduleAutofetch())

  /* --- Application state ---
     Called once at renderer startup (cf. boot() in lib/git.ts). Idempotent: a
     second call doesn't reopen anything, it just reflects the current registry. */
  let booted = false

  handle("app:state", async (): Promise<BootState> => {
    const tabs: Repo[] = []
    if (!booted) {
      booted = true
      const paths = process.env.GG_REPO ? [process.env.GG_REPO, ...persisted.tabs] : persisted.tabs
      /* all tabs in parallel rather than one await each: 8 restored tabs used to pay 8
         serial `rev-parse` probes before the first useful paint. allSettled keeps the
         persisted order and drops the failures (repo gone since the last session — that
         must not block boot), exactly as the old loop did. */
      const opened = await Promise.allSettled([...new Set(paths)].map((path) => openRepoPub(path)))
      for (const res of opened) if (res.status === "fulfilled") tabs.push(res.value)
    } else {
      tabs.push(...repos.all().map(repos.pub))
    }
    return {
      root: persisted.root,
      recents: persisted.recents.map((path) => ({ path, name: basename(path) })),
      tabs,
      active: tabs.find((t) => t.path === persisted.active)?.id ?? tabs[0]?.id ?? null,
    }
  })

  /* What the home screen knows about the repos. Separate from app:state, which opens repos. */
  handle("app:repos", () =>
    Promise.resolve({
      root: persisted.root,
      recents: persisted.recents.map((path) => ({ path, name: basename(path) })),
    })
  )

  handle("app:tabs", (_ev, paths, active) => {
    persisted.tabs = paths.filter((p) => openable.has(p))
    persisted.active = active
    return saveState()
  })

  handle("repo:openDialog", async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] })
    if (res.canceled || !res.filePaths.length) return null
    return openRepoPub(res.filePaths[0])
  })

  handle("repo:openPath", (_ev, path) => {
    if (!openable.has(path)) throw new AppError("NOT_ALLOWED", path)
    return openRepoPub(path)
  })

  handle("repo:close", (_ev, id) => {
    repos.closeRepo(id)
    return Promise.resolve()
  })

  handle("root:choose", async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] })
    if (res.canceled || !res.filePaths.length) return persisted.root
    persisted.root = res.filePaths[0]
    await saveState()
    return persisted.root
  })

  /* Crash-reporting opt-out (cf. telemetry.ts). `set` coerces to a real boolean — the renderer
     is the source, and every other handler validates its arguments the same way. */
  handle("telemetry:state", () => Promise.resolve(telemetryState()))
  handle("telemetry:set", (_ev, enabled) => setTelemetryEnabled(enabled === true))

  /* User settings (cf. settings.ts). `set` takes a partial patch and coerces the merged result
     to a valid shape (settings.ts) — a malformed field from the renderer can never reach git. */
  handle("settings:get", () => Promise.resolve(getSettings()))
  handle("settings:set", (_ev, patch) => setSettings(patch && typeof patch === "object" ? patch : {}))

  /* Auto-update (cf. updater.ts) : l'invoke déclenche, le retour passe par `update:status`. */
  handle("update:check", () => checkForUpdates())
  handle("update:install", () => installUpdate())

  handle("root:scan", async () => {
    if (!persisted.root) return []
    const found: string[] = []
    await scan(persisted.root, 0, found)
    found.forEach((p) => openable.add(p))
    return found.map((path) => ({ path, name: basename(path) })).sort((a, b) => a.name.localeCompare(b.name))
  })

  /* --- Creation page (the "+" in the tab strip) ---
     The picked folder is remembered (create.allowDir) before being handed to the renderer:
     init/bare/clone later refuse any destination that didn't come through here or isn't the
     root — same confinement as `openable` for opening. */

  handle("create:chooseDir", async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] })
    if (res.canceled || !res.filePaths.length) return null
    create.allowDir(res.filePaths[0])
    return res.filePaths[0]
  })

  handle("create:init", async (_ev, dir, name) => {
    const dest = await create.initRepo(dir, name)
    return openRepoPub(dest)
  })

  handle("create:bare", (_ev, dir, name) => create.initBare(dir, name))

  handle("create:clone", async (_ev, dir, url, name) => {
    const dest = await create.cloneRepo(dir, url, name)
    return openRepoPub(dest)
  })

  /* --- Repo: operations, id as first argument --- */

  handle("repo:op", (_ev, id, name, variant) => {
    if (!ops.isOpName(name)) throw new AppError("BAD_ARG", "name")
    /* only the two pairs the remote-ahead banner sends: a variant on the wrong op is garbage */
    if (variant !== undefined && !((name === "push" && variant === "force") || (name === "pull" && variant === "ff")))
      throw new AppError("BAD_ARG", "variant")
    return ops.runOp(repos.use(id), name, false, variant)
  })

  handle("repo:status", (_ev, id) => queries.repoStatus(repos.use(id)))
  handle("repo:fileIcon", (_ev, id, path) => queries.fileIcon(repos.use(id), path))
  handle("repo:openFile", (_ev, id, path) => queries.openFile(repos.use(id), path))
  handle("repo:worktree", (_ev, id) => queries.worktree(repos.use(id)))
  handle("repo:wtdiff", (_ev, id, path, source) => queries.wtdiff(repos.use(id), path, source))
  handle("repo:stage", (_ev, id, paths) => ops.stage(repos.use(id), paths))
  handle("repo:unstage", (_ev, id, paths) => ops.unstage(repos.use(id), paths))
  handle("repo:applyPatch", (_ev, id, patch, reverse) => ops.applyPatch(repos.use(id), patch, reverse === true))
  handle("repo:discard", (_ev, id, paths, untracked) => ops.discard(repos.use(id), paths, untracked))
  handle("repo:discardPatch", (_ev, id, patch) => ops.discardPatch(repos.use(id), patch))
  handle("repo:commit", (_ev, id, message, amend) => ops.commit(repos.use(id), message, amend))
  handle("repo:flow", (_ev, id) => flow.flowPrefixes(repos.use(id)))

  handle("repo:flowInfo", (_ev, id, branch, kind) => {
    const r = repos.use(id)
    if (typeof branch !== "string" || !BRANCH.test(branch)) throw new AppError("BAD_ARG", "branch")
    if (!flow.FLOW_TYPES.includes(kind)) throw new AppError("BAD_ARG", "kind")
    return flow.flowInfo(r, branch, kind)
  })

  /* Git-flow mutations. `init` receives a plain object from the form; the rest are guarded
     against `-`-prefixed name/version injection inside flow.ts (fix B2). */
  handle("flow:init", (_ev, id, cfg) => {
    if (!cfg || typeof cfg !== "object") throw new AppError("BAD_ARG", "cfg")
    return flow.flowInit(repos.use(id), cfg)
  })
  handle("flow:start", (_ev, id, kind, name, base) => flow.flowStart(repos.use(id), kind, name, base))
  handle("flow:publish", (_ev, id, kind, name) => flow.flowPublish(repos.use(id), kind, name))
  handle("flow:finish", (_ev, id, name, opts) =>
    flow.finishFeature(repos.use(id), name, {
      rebase: opts?.rebase === true,
      deleteBranch: opts?.deleteBranch === true,
    })
  )

  handle("repo:branch", (_ev, id, action, name) => ops.branchAction(repos.use(id), action, name))
  handle("repo:merge", (_ev, id, name, noFF) => ops.mergeBranch(repos.use(id), name, noFF === true))
  handle("repo:mergePreview", (_ev, id, base, branches) => mergePreview(repos.use(id), base, branches))
  handle("repo:branchDelete", (_ev, id, name, deleteRemote) =>
    ops.deleteBranch(repos.use(id), name, deleteRemote === true)
  )
  handle("repo:remoteBranchDelete", (_ev, id, name) => ops.deleteRemoteBranch(repos.use(id), name))
  handle("repo:tagDelete", (_ev, id, name, remote) => ops.deleteTag(repos.use(id), name, remote ?? null))
  handle("repo:branchCreate", (_ev, id, name, from, checkout) =>
    ops.createBranch(repos.use(id), name, from, checkout === true)
  )
  handle("repo:tagCreate", (_ev, id, name, at) => ops.createTag(repos.use(id), name, at))
  handle("repo:reset", (_ev, id, mode, to) => ops.resetTo(repos.use(id), mode, to))
  handle("repo:revert", (_ev, id, hash) => ops.revertCommit(repos.use(id), hash))
  handle("repo:cherryPick", (_ev, id, hash) => ops.cherryPick(repos.use(id), hash))

  handle("repo:log", (_ev, id, skip, count, requestId) => {
    const r = repos.use(id)
    if (!Number.isInteger(skip) || !Number.isInteger(count) || skip < 0 || count < 1 || count > 5000)
      throw new AppError("BAD_ARG", "skip/count")
    return withCancel(r, requestId, (signal) => queries.logPage(r, skip, count, signal))
  })

  handle("repo:refs", (_ev, id) => queries.listRefs(repos.use(id)))

  handle("repo:files", (_ev, id, hash, parent, requestId) => {
    const r = repos.use(id)
    return withCancel(r, requestId, (signal) => queries.files(r, hash, parent, signal))
  })

  handle("repo:body", (_ev, id, hash, requestId) => {
    const r = repos.use(id)
    return withCancel(r, requestId, (signal) => queries.body(r, hash, signal))
  })

  handle("repo:headMessage", (_ev, id) => queries.headMessage(repos.use(id)))

  handle("repo:diff", (_ev, id, hash, parent, path, oldPath, requestId) => {
    const r = repos.use(id)
    return withCancel(r, requestId, (signal) => queries.diff(r, hash, parent, path, oldPath, signal))
  })

  handle("repo:blob", (_ev, id, path, ref) => queries.blob(repos.use(id), path, ref))

  handle("repo:search", (_ev, id, q, content, requestId) => {
    const r = repos.use(id)
    if (typeof q !== "string" || q.trim().length < 2) return Promise.resolve([])
    return withCancel(r, requestId, (signal) => queries.searchCommits(r, q.trim(), content === true, signal))
  })

  handle("repo:total", (_ev, id) => queries.total(repos.use(id)))
  handle("repo:checkout", (_ev, id, name) => ops.checkout(repos.use(id), name))
  handle("repo:stashes", (_ev, id) => queries.stashList(repos.use(id)))
  handle("repo:stash", (_ev, id, action, arg) => ops.stashAction(repos.use(id), action, arg))

  /* --- Linked worktrees ---
     Every renderer-supplied path passes through `resolveWorktree` (a `git worktree list`
     lookup): open/reveal/remove never reach an arbitrary path — same confinement model as
     `openable`. */
  handle("repo:worktrees", (_ev, id) => queries.worktrees(repos.use(id)))

  handle("repo:worktreeAct", async (_ev, id, action, path) => {
    const r = repos.use(id)
    if (action !== "remove") return ops.worktreeAction(r, action)
    const wt = await queries.resolveWorktree(r, path)
    /* the main worktree isn't removable, and a worktree open in a tab (this one or another)
       still holds watchers and git children: close the tab first */
    if (wt.main || repos.all().some((o) => queries.sameWtPath(resolve(o.path), wt.path)))
      throw new AppError("NOT_ALLOWED", wt.path)
    return ops.worktreeAction(r, action, wt.path)
  })

  handle("repo:worktreeAdd", async (_ev, id, branch) => {
    const r = repos.use(id)
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] })
    if (res.canceled || !res.filePaths.length) return null
    const dest = res.filePaths[0]
    await ops.worktreeAdd(r, dest, branch)
    openable.add(dest)
    return openRepoPub(dest)
  })

  handle("repo:worktreeAddFrom", async (_ev, id, branch, from) => {
    const r = repos.use(id)
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ["openDirectory", "createDirectory"] })
    if (res.canceled || !res.filePaths.length) return null
    const dest = res.filePaths[0]
    await ops.worktreeAddFrom(r, dest, branch, from)
    openable.add(dest)
    return openRepoPub(dest)
  })

  handle("repo:worktreeOpen", async (_ev, id, path) => {
    const wt = await queries.resolveWorktree(repos.use(id), path)
    if (wt.prunable) throw new AppError("NOT_A_REPO")
    openable.add(wt.path) // survives tab persistence (app:tabs filters on `openable`)
    return openRepoPub(wt.path)
  })

  handle("repo:worktreeReveal", async (_ev, id, path) => {
    const wt = await queries.resolveWorktree(repos.use(id), path)
    shell.showItemInFolder(wt.path)
  })
  handle("repo:mergeState", (_ev, id) => queries.mergeState(repos.use(id)))
  handle("repo:conflict", (_ev, id, path) => queries.conflict(repos.use(id), path))
  handle("repo:resolve", (_ev, id, path, content) => ops.resolveConflict(repos.use(id), path, content))
  handle("repo:mergeAbort", (_ev, id) => ops.mergeAbort(repos.use(id)))

  handle("repo:countObjects", (_ev, id) => maintenance.countObjects(repos.use(id)))
  handle("repo:fsck", (_ev, id) => maintenance.fsck(repos.use(id)))
  handle("repo:gc", (_ev, id) => maintenance.gc(repos.use(id)))

  /* Typed console command: the string is parsed and policed inside runConsole
     (git/console.ts) — this handler forwards it raw, like every other channel. */
  handle("repo:console", (_ev, id, command) => runConsole(repos.use(id), command))

  handle("repo:cancel", (_ev, id, requestId) => {
    repos.use(id).requests.get(requestId)?.abort()
    return Promise.resolve()
  })
}
