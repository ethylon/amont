import { defineConfig } from "@lingui/cli"
import { formatter } from "@lingui/format-po"

/* i18n catalogs (cf. src/renderer/src/lib/messages.ts — the single string catalogue).
   `lingui extract` scans the renderer for t`` / plural() macros and writes one PO file per
   locale under src/renderer/src/locales; the Vite plugin compiles those PO files at build. */
export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "fr"],
  catalogs: [
    {
      path: "src/renderer/src/locales/{locale}",
      include: ["src/renderer/src"],
    },
  ],
  format: formatter({ origins: false }),
})
