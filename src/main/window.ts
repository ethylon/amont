/* Fenêtre principale (AUDIT.md §4) : création, rapport de crash/incidents (avec plafond de
   taille et de boucle de reload), durcissement de la navigation. Le reste du main lit la
   fenêtre courante via `getMainWindow()` plutôt qu'un `mainWindow` global disséminé partout —
   même variable, mais un seul point d'écriture, ce qui permet à `git/exec.ts` et consorts de
   ne jamais importer `electron` pour un `BrowserWindow`. */

import { join } from "node:path"
import { appendFile, stat, truncate } from "node:fs/promises"
import { app, BrowserWindow, Menu, nativeTheme, shell } from "electron"

import { closeAll } from "./repos.ts"

let mainWindow: BrowserWindow | null = null

export const getMainWindow = (): BrowserWindow | null => mainWindow

/* --- Journal d'incidents ---
   `incidents.log` sous userData. En dev il double sur stderr. L'écriture est best-effort — un
   disque plein ne casse rien. Plafonné (fix hygiène) : une boucle de crash pré-plafond ou un
   dépôt bavard ne doit pas faire enfler ce fichier sans limite. */
const INCIDENTS_CAP = 5 * 1024 * 1024 // 5 Mo

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
  /* pas de menu File|Edit|View : l'app n'en expose aucun, les raccourcis vivent dans le renderer */
  Menu.setApplicationMenu(null)
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    /* sous cette largeur, sidebar + colonne détail (556px fixes) écraseraient le graphe */
    minWidth: 900,
    minHeight: 600,
    /* le fond de la fenêtre est peint avant le premier rendu ; sans lui, flash blanc en
       thème sombre. `show: false` + ready-to-show évite d'exposer une fenêtre vide. */
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0a0a0a" : "#ffffff",
    icon: join(app.getAppPath(), "resources/icon.png"),
    webPreferences: {
      /* le preload est bundlé en CJS (cf. electron.vite.config) : un preload ESM
         exigerait sandbox: false, et l'app affiche du contenu de dépôt non maîtrisé —
         le bac à sable Chromium est la dernière ligne de défense du renderer. */
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow = win

  /* Un renderer mort laisse une fenêtre noire et sourde (plus de clavier, F5 inopérant) :
     on journalise l'incident puis on recharge d'office. Le journal survit au crash —
     c'est lui qu'on lit après coup pour comprendre.
     Plafonné : un crash déterministe au chargement ferait boucler reload → crash sans fin
     (CPU à fond, incidents.log qui enfle) — au-delà, une page statique explique la suite. */
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
    void report("renderer crash loop: reload suspendu, page d'erreur statique")
    if (process.env.ELECTRON_RENDERER_URL) win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/crash.html`)
    else win.loadFile(join(import.meta.dirname, "../renderer/crash.html"))
  })
  win.webContents.on("unresponsive", () => void report("renderer unresponsive"))
  win.webContents.on("responsive", () => void report("renderer responsive again"))
  win.webContents.on("console-message", (details) => {
    /* Les 404 de ressources (avatars) ne sont pas des incidents. */
    if (details.level === "error" && !details.message.includes("Failed to load resource")) {
      void report("[renderer]", details.message.slice(0, 500))
    }
  })
  win.once("ready-to-show", () => win.show())
  /* liens des messages de commit : au navigateur, jamais dans la fenêtre de l'app */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: "deny" }
  })
  /* la fenêtre ne navigue jamais (un fichier glissé dessus chargerait son file://) ;
     seul le rechargement du serveur de dev garde le droit de passage */
  win.webContents.on("will-navigate", (ev, url) => {
    if (!process.env.ELECTRON_RENDERER_URL || !url.startsWith(process.env.ELECTRON_RENDERER_URL)) ev.preventDefault()
  })
  win.on("closed", () => {
    mainWindow = null
    closeAll()
  })

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, "../renderer/index.html"))
}

/** Ramène la fenêtre existante au premier plan (fix hygiène : `requestSingleInstanceLock`,
    cf. index.ts — une seconde instance ne doit pas écraser `state.json` en silence, elle doit
    rendre la main à la première). */
export function focusExisting(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.focus()
}
