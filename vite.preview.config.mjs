/* Config jetable pour le harnais de preview — l'app réelle passe par electron.vite.config.mjs. */
import tailwindcss from '@tailwindcss/vite';

export default {
  root: 'src/renderer',
  plugins: [tailwindcss()],
  server: { port: 5199, strictPort: true },
};
