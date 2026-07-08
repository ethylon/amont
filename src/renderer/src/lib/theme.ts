const media = matchMedia("(prefers-color-scheme: dark)")

/** Le choix explicite prime ; sans choix, on suit l'OS. */
export const isDark = () => (localStorage.getItem("gg.theme") ?? (media.matches ? "dark" : "light")) === "dark"

/** Le preset shadcn pilote le thème par la classe `.dark` sur `<html>`. */
export function applyTheme() {
  document.documentElement.classList.toggle("dark", isDark())
}

export function setDark(dark: boolean) {
  localStorage.setItem("gg.theme", dark ? "dark" : "light")
  applyTheme()
}

/* sans préférence enregistrée, `isDark()` relit l'OS : la bascule système reste suivie */
media.addEventListener("change", applyTheme)
