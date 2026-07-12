/* Renderer-side crash reporting. @sentry/electron routes renderer errors to the main process
   over IPC (through the preload bridge, cf. src/preload + main/telemetry.ts) — the renderer
   itself opens no socket, so the strict CSP (csp.mjs) is untouched. A no-op when main never
   initialized a client (no DSN baked in): events are simply forwarded and dropped. */

import * as Sentry from "@sentry/electron/renderer"

/** Installs the global error/rejection handlers and the IPC forwarder. Called once, early,
    from main.tsx so a failure during boot is still reported. Skipped outside Electron: the
    mock harness (`pnpm mock`) runs the renderer in a plain browser with no preload bridge,
    where @sentry/electron/renderer would have no main process to forward to. */
export function initTelemetry(): void {
  if (!navigator.userAgent.includes("Electron")) return
  Sentry.init({})
}

/** React render throws don't reach window.onerror; the ErrorBoundary reports them by hand,
    attaching the component stack as context. */
export function captureException(error: unknown, componentStack?: string | null): void {
  Sentry.captureException(error, componentStack ? { contexts: { react: { componentStack } } } : undefined)
}
