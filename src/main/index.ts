/* Entry point of main (AUDIT.md §4): wiring of the app lifecycle, nothing else — the
   logic lives in state.ts, repos.ts, security.ts, window.ts, ipc.ts and git/. */

import { app } from "electron"

import { registerIpc } from "./ipc.ts"
import { hardenSession } from "./security.ts"
import { loadState } from "./state.ts"
import { createWindow, focusExisting } from "./window.ts"

/* Single instance only: a second concurrent launch would overwrite state.json in a
   last-writer-wins race (hygiene fix) — we refuse it and bring the first window to the
   foreground instead of opening a silent duplicate window. */
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on("second-instance", focusExisting)

  /* Remote debug port: never in a published package (hardening fix). */
  if (process.env.AMONT_DEBUG && !app.isPackaged) {
    app.commandLine.appendSwitch("remote-debugging-port", process.env.AMONT_DEBUG)
  }

  registerIpc()

  void app
    .whenReady()
    .then(loadState)
    .then(() => {
      hardenSession()
      createWindow()
    })

  app.on("window-all-closed", () => app.quit())
}
