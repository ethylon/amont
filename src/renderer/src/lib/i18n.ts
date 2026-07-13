/* i18n activation (cf. lib/messages.ts — the string catalogue). The language is chosen at boot
   from a persisted choice, falling back to the system language (French systems get `fr`,
   everything else `en`), and can be switched at runtime from the View menu: `setLocale` re-reads
   the active locale into every `messages` getter and notifies subscribers so the tree re-renders. */

import { useSyncExternalStore } from "react"
import { i18n } from "@lingui/core"

import { messages as en } from "@/locales/en.po"
import { messages as fr } from "@/locales/fr.po"
import { prefs } from "@/lib/prefs"

export type Locale = "en" | "fr"

export const LOCALES: Locale[] = ["en", "fr"]

const catalogs: Record<Locale, typeof en> = { en, fr }

/** Persisted choice → else system language → a supported locale. */
export function pickLocale(): Locale {
  const stored = prefs.locale.get()
  if (stored && LOCALES.includes(stored)) return stored
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase()
  return lang.startsWith("fr") ? "fr" : "en"
}

/** Load the catalogs and activate the boot locale. Call once, before the first render. */
export function setupI18n(): void {
  i18n.load(catalogs)
  i18n.activate(pickLocale())
}

const listeners = new Set<() => void>()

/** Notified on every runtime language switch. */
export function onLocaleChange(cb: () => void) {
  listeners.add(cb)
  return () => void listeners.delete(cb)
}

/** The currently active locale. */
export const getLocale = (): Locale => i18n.locale as Locale

/** Switch language at runtime: persist, re-activate (getters re-read on next render), and notify
    so a subscriber at the App root re-renders the tree. */
export function setLocale(locale: Locale): void {
  if (!LOCALES.includes(locale) || locale === i18n.locale) return
  prefs.locale.set(locale)
  i18n.activate(locale)
  listeners.forEach((f) => f())
}

/** Reactive active locale (drives the Language menu checkmark and the tree re-render). */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale)
}
