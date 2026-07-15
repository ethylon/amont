/* User settings, main side (cf. shared/settings.ts — the registry, and state.ts — persistence).
   Holds the single live copy every consumer reads: repos.ts arms the autofetch timer from it,
   git/ops.ts reads `prune` at fetch time. Same shape as telemetry.ts: an in-memory value applied
   from the persisted state after loadState(), mutated through one setter that persists and notifies.

   `onChange` lets ipc.ts re-arm the open repos' timers when the autofetch settings move, without
   this module importing repos.ts (which would cycle: repos.ts already reads getSettings()). */

import { coerceSettings, SETTINGS_DEFAULTS, type Settings } from "../shared/settings.ts"
import { persisted, saveState } from "./state.ts"

let current: Settings = SETTINGS_DEFAULTS

/** Apply the persisted settings once loadState() has run (before any repo opens, cf. index.ts).
    Coerces the stored value into a valid shape — a corrupt or older file falls back to defaults. */
export function loadSettings(): void {
  current = coerceSettings(persisted.settings)
}

/** The live settings. Read on every autofetch tick and every fetch, so a change takes effect at once. */
export const getSettings = (): Settings => current

let onChange: ((s: Settings) => void) | null = null

/** Notified after each `setSettings`, so the caller (ipc.ts) can react — re-arm the timers. */
export function onSettingsChange(fn: (s: Settings) => void): void {
  onChange = fn
}

/** Merge a partial patch, coerce the result to a valid `Settings`, persist it, and notify.
    Coercion runs on the merged object, so a malformed field from the renderer can never land. */
export function setSettings(patch: Partial<Settings>): Promise<void> {
  current = coerceSettings({ ...current, ...patch })
  persisted.settings = current
  onChange?.(current)
  return saveState()
}
