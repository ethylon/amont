/* @vitejs/plugin-react injecte le préambule react-refresh en <script> inline : sans
   'unsafe-inline' le renderer ne démarre pas en dev. La détente est cantonnée au serveur
   de dev, la CSP de production reste celle d'avant la migration. */
/* img-src data: : les icônes shell des fichiers arrivent en data URL depuis app.getFileIcon. */
const PROD = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'";
const DEV = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'";

export const csp = () => ({
  name: 'gg-csp',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, ctx) => html.replace('%CSP%', ctx.server ? DEV : PROD),
  },
});
