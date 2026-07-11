/* Fine-grained shiki bundle (AUDIT.md §9): the full `shiki` package eagerly pulls in every
   bundled grammar plus the WASM oniguruma engine, which is what forces `'wasm-unsafe-eval'`
   into the production CSP (csp.mjs). `shiki/core` + the pure-JS regex engine
   (`shiki/engine/javascript`, no WASM) with an explicit, finite language list gets the same
   tokenization for the languages this app actually renders diffs of, without either cost.
   Loaded lazily (dynamic import, cf. diff-view.tsx) so it never touches the initial bundle.

   Each language is its own literal `import("shiki/langs/xxx.mjs")` rather than a single
   `LANGS.map(lang => import(\`shiki/langs/${lang}.mjs\`))`: a template-literal specifier can't be
   resolved by Vite's dev-server transform for a bare (node_modules) specifier — only Rollup's
   production bundler can enumerate it ahead of time — so it silently fails to load any grammar
   under `pnpm dev`/`pnpm mock` while still working in a packaged build. Literal strings resolve
   identically in both. */

import { codeToTokens, createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

export { codeToTokens }

/* Canonical shiki language ids for the file types this app is realistically asked to diff.
   Shiki resolves common short aliases (js, ts, py, rb, sh, yml, md, cs, kt…) against these
   grammars on its own — LANG_ALIASES in diff-view.tsx only covers the handful of extensions
   with no standard alias (MSBuild project files, an in-house `.jet` extension). Add a language
   here (and, if needed, an entry to LANG_ALIASES) the day a diff needs one that's missing;
   an unrecognized language already falls back to plain text (cf. diff-view.tsx's shikiPass). */
const langLoaders = [
  () => import("shiki/langs/typescript.mjs"),
  () => import("shiki/langs/tsx.mjs"),
  () => import("shiki/langs/javascript.mjs"),
  () => import("shiki/langs/jsx.mjs"),
  () => import("shiki/langs/json.mjs"),
  () => import("shiki/langs/jsonc.mjs"),
  () => import("shiki/langs/css.mjs"),
  () => import("shiki/langs/scss.mjs"),
  () => import("shiki/langs/less.mjs"),
  () => import("shiki/langs/html.mjs"),
  () => import("shiki/langs/xml.mjs"),
  () => import("shiki/langs/yaml.mjs"),
  () => import("shiki/langs/markdown.mjs"),
  () => import("shiki/langs/python.mjs"),
  () => import("shiki/langs/java.mjs"),
  () => import("shiki/langs/csharp.mjs"),
  () => import("shiki/langs/cpp.mjs"),
  () => import("shiki/langs/c.mjs"),
  () => import("shiki/langs/go.mjs"),
  () => import("shiki/langs/rust.mjs"),
  () => import("shiki/langs/ruby.mjs"),
  () => import("shiki/langs/php.mjs"),
  () => import("shiki/langs/sql.mjs"),
  () => import("shiki/langs/shellscript.mjs"),
  () => import("shiki/langs/bash.mjs"),
  () => import("shiki/langs/dockerfile.mjs"),
  () => import("shiki/langs/graphql.mjs"),
  () => import("shiki/langs/vue.mjs"),
  () => import("shiki/langs/svelte.mjs"),
  () => import("shiki/langs/toml.mjs"),
  () => import("shiki/langs/ini.mjs"),
  () => import("shiki/langs/diff.mjs"),
  () => import("shiki/langs/powershell.mjs"),
  () => import("shiki/langs/kotlin.mjs"),
  () => import("shiki/langs/swift.mjs"),
  () => import("shiki/langs/scala.mjs"),
  () => import("shiki/langs/perl.mjs"),
  () => import("shiki/langs/lua.mjs"),
  () => import("shiki/langs/r.mjs"),
  () => import("shiki/langs/dart.mjs"),
]

let highlighterPromise: Promise<HighlighterCore> | null = null

/** Singleton: created once on the first diff, reused for every diff after that. */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [import("shiki/themes/github-dark.mjs"), import("shiki/themes/github-light.mjs")],
    langs: langLoaders.map((load) => load()),
    engine: createJavaScriptRegexEngine(),
  })
  return highlighterPromise
}
