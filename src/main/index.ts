/* Entry point of main (AUDIT.md §4): wiring of the app lifecycle, nothing else — the
   logic lives in state.ts, repos.ts, security.ts, window.ts, ipc.ts and git/. */

import { app } from "electron"

import { registerIpc } from "./ipc.ts"
import { hardenSession } from "./security.ts"
import { loadState } from "./state.ts"
import { applyTelemetryOptOut, initTelemetry } from "./telemetry.ts"
import { initUpdater } from "./updater.ts"
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

  /* Sentry must be initialized before the 'ready' event (@sentry/electron/main), so it goes
     here rather than inside whenReady(). It starts inert; applyTelemetryOptOut() below flips it
     on once loadState() has read the persisted opt-out flag. */
  initTelemetry()

  void app
    .whenReady()
    .then(loadState)
    .then(() => {
      /* after loadState (reads the opt-out flag), before createWindow so a failure while
         building the window is still reported */
      applyTelemetryOptOut()
      hardenSession()
      createWindow()
      /* after createWindow: the updater pushes its events to the main window */
      initUpdater()
    })

  app.on("window-all-closed", () => app.quit())
}
