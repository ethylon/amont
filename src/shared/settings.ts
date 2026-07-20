/* Centralized settings registry — the single source of truth for user-tunable settings.
   Shared by both worlds: the main process reads it (autofetch timer in repos.ts, the fetch
   `--prune` flag and pull integration mode in git/ops.ts) and the renderer reads it (the
   toolbar's Fetch/Pull options cards), so no default is hardcoded twice. Values that used to
   be inline constants (the 5-minute autofetch interval, the always-on `--prune`) now live
   here as descriptor defaults.

   Each setting is described once, by a `Spec`, and everything else is derived from that registry:
   the default object, the runtime coercion of an untrusted persisted/renderer value, and the
   metadata the cards render (interval bounds, preset choices). Adding a setting is one entry.

   Persisted in state.json under `settings` (cf. main/state.ts). `coerceSettings()` rebuilds a
   valid object from anything — a corrupt file, an older shape, a malformed renderer patch —
   exactly as state.ts coerces its own persisted shape, so a bad value can never reach git. */

/** How `git pull` integrates the downloaded commits. The values are the git flags minus their
    leading dashes — `pullModeFlag` rebuilds the flag, so the stored mode, the command main
    runs, and the command the toolbar shows can never drift apart. */
export type PullMode = "ff" | "ff-only" | "rebase"

export interface Settings {
  /** background auto-fetch on a timer; off clears the per-repo interval entirely */
  autoFetch: boolean
  /** delay between two auto-fetches, in minutes (only meaningful while `autoFetch` is on) */
  autoFetchIntervalMin: number
  /** `--prune` on fetch: drop remote-tracking refs whose upstream branch has been deleted */
  prune: boolean
  /** `git pull` integration: fast-forward when possible (merge otherwise), fast-forward only
      (fail when diverged), or rebase onto the fetched branch */
  pullMode: PullMode
}

/** A boolean setting: on/off, one default. */
interface BoolSpec {
  kind: "boolean"
  default: boolean
}

/** An integer setting: clamped to [min, max], with a set of preset choices for the UI. */
interface IntSpec {
  kind: "int"
  default: number
  min: number
  max: number
  /** preset values the settings modal offers as a segmented choice */
  options: readonly number[]
}

/** A pick among fixed string values, offered as radios in the UI. Tied to `PullMode` — the one
    enum setting so far; generalize the value type when a second one appears. */
interface EnumSpec {
  kind: "enum"
  default: PullMode
  options: readonly PullMode[]
}

type Spec = BoolSpec | IntSpec | EnumSpec

/** The registry: one descriptor per setting, keyed by its name. `satisfies` (rather than an
    explicit annotation) checks every `Settings` key is present and correctly shaped while keeping
    each entry's literal type — so the UI can read `autoFetchIntervalMin.options` without a cast. */
export const SETTINGS = {
  autoFetch: { kind: "boolean", default: true },
  autoFetchIntervalMin: { kind: "int", default: 5, min: 1, max: 1440, options: [1, 2, 5, 10, 15, 30, 60] },
  prune: { kind: "boolean", default: true },
  pullMode: { kind: "enum", default: "ff", options: ["ff", "ff-only", "rebase"] },
} satisfies Record<keyof Settings, Spec>

/** Coerce one untrusted value against its spec, falling back to the default when it doesn't fit. */
function coerce(spec: Spec, value: unknown): boolean | number | string {
  if (spec.kind === "boolean") return typeof value === "boolean" ? value : spec.default
  if (spec.kind === "enum") return spec.options.includes(value as PullMode) ? (value as PullMode) : spec.default
  if (typeof value !== "number" || !Number.isFinite(value)) return spec.default
  return Math.min(spec.max, Math.max(spec.min, Math.round(value)))
}

/** Rebuild a fully valid `Settings` from any input (persisted file, renderer patch, `{}`).
    Every key is taken from the registry, so unknown fields are dropped and missing ones default. */
export function coerceSettings(value: unknown): Settings {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const out = {} as Record<keyof Settings, boolean | number | string>
  for (const key of Object.keys(SETTINGS) as (keyof Settings)[]) out[key] = coerce(SETTINGS[key], src[key])
  return out as Settings
}

/** Every setting at its registry default. Derived, not written twice — `coerceSettings({})` picks
    each `default` since no key fits. */
export const SETTINGS_DEFAULTS: Settings = coerceSettings({})

/** The autofetch interval as a timer duration in milliseconds. */
export const autoFetchIntervalMs = (s: Settings): number => s.autoFetchIntervalMin * 60_000

/** The flag a mode passes to `git pull` — mode values are exactly the flag names, so the
    command the toolbar shows and the one git/ops.ts runs derive from the same string. */
export const pullModeFlag = (mode: PullMode): string => `--${mode}`
