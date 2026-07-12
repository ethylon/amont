import { useSyncExternalStore } from "react"

import { prefs } from "@/lib/prefs"

/** Tri-state: an explicit `light`/`dark`, or `system` — follow the OS and react to its changes. */
export type ThemeMode = "light" | "dark" | "system"

const media = matchMedia("(prefers-color-scheme: dark)")

/** The stored mode; a legacy `null` (pre-tri-state) means "follow the OS", i.e. `system`. */
export const getTheme = (): ThemeMode => prefs.theme.get() ?? "system"

/** Effective darkness: `system` defers to the OS, an explicit choice wins outright. */
export const isDark = () => {
  const mode = getTheme()
  return mode === "system" ? media.matches : mode === "dark"
}

const listeners = new Set<() => void>()

/** Notified on every change (explicit choice or OS follow): renders outside the CSS class hook into this. */
export function onThemeChange(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** The shadcn preset drives the theme via the `.dark` class on `<html>`. */
export function applyTheme() {
  document.documentElement.classList.toggle("dark", isDark())
  listeners.forEach((f) => f())
}

/** Persist a mode and repaint. `system` re-defers to the OS from now on. */
export function setTheme(mode: ThemeMode) {
  prefs.theme.set(mode)
  applyTheme()
}

/** Binary escape hatch kept for the tab-strip's quick toggle: sets an explicit light/dark. */
export function setDark(dark: boolean) {
  setTheme(dark ? "dark" : "light")
}

/* with `system` (or no stored preference), `isDark()` reads the OS again: a system toggle is still followed */
media.addEventListener("change", applyTheme)

/** Shared hook (AUDIT.md §5, item 7): every theme consumer goes through it rather than
    copying `isDark` into local state (guaranteed desync on a non-explicit OS flip, see
    the old tab-strip bug, fixed in Phase 0). */
export function useTheme(): boolean {
  return useSyncExternalStore(onThemeChange, isDark)
}

/** The chosen mode (for the tri-state Theme menu), reactive to explicit changes and OS follows. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(onThemeChange, getTheme)
}
