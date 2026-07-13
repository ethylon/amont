/* IPC registrar (AUDIT.md §4): the single point through which every `ipcMain.handle` passes —
   verifies that the call comes from the main window and types arguments/return value against
   the shared contract — then wires each channel to repos/state/scan/git. The business logic
   lives in the dedicated modules; this file only connects it to IPC. */

import { dialog, ipcMain, type IpcMainInvokeEvent } from "electron"

import { AppError } from "../shared/errors.ts"
import type { InvokeChannel, InvokeChannels } from "../shared/ipc-contract.ts"
import type { BootState, Repo } from "../shared/types.ts"
import * as create from "./create.ts"
import * as flow from "./git/flow.ts"
import * as maintenance from "./git/maintenance.ts"
import * as ops from "./git/ops.ts"
import { BRANCH } from "./git/parse.ts"
import * as queries from "./git/queries.ts"
import * as repos from "./repos.ts"
import { scan } from "./scan.ts"
import { openable, persisted, saveState } from "./state.ts"
import { setTelemetryEnabled, telemetryState } from "./telemetry.ts"
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
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== getMainWindow()?.webContents) throw new AppError("NOT_ALLOWED", "unexpected sender")
    return fn(event, ...(args as Parameters<InvokeChannels[K]>))
  })
}

/* --- Per-repo hooks ---
   Built once per opening, injected into the RepoHandle (repos.ts) then into the
   git runner (git/exec.ts): none of these modules read `mainWindow` themselves. */
const makeHooks = (id: number): repos.RepoHooks => ({
  trace: (line) => getMainWindow()?.webContents.send("git:trace", { id, ...line }),
  op: (payload) => getMainWindow()?.webContents.send("git:op", { id, ...payload }),
  progress: (payload) => getMainWindow()?.webContents.send("git:progress", { id, ...payload }),
  changed: () => getMainWindow()?.webContents.send("git:changed", { id }),
  isFocused: () => getMainWindow()?.isFocused() ?? false,
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

  /* --- Application state ---
     Called once at renderer startup (cf. boot() in lib/git.ts). Idempotent: a
     second call doesn't reopen anything, it just reflects the current registry. */
  let booted = false

  handle("app:state", async (): Promise<BootState> => {
    const tabs: Repo[] = []
    if (!booted) {
      booted = true
      const paths = process.env.GG_REPO ? [process.env.GG_REPO, ...persisted.tabs] : persisted.tabs
      for (const path of [...new Set(paths)]) {
        try {
          tabs.push(await openRepoPub(path))
        } catch {
          /* repo gone since the last session: ignore it, this must not block boot */
        }
      }
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

  handle("repo:op", (_ev, id, name) => {
    if (!ops.isOpName(name)) throw new AppError("BAD_ARG", "name")
    return ops.runOp(repos.use(id), name)
  })

  handle("repo:status", (_ev, id) => queries.repoStatus(repos.use(id)))
  handle("repo:fileIcon", (_ev, id, path) => queries.fileIcon(repos.use(id), path))
  handle("repo:openFile", (_ev, id, path) => queries.openFile(repos.use(id), path))
  handle("repo:worktree", (_ev, id) => queries.worktree(repos.use(id)))
  handle("repo:wtdiff", (_ev, id, path, source) => queries.wtdiff(repos.use(id), path, source))
  handle("repo:stage", (_ev, id, paths) => ops.stage(repos.use(id), paths))
  handle("repo:unstage", (_ev, id, paths) => ops.unstage(repos.use(id), paths))
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
  handle("flow:start", (_ev, id, kind, name) => flow.flowStart(repos.use(id), kind, name))
  handle("flow:publish", (_ev, id, kind, name) => flow.flowPublish(repos.use(id), kind, name))

  handle("repo:branch", (_ev, id, action, name) => ops.branchAction(repos.use(id), action, name))

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
  handle("repo:mergeState", (_ev, id) => queries.mergeState(repos.use(id)))
  handle("repo:conflict", (_ev, id, path) => queries.conflict(repos.use(id), path))
  handle("repo:resolve", (_ev, id, path, content) => ops.resolveConflict(repos.use(id), path, content))
  handle("repo:mergeAbort", (_ev, id) => ops.mergeAbort(repos.use(id)))

  handle("repo:countObjects", (_ev, id) => maintenance.countObjects(repos.use(id)))
  handle("repo:fsck", (_ev, id) => maintenance.fsck(repos.use(id)))
  handle("repo:gc", (_ev, id) => maintenance.gc(repos.use(id)))

  handle("repo:cancel", (_ev, id, requestId) => {
    repos.use(id).requests.get(requestId)?.abort()
    return Promise.resolve()
  })
}
