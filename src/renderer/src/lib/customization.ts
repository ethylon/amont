/* Customization prefs — appearance beyond theme/locale: the UI/mono fonts, the two display
   toggles (prefix column, git commands), and the per-theme badge-color overrides. Presentation
   only and renderer-owned, so it stays out of the main-process settings registry
   (shared/settings.ts, which drives git); persisted as one JSON blob in localStorage.

   Mirrors lib/theme.ts: a module-held live value, a subscriber set, a useSyncExternalStore hook,
   and an apply step that writes CSS custom properties on <html>. Colors are theme-dependent
   (app.css defines distinct light/dark oklch tokens), so `applyCustomization` writes the *active*
   theme's overrides and re-runs on every theme flip (onThemeChange). Fonts route through
   `--amont-font-ui`/`--amont-font-mono` (cf. app.css) so a runtime override reaches the inlined
   font utilities. */

import { useSyncExternalStore } from "react"

import { isDark, onThemeChange } from "@/lib/theme"

/** Editable badge hues, surfaced to the user as feature / bugfix / hotfix / release / info /
    refactor / polish. `danger` is the shadcn `--destructive` token; the rest are amont's own. */
export type ColorRole = "success" | "warning" | "danger" | "release" | "info" | "refactor" | "polish"

export const COLOR_ROLES: readonly ColorRole[] = [
  "success",
  "warning",
  "danger",
  "release",
  "info",
  "refactor",
  "polish",
]

/** role → the app.css custom property carrying its hue. */
const ROLE_VAR: Record<ColorRole, string> = {
  success: "--success",
  warning: "--warning",
  danger: "--destructive",
  release: "--release",
  info: "--info",
  refactor: "--refactor",
  polish: "--polish",
}

export type ThemeKey = "light" | "dark"
type ColorMap = Partial<Record<ColorRole, string>>

export interface Customization {
  /** UI (sans) font family; `null` = the bundled default (Geist) */
  fontUi: string | null
  /** monospace font family; `null` = the bundled default (Geist Mono) */
  fontMono: string | null
  /** restrict the mono picker to monospace families */
  monoOnly: boolean
  /** detect a `feat:`/`[TAG]` prefix and lift it into its own graph column */
  showPrefixColumn: boolean
  /** show the underlying git command as subtext on actions (cf. components/ui/git-cmd) */
  showGitCommands: boolean
  /** per-theme hex overrides of the badge hues; a missing entry = the app.css default */
  colors: Record<ThemeKey, ColorMap>
}

export const CUSTOMIZATION_DEFAULTS: Customization = {
  fontUi: null,
  fontMono: null,
  monoOnly: false,
  showPrefixColumn: true,
  showGitCommands: true,
  colors: { light: {}, dark: {} },
}

const KEY = "amont.customization"
const HEX = /^#[0-9a-fA-F]{6}$/

/** Rebuild a valid Customization from any stored value (older shape, corrupt, `null`) — same
    defensive posture as coerceSettings in shared/settings.ts. */
function coerce(value: unknown): Customization {
  const src = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null)
  const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d)
  const colorMap = (v: unknown): ColorMap => {
    const out: ColorMap = {}
    if (v && typeof v === "object") {
      for (const role of COLOR_ROLES) {
        const hex = (v as Record<string, unknown>)[role]
        if (typeof hex === "string" && HEX.test(hex)) out[role] = hex.toLowerCase()
      }
    }
    return out
  }
  const colors = src.colors && typeof src.colors === "object" ? (src.colors as Record<string, unknown>) : {}
  return {
    fontUi: str(src.fontUi),
    fontMono: str(src.fontMono),
    monoOnly: bool(src.monoOnly, CUSTOMIZATION_DEFAULTS.monoOnly),
    showPrefixColumn: bool(src.showPrefixColumn, CUSTOMIZATION_DEFAULTS.showPrefixColumn),
    showGitCommands: bool(src.showGitCommands, CUSTOMIZATION_DEFAULTS.showGitCommands),
    colors: { light: colorMap(colors.light), dark: colorMap(colors.dark) },
  }
}

function load(): Customization {
  try {
    const raw = localStorage.getItem(KEY)
    return coerce(raw ? JSON.parse(raw) : null)
  } catch {
    return coerce(null)
  }
}

let current: Customization = load()

export const getCustomization = (): Customization => current

const listeners = new Set<() => void>()

export function onCustomizationChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    /* quota/full disk: the live value still holds for this session */
  }
}

/** Quote a family name for a CSS font-family value / canvas font (installed families often have
    spaces); strip quotes and backslashes so the value can't break out of the string. */
const quote = (family: string) => `"${family.replace(/["\\]/g, "")}"`

/** Apply the current customization to <html>: the font override vars plus the active theme's color
    overrides. Idempotent — each field is set or removed — so it's safe to call on every change. */
export function applyCustomization(): void {
  const { style } = document.documentElement
  if (current.fontUi) style.setProperty("--amont-font-ui", quote(current.fontUi))
  else style.removeProperty("--amont-font-ui")
  if (current.fontMono) style.setProperty("--amont-font-mono", quote(current.fontMono))
  else style.removeProperty("--amont-font-mono")

  const overrides = current.colors[isDark() ? "dark" : "light"]
  for (const role of COLOR_ROLES) {
    const hex = overrides[role]
    if (hex) style.setProperty(ROLE_VAR[role], hex)
    else style.removeProperty(ROLE_VAR[role])
  }
}

/* Colors are theme-scoped: a light↔dark flip must swap which override set is live. Re-applying the
   fonts at the same time is a harmless no-op. */
onThemeChange(applyCustomization)

function commit(next: Customization): void {
  current = next
  persist()
  applyCustomization()
  listeners.forEach((f) => f())
}

/** Patch the flat fields (fonts, toggles). Colors go through the dedicated helpers below. */
export function setCustomization(patch: Partial<Omit<Customization, "colors">>): void {
  commit({ ...current, ...patch })
}

/** Set one role's hex override for a theme. */
export function setColor(theme: ThemeKey, role: ColorRole, hex: string): void {
  commit({
    ...current,
    colors: { ...current.colors, [theme]: { ...current.colors[theme], [role]: hex.toLowerCase() } },
  })
}

/** Clear one role (or, with no role, the whole theme) back to the app.css default. */
export function resetColor(theme: ThemeKey, role?: ColorRole): void {
  if (!role) {
    commit({ ...current, colors: { ...current.colors, [theme]: {} } })
    return
  }
  const next = { ...current.colors[theme] }
  delete next[role]
  commit({ ...current, colors: { ...current.colors, [theme]: next } })
}

/** Reset the flat fields (fonts + toggles) to defaults; colors keep their own reset. */
export function resetCustomization(): void {
  commit({ ...CUSTOMIZATION_DEFAULTS, colors: current.colors })
}

/* --- Getters for non-React consumers (the imperative graph render) --- */
export const getShowPrefixColumn = (): boolean => current.showPrefixColumn
export const getShowGitCommands = (): boolean => current.showGitCommands

/* --- React hooks --- */
export function useCustomization(): Customization {
  return useSyncExternalStore(onCustomizationChange, getCustomization)
}

export function useShowGitCommands(): boolean {
  return useSyncExternalStore(onCustomizationChange, getShowGitCommands)
}

/* --- Default hex read-back (for the native color inputs) --- */

let defaultsCache: Record<ThemeKey, Record<ColorRole, string>> | null = null

/** Hex of each role for both themes as authored in app.css, read once with any live override
    stripped and both theme classes probed. `<input type=color>` needs a `#rrggbb`, and the tokens
    are oklch — so we let the browser resolve each to rgb, then hex. Synchronous (no paint between
    the class toggles), and memoized since the stylesheet defaults don't change. */
export function defaultColorHexes(): Record<ThemeKey, Record<ColorRole, string>> {
  if (defaultsCache) return defaultsCache
  const root = document.documentElement
  const saved = COLOR_ROLES.map((r) => [ROLE_VAR[r], root.style.getPropertyValue(ROLE_VAR[r])] as const)
  for (const [v] of saved) root.style.removeProperty(v)
  const wasDark = root.classList.contains("dark")
  const read = (): Record<ColorRole, string> =>
    Object.fromEntries(
      COLOR_ROLES.map((r) => [r, toHex(getComputedStyle(root).getPropertyValue(ROLE_VAR[r]).trim())])
    ) as Record<ColorRole, string>
  root.classList.remove("dark")
  const light = read()
  root.classList.add("dark")
  const dark = read()
  root.classList.toggle("dark", wasDark)
  for (const [v, val] of saved) if (val) root.style.setProperty(v, val)
  defaultsCache = { light, dark }
  return defaultsCache
}

/** Effective hex of a role for a theme: the override if set, otherwise the app.css default. */
export function colorHex(theme: ThemeKey, role: ColorRole): string {
  return current.colors[theme][role] ?? defaultColorHexes()[theme][role]
}

/** Resolve any CSS color string (oklch, rgb, named…) to `#rrggbb` via a throwaway element. */
function toHex(color: string): string {
  const probe = document.createElement("span")
  probe.style.color = color
  probe.style.display = "none"
  document.body.appendChild(probe)
  const rgb = getComputedStyle(probe).color
  probe.remove()
  const parts = rgb.match(/\d+(?:\.\d+)?/g)?.map(Number) ?? [0, 0, 0]
  const h = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0")
  return `#${h(parts[0])}${h(parts[1])}${h(parts[2])}`
}

/* --- System fonts (Local Font Access API) --- */

/** `window.queryLocalFonts` is Electron/Chromium-only and gated by the `local-fonts` permission
    (granted in main/window.ts). Absent in the mock browser harness or when denied → returns [],
    and the picker falls back to showing just the current value. When `monoOnly`, keep only families
    that measure as monospace. */
export async function listFonts(monoOnly: boolean): Promise<string[]> {
  const query = (window as unknown as { queryLocalFonts?: () => Promise<Array<{ family: string }>> }).queryLocalFonts
  if (!query) return []
  let fonts: Array<{ family: string }>
  try {
    fonts = await query.call(window)
  } catch {
    return []
  }
  const families = [...new Set(fonts.map((f) => f.family))].sort((a, b) => a.localeCompare(b))
  return monoOnly ? families.filter(isMonospace) : families
}

/** Monospace test: the API exposes no generic-family flag, so probe glyph advance — a font is
    monospace iff a narrow and a wide glyph render at the same width (two pairs, to be safe). */
const monoCache = new Map<string, boolean>()
let probeCtx: CanvasRenderingContext2D | null = null

function isMonospace(family: string): boolean {
  const cached = monoCache.get(family)
  if (cached !== undefined) return cached
  probeCtx ??= document.createElement("canvas").getContext("2d")
  let mono = false
  if (probeCtx) {
    probeCtx.font = `32px ${quote(family)}`
    const w = (s: string) => probeCtx!.measureText(s).width
    mono = w("i") === w("W") && w("l") === w("m")
  }
  monoCache.set(family, mono)
  return mono
}
