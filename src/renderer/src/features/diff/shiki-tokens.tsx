/* Shared shiki tokenization for the line-based views (conflict panes, working-tree staging
   diff): one hook per document, plain-text fallback on unknown grammar. Everything goes
   through a dynamic import of shiki-highlighter.ts — importing ANYTHING statically from it
   would pull shiki into the initial bundle and defeat its lazy load. */

import { useEffect, useState } from "react"

import { getLangAliases, useLangAliasSig } from "@/lib/customization"

/* Extension → shiki grammar now comes from the user-editable map (Settings ▸ Diff, seeded with the
   in-house extensions that used to be hardcoded here — `.csproj` → xml, `.jet` → sql). */
export function langOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
  return getLangAliases()[ext] || ext
}

export type TokenLine = { content: string; color?: string }[]

/** Shiki tokens for one document, or null while loading / for an unknown grammar (the caller
    then renders plain — same fallback policy as the diff view). Tokens are NOT cleared while a
    new highlight is computing, so consumers don't flash the code back to plain. */
export function useShikiTokens(code: string, path: string, dark: boolean): TokenLine[] | null {
  const [tokens, setTokens] = useState<TokenLine[] | null>(null)
  /* Re-highlight when the extension→grammar map changes (a stable signature, so unrelated
     customization edits don't retrigger the tokenizer). */
  const langSig = useLangAliasSig()
  useEffect(() => {
    const lang = langOf(path)
    if (!lang || lang === "txt") {
      setTokens(null)
      return
    }
    /* An AbortController rather than a bare "ignore the result" flag: tokenize() checks the
       signal between its ~200-line slices, so a superseded run stops doing the work, not just
       stops publishing it (audit §23 — fast file switching used to keep tokenizing for DOM
       that was already gone). */
    const abort = new AbortController()
    void (async () => {
      try {
        const { tokenize } = await import("@/features/diff/shiki-highlighter")
        const res = await tokenize(code, lang, dark ? "github-dark" : "github-light", abort.signal)
        /* null = unknown grammar (stay plain) or aborted (a newer run owns the state) */
        if (res && !abort.signal.aborted) setTokens(res)
      } catch {
        /* grammar/theme load failure: stay plain */
      }
    })()
    return () => abort.abort()
  }, [code, path, dark, langSig])
  return tokens
}

/** One rendered code line: shiki spans when tokens are there, raw text otherwise. */
export function CodeLine({ text, tokens }: { text: string; tokens?: TokenLine }) {
  if (!tokens || !tokens.some((t) => t.content)) return <>{text || " "}</>
  /* tokens can lag the text (async tokenize, debounced in the conflict editor): painting
     stale token content would visibly replace what was just typed under the caret. Tokens
     are only used while they still spell the exact current text — otherwise the line stays
     plain until the next pass catches up. */
  if (tokens.reduce((acc, t) => acc + t.content, "") !== text) return <>{text || " "}</>
  return tokens.map((t, i) => (
    <span key={i} style={{ color: t.color }}>
      {t.content}
    </span>
  ))
}
