/* Main window (AUDIT.md §4): creation, crash/incident reporting (with a cap on
   size and reload loops), navigation hardening. The rest of main reads the
   current window via `getMainWindow()` rather than a `mainWindow` global scattered everywhere —
   same variable, but a single write point, which lets `git/exec.ts` and friends
   never import `electron` for a `BrowserWindow`. */

import { join } from "node:path"
import { appendFile, stat, truncate } from "node:fs/promises"
import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron"

import { killCreations } from "./create.ts"
import { closeAll } from "./repos.ts"

let mainWindow: BrowserWindow | null = null

export const getMainWindow = (): BrowserWindow | null => mainWindow

/* --- Incident log ---
   `incidents.log` under userData. In dev it's also mirrored to stderr. Writing is best-effort —
   a full disk breaks nothing. Capped (hygiene fix): a crash loop before the cap kicks in, or a
   chatty repo, must not make this file grow without limit. */
const INCIDENTS_CAP = 5 * 1024 * 1024 // 5 MB

export async function report(...parts: string[]): Promise<void> {
  const line = `${new Date().toISOString()} ${parts.join(" ")}`
  console.error(line)
  const file = join(app.getPath("userData"), "incidents.log")
  try {
    const { size } = await stat(file).catch(() => ({ size: 0 }))
    if (size > INCIDENTS_CAP) await truncate(file, 0)
    await appendFile(file, line + "\n")
  } catch {
    /* best-effort */
  }
}

export function createWindow(): void {
  /* no File|Edit|View menu: the app exposes none, shortcuts live in the renderer */
  Menu.setApplicationMenu(null)
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    /* below this width, sidebar + detail column (556px fixed) would crush the graph */
    minWidth: 900,
    minHeight: 600,
    /* the window background is painted before the first render; without it, a white flash in
       dark theme. `show: false` + ready-to-show avoids exposing an empty window. */
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    icon: join(app.getAppPath(), "resources/icon.png"),
    webPreferences: {
      /* the preload is bundled as CJS (cf. electron.vite.config): an ESM preload
         would require sandbox: false, and the app displays uncontrolled repo content —
         the Chromium sandbox is the renderer's last line of defense. */
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win

  /* A dead renderer leaves a black, unresponsive window (no more keyboard, F5 doesn't work):
     we log the incident then reload automatically. The log survives the crash —
     it's what we read afterward to understand what happened.
     Capped: a deterministic crash on load would loop reload → crash forever
     (CPU pegged, incidents.log growing) — past the cap, a static page explains what's next. */
  const RELOAD_MAX = 3
  const RELOAD_WINDOW_MS = 60_000
  let reloads: number[] = []
  win.webContents.on("render-process-gone", (_ev, d) => {
    void report("renderer gone:", d.reason, `(exit ${d.exitCode})`)
    if (d.reason === "clean-exit") return
    const now = Date.now()
    reloads = reloads.filter((t) => now - t < RELOAD_WINDOW_MS)
    if (reloads.length < RELOAD_MAX) {
      reloads.push(now)
      return win.webContents.reload()
    }
    void report("renderer crash loop: reload suspended, static error page")
    if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/crash.html`)
    else void win.loadFile(join(import.meta.dirname, "../renderer/crash.html"))
  })
  win.webContents.on("unresponsive", () => void report("renderer unresponsive"))
  win.webContents.on("responsive", () => void report("renderer responsive again"))
  win.webContents.on("console-message", (details) => {
    /* Resource 404s (avatars) are not incidents. */
    if (details.level === "error" && !details.message.includes("Failed to load resource")) {
      void report("[renderer]", details.message.slice(0, 500))
    }
  })
  win.once("ready-to-show", () => win.show())
  /* links from commit messages: open in the browser, never in the app's own window */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  /* the window never navigates (a file dragged onto it would load its file://);
     only the dev server reload keeps the right of passage */
  win.webContents.on("will-navigate", (ev, url) => {
    if (!process.env.ELECTRON_RENDERER_URL || !url.startsWith(process.env.ELECTRON_RENDERER_URL)) ev.preventDefault()
  })
  win.on("closed", () => {
    mainWindow = null
    closeAll()
    killCreations()
  })

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

/** Brings the existing window to the foreground (hygiene fix: `requestSingleInstanceLock`,
    cf. index.ts — a second instance must not silently overwrite `state.json`, it must
    hand control back to the first one). */
export function focusExisting(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}
