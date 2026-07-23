/* Auto-update via electron-updater (provider GitHub, cf. electron-builder.yml : latest.yml +
   blockmap sont déjà publiés avec chaque release NSIS). Téléchargement automatique ; l'install
   se fait au quit (autoInstallOnAppQuit) ou immédiatement quand l'utilisateur clique
   "Restart now" (update:install → quitAndInstall). Toute la progression part vers le renderer
   par l'événement `update:status` — la carte UI (features/updater) décide quoi montrer.

   NSIS ne sait pas pré-installer en arrière-plan pendant que l'app tourne (contrairement à
   Squirrel.Mac) : NsisUpdater.doInstall ne fait que lancer l'exe téléchargé au quit, et
   l'extraction prend son temps quel que soit le moment où on la déclenche.

   Pas de signature de code pour l'instant : l'intégrité repose sur HTTPS GitHub + le sha512
   de latest.yml. À revoir quand un certificat sera configuré (cf. electron-builder.yml). */

import { app } from "electron"
import electronUpdater from "electron-updater"

import type { UpdateState, UpdateStatus } from "../shared/types.ts"
import { getMainWindow, sendEvent } from "./window.ts"

/* electron-updater est un module CJS bundlé dans out/main : l'import nommé n'est pas
   fiable à travers l'interop rollup, on déstructure le default. */
const { autoUpdater } = electronUpdater

/* Le check du démarrage est silencieux ("auto") ; un check déclenché par le menu Help passe
   en "manual" et le reste — il n'y a pas de check périodique qui reviendrait derrière. */
let origin: UpdateStatus["origin"] = "auto"

/* download-progress ne porte pas la version : retenue depuis update-available. */
let pendingVersion = ""

function send(state: UpdateState): void {
  const status: UpdateStatus = { origin, ...state }
  sendEvent("update:status", status)
}

/** Câble les événements et lance le check silencieux du démarrage. No-op hors build packagée
    (en dev il n'y a ni app-update.yml ni binaire à remplacer). */
export function initUpdater(): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on("checking-for-update", () => send({ kind: "checking" }))
  autoUpdater.on("update-not-available", () => send({ kind: "none" }))
  autoUpdater.on("update-available", (info) => {
    pendingVersion = info.version
    send({ kind: "downloading", version: info.version, percent: 0 })
  })
  autoUpdater.on("download-progress", (p) =>
    send({ kind: "downloading", version: pendingVersion, percent: Math.round(p.percent) })
  )
  autoUpdater.on("update-downloaded", (info) => send({ kind: "ready", version: info.version }))
  /* Erreur réseau au démarrage = bruit : l'événement part au renderer, qui ne l'affiche
     que pour un check manuel. Rien vers Sentry — un poste hors ligne n'est pas un bug. */
  autoUpdater.on("error", (err) => send({ kind: "error", message: err.message }))

  /* Après le chargement du renderer, pour que la carte soit montée avant le premier événement
     (la latence réseau du check couvre largement le montage React). */
  getMainWindow()?.webContents.once("did-finish-load", () => {
    void autoUpdater.checkForUpdates().catch(() => {})
  })
}

/** Check manuel (Help ▸ Check for updates). */
export async function checkForUpdates(): Promise<void> {
  origin = "manual"
  if (!app.isPackaged) {
    send({ kind: "unavailable" })
    return
  }
  /* L'échec arrive déjà par l'événement "error" ; la promesse ne doit pas rejeter en plus. */
  await autoUpdater.checkForUpdates().catch(() => {})
}

/** Redémarre sur la version téléchargée (bouton "Restart now"). Installeur non silencieux :
    NSIS affiche sa fenêtre de progression pendant la minute d'extraction — en /S l'app
    disparaît sans aucun feedback et semble plantée jusqu'au relancement. Le quit ordinaire
    (autoInstallOnAppQuit) reste silencieux, lui : personne n'attend l'app à ce moment-là. */
export function installUpdate(): Promise<void> {
  autoUpdater.quitAndInstall(false, true)
  return Promise.resolve()
}
