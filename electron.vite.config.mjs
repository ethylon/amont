import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { csp } from "./csp.mjs";

const alias = { "@": resolve(import.meta.dirname, "src/renderer/src") };

export default defineConfig({
  main: {},
  /* CJS, not ESM: an ESM preload forces `sandbox: false` (cf. webPreferences in main) */
  preload: { build: { rollupOptions: { output: { format: "cjs" } } } },
  renderer: {
    resolve: { alias },
    /* crash.html: the fallback page for the crash-reload cap (cf. main). Separate entry
       so it ends up in out/renderer — resources/ isn't bundled into the asar. */
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/renderer/index.html"),
          crash: resolve(import.meta.dirname, "src/renderer/crash.html"),
        },
      },
    },
    /* lingui() compiles the PO catalogs on import; the babel macro rewrites t``/plural()
       into i18n calls (cf. lib/messages.ts). */
    plugins: [react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }), lingui(), tailwindcss(), csp()],
  },
});
