/* Préférences persistées en localStorage (AUDIT.md §7, phase 5) : les clés `gg.*` étaient
   éparpillées, écrites et relues à l'appel dans trois modules différents (theme.ts,
   repo-store.tsx, file-list.tsx) — un nom de clé qui diverge entre lecture et écriture se
   découvre en runtime, silencieusement. Centralisées ici, une clé qui change de nom ou de type
   se détecte à la compilation partout où elle est utilisée. */

import type { DiffViewMode } from "@/features/diff/diff-view"
import type { FileView } from "@/features/repo/file-list"

function pref<T extends string>(key: string) {
  return {
    get: (): T | null => localStorage.getItem(key) as T | null,
    set: (v: T) => localStorage.setItem(key, v),
  }
}

export const prefs = {
  /** choix explicite de thème ; `null` = pas de choix, suivre l'OS (cf. lib/theme.ts) */
  theme: pref<"dark" | "light">("gg.theme"),
  diffView: pref<DiffViewMode>("gg.diffview"),
  fileView: pref<FileView>("gg.fileview"),
}
