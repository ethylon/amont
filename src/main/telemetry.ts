/* Crash reporting — opt-out, and inert unless a DSN is baked in.

   amont is privacy-conscious (cf. csp.mjs, security.ts): the CSP comment notes avatars are the
   renderer's only outgoing request, and that stays true — Sentry events leave from the MAIN
   process here, never the renderer. Renderer errors are forwarded over IPC by @sentry/electron
   (cf. lib/telemetry.ts + the preload), so the strict renderer CSP is untouched.

   The DSN is injected at build time from the MAIN_VITE_SENTRY_DSN env variable (electron-vite
   reads it from the build environment — set by CI for releases, cf. .github/workflows/release.yml).
   A build from source has no DSN, so the SDK below is never even loaded and nothing is ever sent
   by contributors' or unofficial builds — only the maintainer's release builds carry it.

   Opt-out is a persisted flag (state.json, cf. state.ts), toggled from the home screen. `enabled`
   is read on every event by beforeSend/beforeBreadcrumb, so flipping it takes effect immediately,
   no restart — and native minidumps go through the same client, so nothing is uploaded either. */

import { app, net } from "electron"
import type { Event as SentryEvent } from "@sentry/electron/main"

import { decodeError } from "../shared/errors.ts"
import { isNetworkNoise, sanitizeDetail, shouldSend, type GitFailureInfo } from "./git/telemetry-scrub.ts"
import { persisted, saveState } from "./state.ts"

const DSN = import.meta.env.MAIN_VITE_SENTRY_DSN

/* The SDK is loaded only when a DSN is baked in: DSN-less builds skip its module evaluation
   entirely instead of paying it on every launch (perf audit, finding 19). Top-level await keeps
   the DSN'd path as early as before: Electron holds the app 'ready' event until the main ESM
   graph — this await included — has finished loading, so initTelemetry() below still runs
   before 'ready' as @sentry/electron/main requires. */
const Sentry = DSN ? await import("@sentry/electron/main") : null

/* Default on when a DSN is present; the persisted flag (undefined on first run) only ever
   turns it off. Stays false when there's no DSN — telemetryState() reports it as unavailable. */
let enabled = false

/** Drop the two identity fields Sentry attaches by default even with sendDefaultPii off.
    Generic so beforeSend keeps handing back the exact event type it received. */
function scrub<E extends SentryEvent>(event: E): E {
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
  if (!Sentry) return
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

/** Report a dead renderer (render-process-gone) by hand.

    Native renderer crashes never reach the renderer's JS: the ErrorBoundary, captureException,
    and window.onerror are all structurally blind to them, so this is the ONLY channel that can
    surface them. And @sentry/electron's default child-process integration turns only
    `abnormal-exit`/`launch-failed`/`integrity-failure` into events — never `crashed`/`oom` — while
    Windows STATUS_BREAKPOINT (0x80000003) crashes rarely yield an uploadable minidump. So without
    this call these die in incidents.log, invisible. Caller passes only the reasons the default
    integration ignores, so this never double-reports.

    Sent from MAIN (like every other event here — cf. header) and through the same beforeSend, so
    scrub() runs and the opt-out is honored; the early return just avoids building a dropped event.
    Grouped by reason so a recurring crash is one issue with a rate, exit code kept as a tag. */
export function captureRendererGone(
  reason: string,
  exitCode: number,
  info: { recentReloads: number; suspended: boolean }
): void {
  if (!Sentry || !enabled) return
  Sentry.captureMessage(`renderer gone: ${reason}`, {
    level: info.suspended ? "fatal" : "error",
    fingerprint: ["renderer-gone", reason],
    tags: { reason, exit_code: exitCode },
    contexts: { renderer_crash: { reason, exit_code: exitCode, ...info } },
  })
}

/* --- Git failure reporting (spec: docs/superpowers/specs/2026-07-20-git-errors-sentry-design.md) ---

   Two tiers. Every failed git command leaves a BREADCRUMB (addGitBreadcrumb, wired into the
   runner via RunnerContext.onFailure — cf. git/exec.ts): free context on whatever event ships
   next, crash included, never an event itself. Abnormal-but-tolerated failures additionally
   send one EVENT (captureGitError) fingerprinted [scope, code]: a swallowed recovery
   `stash pop`, an unexpected code crossing the IPC boundary (captureIpcError), a non-network
   runOp failure (captureOpError). Everything runs through the beforeSend/beforeBreadcrumb
   gates above — opt-out honored live, DSN-less builds inert — and through sanitizeDetail, so
   no user data (path, URL, branch, email, sha) ever leaves. */

/** Breadcrumb for a failed git command: the verb, never the arguments or stderr. */
export function addGitBreadcrumb(info: GitFailureInfo): void {
  if (!Sentry || !enabled) return
  Sentry.addBreadcrumb({
    category: "git",
    level: "warning",
    message: `${info.verb} failed: ${info.code}`,
    data: { code: info.code, exit_code: info.exitCode, duration_ms: info.ms },
  })
}

/** One event per scope×code per session (repeats keep their breadcrumb), grouped in Sentry
    by that same pair. Level `warning` = tolerated (the app moved on), `error` = the user saw
    the failure. */
export function captureGitError(
  scope: string,
  err: unknown,
  extra?: { level?: "warning" | "error"; verb?: string; auto?: boolean }
): void {
  if (!Sentry || !enabled) return
  const { code, detail } = decodeError(err)
  if (!shouldSend(scope, code)) return
  Sentry.captureMessage(`git: ${scope} [${code}]`, {
    level: extra?.level ?? "warning",
    fingerprint: [scope, code],
    tags: { scope, code },
    contexts: {
      git_error: {
        code,
        verb: extra?.verb,
        detail: detail ? sanitizeDetail(detail) : undefined,
        auto: extra?.auto,
      },
    },
  })
}

/* Codes a healthy app should never produce, whatever the user does: everything else crossing
   the IPC boundary is nominal product behavior (MERGE_CONFLICT, NO_UPSTREAM, ABORTED…) and
   stays out of Sentry. BAD_ARG crossing means the renderer sent garbage — a bug, not noise. */
const UNEXPECTED: ReadonlySet<string> = new Set(["GIT_FAILED", "UNKNOWN", "OUTPUT_LIMIT", "BAD_ARG", "TIMEOUT"])

/** IPC-boundary net (cf. ipc.ts `handle`): fires whether the renderer surfaces the error or
    swallows it into a fallback — the crossing itself is the signal. */
export function captureIpcError(channel: string, err: unknown): void {
  if (!Sentry || !enabled) return
  if (!UNEXPECTED.has(decodeError(err).code)) return
  captureGitError(`ipc.${channel}`, err, { level: "error" })
}

/** runOp failures (fetch/pull/push, cf. git/ops.ts runOp): captured only when they can't be
    blamed on the environment — TIMEOUT on a network op is a slow link, offline is offline,
    and the stderr patterns cover the rest. What remains (corrupt repo, broken remote config)
    is a bug lead even when the auto-fetch that hit it stayed silent. */
export function captureOpError(op: string, err: unknown, auto: boolean): void {
  if (!Sentry || !enabled) return
  const { code, detail } = decodeError(err)
  if (!UNEXPECTED.has(code) || code === "TIMEOUT") return
  if (!net.isOnline()) return
  if (detail && isNetworkNoise(detail)) return
  captureGitError(`op.${op}`, err, { auto })
}

/** `available`: a DSN was baked in — the home screen only shows the toggle then. */
export const telemetryState = (): { available: boolean; enabled: boolean } => ({
  available: !!DSN,
  enabled,
})
