import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { csp } from "./csp.mjs";

const alias = { "@": resolve(import.meta.dirname, "src/renderer/src") };
/* the running version, surfaced to the renderer (Help ▸ About) as a compile-time constant */
const { version } = createRequire(import.meta.url)("./package.json");

/* Source maps for readable Sentry stack traces. Gated on SENTRY_AUTH_TOKEN — set only for
   official release builds (cf. .github/workflows/release.yml), the same builds that bake in the
   DSN. `hidden` emits a .map next to each bundle but leaves no sourceMappingURL comment in the
   shipped code; the plugin stamps a matching debug ID into the bundle and its map, uploads the
   maps (release `amont@<version>`, matching main/telemetry.ts so events resolve against them),
   then deletes them so no source ships in the binary. No token → nothing generated or uploaded,
   so contributors' and unofficial builds are unaffected. */
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN;
const sourcemap = sentryAuthToken ? "hidden" : false;
const sentry = (dir) =>
  sentryAuthToken
    ? [
        sentryVitePlugin({
          org: "ethylon",
          project: "amont",
          authToken: sentryAuthToken,
          release: { name: `amont@${version}` },
          sourcemaps: { filesToDeleteAfterUpload: [`out/${dir}/**/*.map`] },
        }),
      ]
    : [];

export default defineConfig({
  main: { build: { sourcemap }, plugins: sentry("main") },
  /* CJS, not ESM: an ESM preload forces `sandbox: false` (cf. webPreferences in main) */
  preload: { build: { sourcemap, rollupOptions: { output: { format: "cjs" } } }, plugins: sentry("preload") },
  renderer: {
    resolve: { alias },
    define: { __APP_VERSION__: JSON.stringify(version) },
    /* crash.html: the fallback page for the crash-reload cap (cf. main). Separate entry
       so it ends up in out/renderer — resources/ isn't bundled into the asar. */
    build: {
      sourcemap,
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, "src/renderer/index.html"),
          crash: resolve(import.meta.dirname, "src/renderer/crash.html"),
        },
      },
    },
    /* lingui() compiles the PO catalogs on import; the babel macro rewrites t``/plural()
       into i18n calls (cf. lib/messages.ts). */
    plugins: [
      react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }),
      lingui(),
      tailwindcss(),
      csp(),
      ...sentry("renderer"),
    ],
  },
});
