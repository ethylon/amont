/* Config jetable pour le harnais de preview — l'app réelle passe par electron.vite.config.mjs. */
import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { csp } from './csp.mjs';

export default {
  root: 'src/renderer',
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer/src') } },
  plugins: [react(), tailwindcss(), csp()],
  server: { port: 5199, strictPort: true },
};
