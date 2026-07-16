// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://amont.dev",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "fr"],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [
    sitemap({
      // Mirror the on-page hreflang tags in the sitemap so Google gets the
      // en/fr pairing from both sources.
      i18n: {
        defaultLocale: "en",
        locales: { en: "en", fr: "fr" },
      },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    server: {
      // Screenshots and the app icon are imported straight from the repository's
      // own ../docs and ../resources, so the README and the site can never drift.
      fs: { allow: [".."] },
    },
  },
});
