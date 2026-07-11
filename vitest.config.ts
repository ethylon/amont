/* Vitest config (AUDIT.md §4/§10, tests item). Every module tested here is a pure
   module, runnable under Node as-is (main's parsers, layout algorithm, sha256, commit-message
   parser) — a single environment is enough, no need for jsdom. */
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
