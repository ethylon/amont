/* Disposable config for the preview harness — the real app goes through electron.vite.config.mjs. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { csp } from "./csp.mjs";

const { version } = createRequire(import.meta.url)("./package.json");

export default {
  root: "src/renderer",
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/src") } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  /* Same renderer plugin set as electron.vite.config.mjs — without lingui() the raw
     .po catalogs get served as JS and the harness dies on a syntax error. */
  plugins: [react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }), lingui(), tailwindcss(), csp()],
  server: { port: Number(process.env.PORT) || 5199 },
};
