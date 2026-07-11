import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { csp } from './csp.mjs';

const alias = { '@': resolve(import.meta.dirname, 'src/renderer/src') };

export default defineConfig({
  main: {},
  /* CJS, pas ESM : un preload ESM force `sandbox: false` (cf. webPreferences dans main) */
  preload: { build: { rollupOptions: { output: { format: 'cjs' } } } },
  renderer: {
    resolve: { alias },
    /* crash.html : la page de repli du plafond de crash-reload (cf. main). Entrée séparée
       pour qu'elle sorte dans out/renderer — resources/ n'est pas embarqué dans l'asar. */
    build: {
      rollupOptions: {
        input: {
          index: resolve(import.meta.dirname, 'src/renderer/index.html'),
          crash: resolve(import.meta.dirname, 'src/renderer/crash.html'),
        },
      },
    },
    plugins: [react(), tailwindcss(), csp()],
  },
});
