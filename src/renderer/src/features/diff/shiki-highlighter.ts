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
   identically in both.

   Grammars load per language on demand (`ensureLang`): the highlighter core is created with
   both themes but zero langs, so the first diff pays one grammar fetch+parse instead of ~40.

   Tokenization goes through `tokenize()` exclusively: it chunks the document ~200 lines at a
   time, yielding the renderer thread between slices — a 3 000-line document no longer freezes
   the UI for the whole regex pass — and it LRU-caches whole-document results keyed on
   (theme, lang, content), so re-tokenizing the same text (theme flip back, view remount)
   is free. */

import {
  codeToTokensBase,
  createHighlighterCore,
  getLastGrammarState,
  type GrammarState,
  type HighlighterCore,
  type LanguageRegistration,
  type ThemedToken,
} from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"

/* Canonical shiki language ids for the file types this app is realistically asked to diff,
   each mapped to its lazy grammar loader. Add a language here (and, if needed, an entry to
   LANG_ALIASES in diff-view.tsx) the day a diff needs one that's missing; an unrecognized
   language already falls back to plain text (cf. diff-view.tsx's shikiPass). */
const langLoaders: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  shellscript: () => import("shiki/langs/shellscript.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
}

/* Shiki resolves short aliases (js, ts, py, rb, sh, yml, md, cs, kt…) from the `aliases`
   field INSIDE each grammar's registration — which only exists once that grammar is loaded.
   With on-demand loading nothing is loaded when the alias arrives, so the alias → canonical-id
   mapping has to live here, mirrored from the grammar files' own declarations. */
const SHIKI_ALIASES: Record<string, string> = {
  ts: "typescript",
  cts: "typescript",
  mts: "typescript",
  js: "javascript",
  cjs: "javascript",
  mjs: "javascript",
  yml: "yaml",
  md: "markdown",
  py: "python",
  cs: "csharp",
  "c#": "csharp",
  "c++": "cpp",
  rs: "rust",
  rb: "ruby",
  gql: "graphql",
  sh: "shellscript",
  shell: "shellscript",
  zsh: "shellscript",
  properties: "ini",
  ps: "powershell",
  ps1: "powershell",
  kt: "kotlin",
  kts: "kotlin",
}

let highlighterPromise: Promise<HighlighterCore> | null = null

/** Singleton: created once on the first diff, reused for every diff after that. */
export function getHighlighter(): Promise<HighlighterCore> {
  /* Reset the cached promise on failure: a once-rejected promise would otherwise be handed
     out forever, leaving every future diff permanently plain after one transient chunk-load
     hiccup. The next diff retries from scratch instead. */
  highlighterPromise ??= createHighlighterCore({
    themes: [import("shiki/themes/github-dark.mjs"), import("shiki/themes/github-light.mjs")],
    langs: [], // grammars load per language on demand, cf. ensureLang
    engine: createJavaScriptRegexEngine(),
  }).catch((err: unknown) => {
    highlighterPromise = null
    throw err
  })
  return highlighterPromise
}

/* One load per grammar, shared across concurrent callers (the two side-by-side panes ask for
   the same language at the same time). A failed fetch is evicted so it can be retried — same
   policy as the highlighter promise above. */
const langLoads = new Map<string, Promise<void>>()

/** Resolve `lang` to its canonical grammar id and make sure that grammar is registered on the
    highlighter, fetching it on first use. Returns null for a language this app doesn't ship —
    the caller renders plain, exactly like the old eager-load fallback. */
async function ensureLang(highlighter: HighlighterCore, lang: string): Promise<string | null> {
  const id = langLoaders[lang] ? lang : SHIKI_ALIASES[lang]
  if (!id) return null
  let load = langLoads.get(id)
  if (!load) {
    load = highlighter.loadLanguage(langLoaders[id]())
    load.catch(() => langLoads.delete(id))
    langLoads.set(id, load)
  }
  await load
  return id
}

export type ShikiTheme = "github-dark" | "github-light"

/* ~200 lines per slice keeps each synchronous tokenization burst well under a frame budget
   for typical code while still finishing a 3 000-line document in ~15 turns. */
const CHUNK_LINES = 200
const CACHE_MAX = 20

/* Whole-document LRU keyed on (theme, lang, content): the strings are shared with the
   documents already held by the views, and the cap keeps at most ~20 token arrays alive.
   Map iterates in insertion order, so refreshing an entry on hit and evicting the first
   key IS the LRU policy. */
const tokenCache = new Map<string, ThemedToken[][]>()

/* Yield the renderer thread between slices so input/paint stay live mid-tokenization.
   `scheduler.yield()` (Chromium ≥ 129 — present in this Electron) resumes ahead of other
   queued tasks; `setTimeout(0)` is the fallback for runtimes without it. */
function yieldToMain(): Promise<void> {
  const sched = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof sched?.yield === "function") return sched.yield()
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Tokenize one whole document, chunked and cached. Returns one token line per input line,
    or null when the language is unknown (caller stays plain) or `signal` aborted mid-flight
    (caller's DOM is gone — stop burning the tokenizer, audit §23). Grammar state is carried
    across slices via shiki's `GrammarState` (an unterminated string / comment / template
    literal at a slice boundary colors the next slice correctly), so the output is identical
    to a single synchronous pass. */
export async function tokenize(
  code: string,
  lang: string,
  theme: ShikiTheme,
  signal?: AbortSignal
): Promise<ThemedToken[][] | null> {
  const highlighter = await getHighlighter()
  const id = await ensureLang(highlighter, lang)
  if (!id || signal?.aborted) return null
  const key = `${theme}\u0000${id}\u0000${code}`
  const hit = tokenCache.get(key)
  if (hit) {
    tokenCache.delete(key)
    tokenCache.set(key, hit)
    return hit
  }
  const lines = code.split("\n")
  const out: ThemedToken[][] = []
  let state: GrammarState | undefined
  for (let at = 0; at < lines.length; at += CHUNK_LINES) {
    if (at > 0) {
      await yieldToMain()
      if (signal?.aborted) return null
    }
    const slice = lines.slice(at, at + CHUNK_LINES).join("\n")
    const tokens = codeToTokensBase(highlighter, slice, { lang: id, theme, grammarState: state })
    state = getLastGrammarState(highlighter, tokens)
    for (const line of tokens) out.push(line)
  }
  tokenCache.set(key, out)
  if (tokenCache.size > CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value!)
  return out
}
