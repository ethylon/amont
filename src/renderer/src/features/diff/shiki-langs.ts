/* The shiki grammar ids this app ships, mirrored from shiki-highlighter.ts's `langLoaders` keys.
   Kept in its own tiny, dependency-free module so the settings UI can offer them as choices WITHOUT
   importing shiki-highlighter.ts — that module statically imports `shiki/core`, and pulling it into
   the settings/entry bundle would defeat the whole lazy-load design (cf. shiki-highlighter.ts
   header). shiki-highlighter.ts type-checks its loader table against this list, so the two can't
   silently drift: add a grammar here and its loader becomes mandatory there. */
export const SHIKI_LANGS = [
  "bash",
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "diff",
  "dockerfile",
  "go",
  "graphql",
  "html",
  "ini",
  "java",
  "javascript",
  "json",
  "jsonc",
  "jsx",
  "kotlin",
  "less",
  "lua",
  "markdown",
  "perl",
  "php",
  "powershell",
  "python",
  "r",
  "ruby",
  "rust",
  "scala",
  "scss",
  "shellscript",
  "sql",
  "svelte",
  "swift",
  "toml",
  "tsx",
  "typescript",
  "vue",
  "xml",
  "yaml",
] as const

export type ShikiLang = (typeof SHIKI_LANGS)[number]
