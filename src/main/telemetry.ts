/* Crash reporting — opt-out, and inert unless a DSN is baked in.

   amont is privacy-conscious (cf. csp.mjs, security.ts): the CSP comment notes avatars are the
   renderer's only outgoing request, and that stays true — Sentry events leave from the MAIN
   process here, never the renderer. Renderer errors are forwarded over IPC by @sentry/electron
   (cf. lib/telemetry.ts + the preload), so the strict renderer CSP is untouched.

   The DSN is injected at build time from the MAIN_VITE_SENTRY_DSN env variable (electron-vite
   reads it from the build environment — set by CI for releases, cf. .github/workflows/release.yml).
   A build from source has no DSN, so initTelemetry() is a no-op and nothing is ever sent by
   contributors' or unofficial builds — only the maintainer's release builds carry it.

   Opt-out is a persisted flag (state.json, cf. state.ts), toggled from the home screen. `enabled`
   is read on every event by beforeSend/beforeBreadcrumb, so flipping it takes effect immediately,
   no restart — and native minidumps go through the same client, so nothing is uploaded either. */

import { app } from "electron"
import * as Sentry from "@sentry/electron/main"

import { persisted, saveState } from "./state.ts"

const DSN = import.meta.env.MAIN_VITE_SENTRY_DSN

/* Default on when a DSN is present; the persisted flag (undefined on first run) only ever
   turns it off. Stays false when there's no DSN — telemetryState() reports it as unavailable. */
let enabled = false

/** Drop the two identity fields Sentry attaches by default even with sendDefaultPii off.
    Generic so beforeSend keeps handing back the exact event type it received. */
function scrub<E extends Sentry.Event>(event: E): E {
  delete event.server_name // machine hostname
  delete event.user
  return event
}

/** Must run BEFORE the Electron `ready` event (@sentry/electron/main requires it — otherwise
    it raises "Sentry SDK should be initialized before the Electron app 'ready' event is fired").
    So `enabled` stays false here — events are dropped until applyTelemetryOptOut() reads the
    persisted flag after loadState(). beforeSend/beforeBreadcrumb re-read `enabled` live, so no
    reinit is needed once the flag lands. */
export function initTelemetry(): void {
  if (!DSN) return
  Sentry.init({
    dsn: DSN,
    release: `amont@${app.getVersion()}`,
    environment: import.meta.env.MODE,
    /* never attach IP, cookies, or request bodies */
    sendDefaultPii: false,
    /* errors and native crashes only — no performance tracing (no tracesSampleRate) */
    beforeBreadcrumb: (breadcrumb) => (enabled ? breadcrumb : null),
    beforeSend: (event) => (enabled ? scrub(event) : null),
  })
}

/** Apply the persisted opt-out once loadState() has run. Undefined = never chosen, treated as
    on. Live: beforeSend re-reads `enabled` on the next event, no reinit. No-op without a DSN. */
export function applyTelemetryOptOut(): void {
  if (!DSN) return
  enabled = persisted.telemetry !== false
}

/** Home-screen toggle. Live (no restart): beforeSend re-reads `enabled` on every event.
    Persisted so the choice survives the next launch. No-op effect when no DSN is baked in. */
export function setTelemetryEnabled(value: boolean): Promise<void> {
  enabled = value
  persisted.telemetry = value
  return saveState()
}

/** `available`: a DSN was baked in — the home screen only shows the toggle then. */
export const telemetryState = (): { available: boolean; enabled: boolean } => ({
  available: !!DSN,
  enabled,
})
