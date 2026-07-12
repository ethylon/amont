/* i18n activation (cf. lib/messages.ts — the string catalogue). The app follows the system
   language: French systems get `fr`, everything else falls back to `en`. There is no in-app
   language switcher — locale is fixed for the session, chosen once at boot before the first
   render so every string getter reads the right language from the first paint. */

import { i18n } from "@lingui/core"
import { messages as en } from "@/locales/en.po"
import { messages as fr } from "@/locales/fr.po"

export type Locale = "en" | "fr"

const catalogs: Record<Locale, typeof en> = { en, fr }

/** System language → a supported locale. */
export function pickLocale(): Locale {
  const lang = (typeof navigator !== "undefined" ? navigator.language : "en").toLowerCase()
  return lang.startsWith("fr") ? "fr" : "en"
}

/** Load the catalogs and activate the system locale. Call once, before the first render. */
export function setupI18n(): void {
  i18n.load(catalogs)
  i18n.activate(pickLocale())
}
