import { useSyncExternalStore } from "react"

import { prefs } from "@/lib/prefs"

const media = matchMedia("(prefers-color-scheme: dark)")

/** An explicit choice takes priority; with no choice, follow the OS. */
export const isDark = () => (prefs.theme.get() ?? (media.matches ? "dark" : "light")) === "dark"

const listeners = new Set<() => void>()

/** Notified on every toggle (explicit choice or OS follow): renders outside the CSS class hook into this. */
export function onThemeChange(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** The shadcn preset drives the theme via the `.dark` class on `<html>`. */
export function applyTheme() {
  document.documentElement.classList.toggle("dark", isDark())
  listeners.forEach((f) => f())
}

export function setDark(dark: boolean) {
  prefs.theme.set(dark ? "dark" : "light")
  applyTheme()
}

/* with no stored preference, `isDark()` reads the OS again: a system toggle is still followed */
media.addEventListener("change", applyTheme)

/** Shared hook (AUDIT.md §5, item 7): every theme consumer goes through it rather than
    copying `isDark` into local state (guaranteed desync on a non-explicit OS flip, see
    the old tab-strip bug, fixed in Phase 0). */
export function useTheme(): boolean {
  return useSyncExternalStore(onThemeChange, isDark)
}
