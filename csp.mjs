/* @vitejs/plugin-react injecte le préambule react-refresh en <script> inline : sans
   'unsafe-inline' le renderer ne démarre pas en dev. La détente est cantonnée au serveur
   de dev, la CSP de production reste celle d'avant la migration. */
/* img-src data: : les icônes shell des fichiers arrivent en data URL depuis app.getFileIcon.
   gravatar / githubusercontent : les avatars d'auteur, seules requêtes sortantes (cf. lib/avatar.ts). */
const IMG = "img-src 'self' data: https://*.gravatar.com https://avatars.githubusercontent.com";
/* object-src/base-uri/form-action 'none' (AUDIT.md §4, durcissement) : aucun plugin embarqué,
   aucune balise <base> légitime, aucun <form> dans l'app — fermer ces trois portes ne coûte
   rien et réduit la surface d'un renderer compromis (contenu de diff hostile). */
const HARDEN = "object-src 'none'; base-uri 'none'; form-action 'none'";
const PROD = `default-src 'self'; ${IMG}; ${HARDEN}; style-src 'self' 'unsafe-inline'; script-src 'self' 'wasm-unsafe-eval'`;
const DEV = `default-src 'self'; ${IMG}; ${HARDEN}; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'`;

/** @returns {import('vite').Plugin} */
export const csp = () => ({
  name: 'gg-csp',
  transformIndexHtml: {
    order: 'pre',
    handler: (html, ctx) => html.replace('%CSP%', ctx.server ? DEV : PROD),
  },
});
