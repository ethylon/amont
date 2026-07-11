/* Point d'entrée du main (AUDIT.md §4) : câblage du cycle de vie de l'app, rien d'autre — la
   logique vit dans state.ts, repos.ts, security.ts, window.ts, ipc.ts et git/. */

import { app } from "electron"

import { registerIpc } from "./ipc.ts"
import { hardenSession } from "./security.ts"
import { loadState } from "./state.ts"
import { createWindow, focusExisting } from "./window.ts"

/* Une seule instance : une seconde ouverture concurrente écraserait state.json en
   dernier-écrivain (fix hygiène) — on la refuse et on ramène la première fenêtre au premier
   plan plutôt que d'ouvrir une fenêtre muette en doublon. */
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", focusExisting)

  /* Port de debug distant : jamais dans un paquet publié (fix durcissement). */
  if (process.env.GG_DEBUG && !app.isPackaged) {
    app.commandLine.appendSwitch("remote-debugging-port", process.env.GG_DEBUG)
  }

  registerIpc()

  app.whenReady().then(loadState).then(() => {
    hardenSession()
    createWindow()
  })

  app.on("window-all-closed", () => app.quit())
}
