import { useSyncExternalStore } from "react"

const media = matchMedia("(prefers-color-scheme: dark)")

/** Le choix explicite prime ; sans choix, on suit l'OS. */
export const isDark = () => (localStorage.getItem("gg.theme") ?? (media.matches ? "dark" : "light")) === "dark"

const listeners = new Set<() => void>()

/** Notifié à chaque bascule (choix explicite ou suivi OS) : les rendus hors classe CSS s'y raccrochent. */
export function onThemeChange(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** Le preset shadcn pilote le thème par la classe `.dark` sur `<html>`. */
export function applyTheme() {
  document.documentElement.classList.toggle("dark", isDark())
  listeners.forEach((f) => f())
}

export function setDark(dark: boolean) {
  localStorage.setItem("gg.theme", dark ? "dark" : "light")
  applyTheme()
}

/* sans préférence enregistrée, `isDark()` relit l'OS : la bascule système reste suivie */
media.addEventListener("change", applyTheme)

/** Hook partagé (AUDIT.md §5, item 7) : tout consommateur du thème passe par lui plutôt que de
    recopier `isDark` dans un state local (désync garantie sur un flip OS non explicite, cf.
    l'ancien bug de tab-strip, fix Phase 0). */
export function useTheme(): boolean {
  return useSyncExternalStore(onThemeChange, isDark)
}
