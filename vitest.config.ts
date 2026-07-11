/* Config vitest (AUDIT.md §4/§10, item tests). Tous les modules testés ici sont des modules
   purs, exécutables sous Node tel quel (parsers du main, algo de layout, sha256, parseur de
   messages de commit) — un seul environnement suffit, pas besoin de jsdom. */
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
})
