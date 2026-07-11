/* Registrar IPC (AUDIT.md §4) : point unique par lequel tous les `ipcMain.handle` passent —
   vérifie que l'appel vient de la fenêtre principale et type arguments/retour contre le
   contrat partagé — puis câblage de chaque canal vers repos/state/scan/git. La logique métier
   vit dans les modules dédiés ; ce fichier ne fait que la relier à l'IPC. */

import { dialog, ipcMain, type IpcMainInvokeEvent } from "electron"

import { AppError } from "../shared/errors.ts"
import type { InvokeChannel, InvokeChannels } from "../shared/ipc-contract.ts"
import type { BootState, Repo } from "../shared/types.ts"
import * as flow from "./git/flow.ts"
import * as ops from "./git/ops.ts"
import * as queries from "./git/queries.ts"
import * as repos from "./repos.ts"
import { scan } from "./scan.ts"
import { openable, persisted, saveState } from "./state.ts"
import { basename } from "./util.ts"
import { getMainWindow } from "./window.ts"

/* --- Registrar générique ---
   Un seul point de passage pour tous les `ipcMain.handle` : vérifie que l'appel vient de la
   fenêtre principale (aucune autre webContents ne devrait jamais atteindre ces handlers — pas
   de vue additionnelle dans cette app) et type les arguments/le retour contre le contrat
   partagé. Un canal renommé ou un argument ajouté au contrat casse désormais à la compilation
   dans les trois process, plus seulement à l'exécution. */
function handle<K extends InvokeChannel>(
  channel: K,
  fn: (event: IpcMainInvokeEvent, ...args: Parameters<InvokeChannels[K]>) => ReturnType<InvokeChannels[K]>
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (event.sender !== getMainWindow()?.webContents) throw new AppError("NOT_ALLOWED", "unexpected sender")
    return fn(event, ...(args as Parameters<InvokeChannels[K]>))
  })
}

/* --- Hooks par dépôt ---
   Construits une fois par ouverture, injectés dans le RepoHandle (repos.ts) puis dans le
   runner git (git/exec.ts) : aucun de ces modules ne lit `mainWindow` lui-même. */
const makeHooks = (id: number): repos.RepoHooks => ({
  trace: (line) => getMainWindow()?.webContents.send("git:trace", { id, ...line }),
  op: (payload) => getMainWindow()?.webContents.send("git:op", { id, ...payload }),
  changed: () => getMainWindow()?.webContents.send("git:changed", { id }),
  isFocused: () => getMainWindow()?.isFocused() ?? false,
})

const openRepoPub = (path: string): Promise<Repo> => repos.openRepo(path, makeHooks)

/* --- Annulation ciblée ---
   `requestId` (une string du renderer) se résout en AbortController côté main ; un vrai
   AbortSignal ne traverserait pas le clonage structuré de l'IPC (fix chantier main, AUDIT.md
   §2 B4). Les canaux qui ne fournissent pas de `requestId` s'exécutent sans signal, comme
   avant ce refactor. */
function withCancel<T>(r: repos.RepoHandle, requestId: string | undefined, fn: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  if (!requestId) return fn()
  const controller = new AbortController()
  r.requests.set(requestId, controller)
  return fn(controller.signal).finally(() => r.requests.delete(requestId))
}

export function registerIpc(): void {
  repos.setAutofetch((r) => ops.runOp(r, "fetch", true))

  /* --- État de l'application ---
     Appelé une fois au démarrage du renderer (cf. boot() dans lib/git.ts). Idempotent : un
     second appel ne rouvre rien, il reflète juste le registre courant. */
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
          /* dépôt disparu depuis la dernière session : on l'ignore, ça ne doit pas bloquer le boot */
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

  /* Ce que l'écran d'accueil connaît des dépôts. Séparé de app:state, qui ouvre des repos. */
  handle("app:repos", () => Promise.resolve({
    root: persisted.root,
    recents: persisted.recents.map((path) => ({ path, name: basename(path) })),
  }))

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

  handle("repo:close", (_ev, id) => { repos.closeRepo(id); return Promise.resolve() })

  handle("root:choose", async () => {
    const win = getMainWindow()
    const res = await dialog.showOpenDialog(win!, { properties: ["openDirectory"] })
    if (res.canceled || !res.filePaths.length) return persisted.root
    persisted.root = res.filePaths[0]
    await saveState()
    return persisted.root
  })

  handle("root:scan", async () => {
    if (!persisted.root) return []
    const found: string[] = []
    await scan(persisted.root, 0, found)
    found.forEach((p) => openable.add(p))
    return found
      .map((path) => ({ path, name: basename(path) }))
      .sort((a, b) => a.name.localeCompare(b.name))
  })

  /* --- Repo : opérations, id en premier argument --- */

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
    if (typeof branch !== "string") throw new AppError("BAD_ARG", "branch")
    if (!flow.FLOW_TYPES.includes(kind)) throw new AppError("BAD_ARG", "kind")
    return flow.flowInfo(r, branch, kind)
  })

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

  handle("repo:search", (_ev, id, q, content, requestId) => {
    const r = repos.use(id)
    if (typeof q !== "string" || q.trim().length < 2) return Promise.resolve([])
    return withCancel(r, requestId, (signal) => queries.searchCommits(r, q.trim(), content === true, signal))
  })

  handle("repo:total", (_ev, id) => queries.total(repos.use(id)))
  handle("repo:checkout", (_ev, id, name) => ops.checkout(repos.use(id), name))
  handle("repo:stashes", (_ev, id) => queries.stashList(repos.use(id)))
  handle("repo:stash", (_ev, id, action, arg) => ops.stashAction(repos.use(id), action, arg))

  handle("repo:cancel", (_ev, id, requestId) => {
    repos.use(id).requests.get(requestId)?.abort()
    return Promise.resolve()
  })
}

