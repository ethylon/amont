/* Customization prefs — appearance beyond theme/locale: the UI/mono fonts, the two display
   toggles (prefix column, git commands), the per-theme badge-color overrides, the custom
   prefix→color rules, and the diff extension→grammar map. Presentation only and renderer-owned,
   so it stays out of the main-process settings registry (shared/settings.ts, which drives git);
   persisted as one JSON blob in localStorage.

   Mirrors lib/theme.ts: a module-held live value, a subscriber set, a useSyncExternalStore hook,
   and an apply step that writes CSS custom properties on <html>. Colors are theme-dependent
   (app.css defines distinct light/dark oklch tokens), so `applyCustomization` writes the *active*
   theme's overrides and re-runs on every theme flip (onThemeChange). Fonts route through
   `--amont-font-ui`/`--amont-font-mono` (cf. app.css) so a runtime override reaches the inlined
   font utilities. */

import { useSyncExternalStore } from "react"

import { foldPrefix, prefixColorVar, setCustomPrefixes } from "@/lib/commit-parse"
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

/** A `#rrggbb` value per theme — how a custom prefix stores its badge color (light and dark, like
    the role overrides). */
export type ThemeHex = Record<ThemeKey, string>

/** A file-extension → shiki-grammar mapping row (Settings ▸ Diff): teaches the diff highlighter a
    grammar the bare extension doesn't imply (e.g. mapping `.csproj` to XML). */
export type LangAlias = { ext: string; lang: string }

/** A user prefix → per-theme badge color (Settings ▸ Colors): a `PREFIX:` / `[PREFIX]` commit subject
    the built-in type tables don't recognize still gets a colored badge, its own hue in each theme. */
export type PrefixRule = { prefix: string; colors: ThemeHex }

/** No extension→grammar mappings are shipped by default: the list starts empty and is the user's own
    (Settings ▸ Diff). The set that used to seed it (`.jet` → sql, the MSBuild `.csproj`/`.props`/… →
    xml) were one developer's in-house conventions and shouldn't be imposed on everyone — anyone who
    wants them adds them locally. "Reset to defaults" therefore clears the list back to empty. */
const LANG_ALIASES_DEFAULT: readonly LangAlias[] = []

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
  /** file extension → shiki grammar id for diff syntax highlighting (cf. features/diff) */
  langAliases: LangAlias[]
  /** custom prefix → badge color rules, matched by parseSubject after the built-in type tables */
  prefixRules: PrefixRule[]
}

export const CUSTOMIZATION_DEFAULTS: Customization = {
  fontUi: null,
  fontMono: null,
  monoOnly: false,
  showPrefixColumn: true,
  showGitCommands: true,
  colors: { light: {}, dark: {} },
  langAliases: LANG_ALIASES_DEFAULT.map((a) => ({ ...a })),
  prefixRules: [],
}

const KEY = "amont.customization"
const HEX = /^#[0-9a-fA-F]{6}$/
const EXT = /^[a-z0-9]+$/
const LANG = /^[a-z0-9#+.-]+$/

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
  /* No default seed: a non-array (older shape, corrupt) yields an empty list, same as a user who
     deleted every mapping. Blank/malformed rows are dropped and the list is capped, same defensive
     posture as the color map above. */
  const langAliases = (v: unknown): LangAlias[] => {
    if (!Array.isArray(v)) return LANG_ALIASES_DEFAULT.map((a) => ({ ...a }))
    const out: LangAlias[] = []
    for (const item of v) {
      if (out.length >= 100 || !item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      const ext = typeof rec.ext === "string" ? rec.ext.trim().toLowerCase().replace(/^\.+/, "") : ""
      const lang = typeof rec.lang === "string" ? rec.lang.trim().toLowerCase() : ""
      if (EXT.test(ext) && LANG.test(lang)) out.push({ ext, lang })
    }
    return out
  }
  const themeHex = (v: unknown): ThemeHex | null => {
    if (!v || typeof v !== "object") return null
    const rec = v as Record<string, unknown>
    const one = (x: unknown) => (typeof x === "string" && HEX.test(x) ? x.toLowerCase() : null)
    const light = one(rec.light)
    const dark = one(rec.dark)
    return light && dark ? { light, dark } : null
  }
  const prefixRules = (v: unknown): PrefixRule[] => {
    if (!Array.isArray(v)) return []
    const out: PrefixRule[] = []
    for (const item of v) {
      if (out.length >= 100 || !item || typeof item !== "object") continue
      const rec = item as Record<string, unknown>
      const prefix = typeof rec.prefix === "string" ? rec.prefix.trim() : ""
      const colors = themeHex(rec.colors)
      if (prefix && colors) out.push({ prefix: prefix.slice(0, 40), colors })
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
    langAliases: langAliases(src.langAliases),
    prefixRules: prefixRules(src.prefixRules),
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

/* Registries the render layer reads WITHOUT React — the imperative graph and the diff highlighter —
   are refreshed here on every change: the badge-color rules go into commit-parse's table, and the
   extension→grammar map is memoized (rebuilt lazily) alongside a cheap signature the diff hooks use
   as an effect dependency so an open diff re-highlights when the mapping changes. */
let langAliasMap: Record<string, string> | null = null
let langAliasSig = ""
/* The `--amont-prefix-*` custom properties currently written on <html>, so applyCustomization can
   clear the ones a removed rule left behind. */
let appliedPrefixVars = new Set<string>()

function syncDerived(): void {
  langAliasMap = null
  langAliasSig = JSON.stringify(current.langAliases)
  setCustomPrefixes(current.prefixRules.map((r) => r.prefix))
}
syncDerived()

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

  const theme = isDark() ? "dark" : "light"
  const overrides = current.colors[theme]
  for (const role of COLOR_ROLES) {
    const hex = overrides[role]
    if (hex) style.setProperty(ROLE_VAR[role], hex)
    else style.removeProperty(ROLE_VAR[role])
  }

  /* Custom prefix colors ride their own `--amont-prefix-<key>` var, written for the active theme —
     so a badge painted once (imperative graph) follows theme flips and live edits without a rebuild.
     Vars for prefixes that went away are cleared so a deleted rule leaves nothing behind. */
  const nextVars = new Set<string>()
  for (const rule of current.prefixRules) {
    if (!foldPrefix(rule.prefix)) continue
    const name = prefixColorVar(rule.prefix)
    style.setProperty(name, rule.colors[theme])
    nextVars.add(name)
  }
  for (const name of appliedPrefixVars) if (!nextVars.has(name)) style.removeProperty(name)
  appliedPrefixVars = nextVars
}

/* Colors are theme-scoped: a light↔dark flip must swap which override set is live. Re-applying the
   fonts at the same time is a harmless no-op. */
onThemeChange(applyCustomization)

function commit(next: Customization): void {
  current = next
  syncDerived()
  persist()
  applyCustomization()
  listeners.forEach((f) => f())
}

/** Patch the flat fields (fonts, toggles). Colors, lang aliases and prefix rules go through the
    dedicated helpers below. */
export function setCustomization(patch: Partial<Omit<Customization, "colors" | "langAliases" | "prefixRules">>): void {
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

/** Reset the flat fields (fonts + toggles) to defaults; colors, lang aliases and prefix rules each
    keep their own section-level reset. */
export function resetCustomization(): void {
  commit({
    ...CUSTOMIZATION_DEFAULTS,
    colors: current.colors,
    langAliases: current.langAliases,
    prefixRules: current.prefixRules,
  })
}

/* --- Lang aliases (Settings ▸ Diff) --- */

/** Replace the extension→grammar list. */
export function setLangAliases(aliases: LangAlias[]): void {
  commit({ ...current, langAliases: aliases })
}

/** Clear the extension→grammar list back to its default — empty (no mappings ship by default). */
export function resetLangAliases(): void {
  commit({ ...current, langAliases: LANG_ALIASES_DEFAULT.map((a) => ({ ...a })) })
}

/* --- Prefix rules (Settings ▸ Colors) --- */

/** Replace the custom prefix→color rules. */
export function setPrefixRules(rules: PrefixRule[]): void {
  commit({ ...current, prefixRules: rules })
}

/** Clear every custom prefix rule. */
export function resetPrefixRules(): void {
  commit({ ...current, prefixRules: [] })
}

/* --- Getters for non-React consumers (the imperative graph render, the diff highlighter) --- */
export const getShowPrefixColumn = (): boolean => current.showPrefixColumn
export const getShowGitCommands = (): boolean => current.showGitCommands

/** Effective extension → shiki grammar map, memoized until the next change. Blank rows are skipped;
    on a duplicate extension the later row wins. */
export function getLangAliases(): Record<string, string> {
  if (langAliasMap) return langAliasMap
  const map: Record<string, string> = {}
  for (const a of current.langAliases) {
    const ext = a.ext.trim().toLowerCase().replace(/^\.+/, "")
    const lang = a.lang.trim().toLowerCase()
    if (ext && lang) map[ext] = lang
  }
  return (langAliasMap = map)
}

/** A cheap signature of the lang-alias map, for the diff hooks' effect dependencies. */
export const getLangAliasSig = (): string => langAliasSig

/* --- React hooks --- */
export function useCustomization(): Customization {
  return useSyncExternalStore(onCustomizationChange, getCustomization)
}

export function useShowGitCommands(): boolean {
  return useSyncExternalStore(onCustomizationChange, getShowGitCommands)
}

/** Subscribe to lang-alias changes as a stable string: an open diff re-highlights when the mapping
    changes without re-running its effect on unrelated customization edits (colors, fonts). */
export function useLangAliasSig(): string {
  return useSyncExternalStore(onCustomizationChange, getLangAliasSig)
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

let neutralCache: ThemeHex | null = null

/** The gray badge hue of an unlabelled / `chore`-type commit (`--muted-foreground`), read for both
    themes — the color a freshly-added custom prefix starts from. Same class-toggle probe as
    defaultColorHexes; memoized since the stylesheet default doesn't change. */
export function neutralPrefixHexes(): ThemeHex {
  if (neutralCache) return neutralCache
  const root = document.documentElement
  const wasDark = root.classList.contains("dark")
  const read = () => toHex(getComputedStyle(root).getPropertyValue("--muted-foreground").trim())
  root.classList.remove("dark")
  const light = read()
  root.classList.add("dark")
  const dark = read()
  root.classList.toggle("dark", wasDark)
  return (neutralCache = { light, dark })
}

/** Resolve any CSS color string (oklch, rgb, named…) to `#rrggbb`. Rasterise on a canvas: the 2D
    context resolves every CSS color down to sRGB bytes. `getComputedStyle().color` can't stand in —
    Chromium leaves an oklch color in `oklch(…)` form there, and the tokens are authored in oklch. */
function toHex(color: string): string {
  const ctx = document.createElement("canvas").getContext("2d")
  if (!ctx) return "#000000"
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
  const h = (n: number) => n.toString(16).padStart(2, "0")
  return `#${h(r)}${h(g)}${h(b)}`
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
