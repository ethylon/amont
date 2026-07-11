/* Runtime hardening (AUDIT.md §4, item 5). Electron fuses (RunAsNode, inspect CLI,
   NODE_OPTIONS, asar integrity) are set at build time, via electron-builder's afterPack
   (scripts/after-pack.mjs) — nothing to do here at runtime. */

import { app, session } from "electron"

/** Deny-all on permission requests (camera, mic, notifications, geolocation…):
    the app doesn't need any of them, and a hostile repo displaying diff content must not
    be able to request any of them via a web API. */
function denyAllPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

/** `web-contents-created`: defense in depth over ANY webContents that might come to
    exist. The app only creates one (cf. window.ts), but a compromised renderer could try
    to open a second one (popup, webview) — the same navigation rules apply. */
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
