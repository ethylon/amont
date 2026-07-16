/* Build statique du harnais embarqué par le site (hero interactif) : le vrai renderer
   contre le faux bridge de embed.html, émis dans site/public/embed/. Même jeu de
   plugins que vite.preview.config.mjs ; base relative pour être servi sous /embed/. */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { lingui } from "@lingui/vite-plugin";
import { csp } from "./csp.mjs";

const { version } = createRequire(import.meta.url)("./package.json");

export default {
  root: "src/renderer",
  base: "./",
  resolve: { alias: { "@": resolve(import.meta.dirname, "src/renderer/src") } },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react({ babel: { plugins: ["@lingui/babel-plugin-lingui-macro"] } }), lingui(), tailwindcss(), csp()],
  build: {
    outDir: resolve(import.meta.dirname, "site/public/embed"),
    emptyOutDir: true,
    rollupOptions: { input: resolve(import.meta.dirname, "src/renderer/embed.html") },
  },
};
