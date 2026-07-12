/* Vitest config (AUDIT.md §4/§10, tests item). Every module tested here is a pure
   module, runnable under Node as-is (main's parsers, layout algorithm, sha256, commit-message
   parser) — a single environment is enough, no need for jsdom. */
import { resolve } from "node:path"

import { defineConfig } from "vitest/config"

export default defineConfig({
  /* Mirrors the `@` alias of electron.vite.config.mjs so renderer modules with runtime
     `@/…` imports (e.g. lib/avatar.ts) resolve under vitest, not just type-only ones. */
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/src") } },
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
})
