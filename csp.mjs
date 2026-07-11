/* @vitejs/plugin-react injects the react-refresh preamble as an inline <script>: without
   'unsafe-inline' the renderer won't boot in dev. The relaxation is confined to the dev
   server, the production CSP stays the same as before this migration. */
/* img-src data: file shell icons arrive as a data URL from app.getFileIcon.
   gravatar / githubusercontent: author avatars, the only outgoing requests (cf. lib/avatar.ts). */
const IMG = "img-src 'self' data: https://*.gravatar.com https://avatars.githubusercontent.com";
/* object-src/base-uri/form-action 'none' (AUDIT.md §4, hardening): no embedded plugin,
   no legitimate <base> tag, no <form> in the app — closing these three doors costs
   nothing and reduces the surface of a compromised renderer (hostile diff content). */
const HARDEN = "object-src 'none'; base-uri 'none'; form-action 'none'";
/* No 'wasm-unsafe-eval': the diff view's syntax highlighting uses shiki's pure-JS regex engine
   (features/diff/shiki-highlighter.ts), not the WASM oniguruma engine — dropping the full
   `shiki` package for `shiki/core` removed the one thing that needed this directive. */
const PROD = `default-src 'self'; ${IMG}; ${HARDEN}; style-src 'self' 'unsafe-inline'; script-src 'self'`;
const DEV = `default-src 'self'; ${IMG}; ${HARDEN}; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'`;

/** @returns {import('vite').Plugin} */
export const csp = () => ({
  name: "amont-csp",
  transformIndexHtml: {
    order: "pre",
    handler: (html, ctx) => html.replace("%CSP%", ctx.server ? DEV : PROD),
  },
});
