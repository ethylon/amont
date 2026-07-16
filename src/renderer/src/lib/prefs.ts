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
  /** theme mode; a legacy `null` (pre-tri-state builds) reads as "system" (cf. lib/theme.ts) */
  theme: pref<"light" | "dark" | "system">("amont.theme"),
  /** explicit UI language; `null` = follow the system language (cf. lib/i18n.ts) */
  locale: pref<"en" | "fr">("amont.locale"),
  diffView: pref<DiffViewMode>("amont.diffview"),
  fileView: pref<FileView>("amont.fileview"),
  /** last choices of the flow finish banner; `null` = defaults (merge --no-ff, delete) */
  flowFinishMode: pref<"merge" | "rebase">("amont.flowfinish.mode"),
  flowFinishBranch: pref<"delete" | "keep">("amont.flowfinish.branch"),
}
