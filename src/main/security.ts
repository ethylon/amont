/* Durcissement runtime (AUDIT.md §4, item 5). Les fuses Electron (RunAsNode, inspect CLI,
   NODE_OPTIONS, intégrité asar) se posent au build, via l'afterPack d'electron-builder
   (scripts/after-pack.mjs) — rien à faire ici à l'exécution. */

import { app, session } from "electron"

/** Deny-all sur les demandes de permission (caméra, micro, notifications, géolocalisation…) :
    l'app n'en a besoin d'aucune, et un dépôt hostile affichant un contenu de diff ne doit
    pouvoir en réclamer aucune via une API web. */
function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

/** `web-contents-created` : défense en profondeur sur TOUT webContents qui viendrait à
    exister. L'app n'en crée qu'un (cf. window.ts), mais un renderer compromis pourrait tenter
    d'en ouvrir un second (popup, webview) — les mêmes règles de navigation s'appliquent. */
function hardenAnyWebContents(): void {
  app.on("web-contents-created", (_ev, contents) => {
    contents.setWindowOpenHandler(() => ({ action: "deny" }))
    contents.on("will-navigate", (ev) => ev.preventDefault())
  })
}

export function hardenSession(): void {
  denyAllPermissions()
  hardenAnyWebContents()
}
