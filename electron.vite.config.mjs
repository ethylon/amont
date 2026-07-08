import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { csp } from './csp.mjs';

const alias = { '@': resolve(import.meta.dirname, 'src/renderer/src') };

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    resolve: { alias },
    plugins: [react(), tailwindcss(), csp()],
  },
});
