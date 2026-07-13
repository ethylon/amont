/* Renderer-side crash reporting. @sentry/electron routes renderer errors to the main process
   over IPC (through the preload bridge, cf. src/preload + main/telemetry.ts) — the renderer
   itself opens no socket, so the strict CSP (csp.mjs) is untouched. A no-op when main never
   initialized a client (no DSN baked in): events are simply forwarded and dropped.

   The SDK is dynamically imported after first paint (perf audit, finding 19): its ~100 kB of
   module evaluation used to run before createRoot(). Nothing is lost in the gap — two tiny
   listeners installed before anything else can throw buffer boot errors, and initTelemetry()
   replays them once the SDK is up. Deferring the renderer init is safe by construction: the
   renderer SDK is a thin @sentry/browser wrapper whose transport forwards events over IPC to
   main's client (initialized before app 'ready', cf. main/telemetry.ts) — main never waits on
   the renderer. */

type Captured = { error: unknown; componentStack?: string | null }

/** null until the SDK is initialized; captureException falls back to the buffer meanwhile */
let capture: ((error: unknown, componentStack?: string | null) => void) | null = null
let buffered: Captured[] = []

/* enough for any real boot failure; also keeps the buffer bounded in the mock harness,
   where initTelemetry() never runs and nothing would ever drain it */
const MAX_BUFFERED = 20

const isElectron = (): boolean => navigator.userAgent.includes("Electron")

/* The pre-init stand-ins for the SDK's own global handlers: buffer, don't report. Kept as
   named consts so initTelemetry() can remove exactly these once Sentry has installed its own. */
const onError = (ev: ErrorEvent) => {
  captureException(ev.error ?? ev.message)
}
const onRejection = (ev: PromiseRejectionEvent) => {
  captureException(ev.reason)
}

/** Installs the buffering error/rejection handlers. Called once, first thing, from main.tsx —
    synchronous and dependency-free, so a failure anywhere during boot is still caught (and
    reported once initTelemetry() replays the buffer). Skipped outside Electron: the mock
    harness (`pnpm mock`) runs the renderer in a plain browser with no preload bridge, where
    @sentry/electron/renderer would have no main process to forward to. */
export function installTelemetryBuffer(): void {
  if (!isElectron()) return
  window.addEventListener("error", onError)
  window.addEventListener("unhandledrejection", onRejection)
}

/** Loads and initializes the SDK, then replays whatever the buffer caught during boot. Called
    from main.tsx after the first render is scheduled — the SDK's module evaluation happens off
    the critical path. The IPC forwarder is set up here too (through the preload bridge). */
export function initTelemetry(): void {
  if (!isElectron()) return
  /* destructured in the .then, not kept as a namespace: Rollup only tree-shakes a dynamic
     import when the used bindings are statically visible — a `Sentry.` namespace would drag
     every SDK export into the lazy chunk */
  void import("@sentry/electron/renderer").then(({ init, captureException: sentryCapture }) => {
    init({})
    /* Sentry's globalHandlers integration owns window errors from here on */
    window.removeEventListener("error", onError)
    window.removeEventListener("unhandledrejection", onRejection)
    capture = (error, componentStack) =>
      void sentryCapture(error, componentStack ? { contexts: { react: { componentStack } } } : undefined)
    const backlog = buffered
    buffered = []
    for (const { error, componentStack } of backlog) capture(error, componentStack)
  })
}

/** React render throws don't reach window.onerror; the ErrorBoundary reports them by hand,
    attaching the component stack as context. Before the SDK lands, reports are buffered and
    replayed by initTelemetry() — same path as the boot handlers above. */
export function captureException(error: unknown, componentStack?: string | null): void {
  if (capture) capture(error, componentStack)
  else if (buffered.length < MAX_BUFFERED) buffered.push({ error, componentStack })
}
