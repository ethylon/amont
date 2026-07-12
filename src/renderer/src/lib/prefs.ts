/* Preferences persisted in localStorage (AUDIT.md §7, phase 5): the `amont.*` keys used to be
   scattered, written and re-read ad hoc across three different modules (theme.ts, repo-store.tsx,
   file-list.tsx) — a key name that drifts between read and write only shows up at runtime,
   silently. Centralized here, a key that changes name or type is caught at compile time
   everywhere it's used. */

import type { DiffViewMode } from "@/features/diff/diff-view"
import type { FileView } from "@/features/repo/file-list"

function pref<T extends string>(key: string) {
  return {
    get: (): T | null => localStorage.getItem(key) as T | null,
    set: (v: T) => localStorage.setItem(key, v),
  }
}

export const prefs = {
  /** explicit theme choice; `null` = no choice made, follow the OS (cf. lib/theme.ts) */
  theme: pref<"dark" | "light">("amont.theme"),
  diffView: pref<DiffViewMode>("amont.diffview"),
  fileView: pref<FileView>("amont.fileview"),
}
