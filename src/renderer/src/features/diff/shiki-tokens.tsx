/* Shared shiki tokenization for the line-based views (conflict panes, working-tree staging
   diff): one hook per document, plain-text fallback on unknown grammar. Everything goes
   through a dynamic import of shiki-highlighter.ts — importing ANYTHING statically from it
   would pull shiki into the initial bundle and defeat its lazy load. */

import { useEffect, useState } from "react"

/* Same aliases as diff-view's: in-house extensions -> shiki grammar; MSBuild files are XML. */
const LANG_ALIASES: Record<string, string> = {
  jet: "sql",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  slnx: "xml",
  svg: "xml",
}

export function langOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
  return LANG_ALIASES[ext] || ext
}

export type TokenLine = { content: string; color?: string }[]

/** Shiki tokens for one document, or null while loading / for an unknown grammar (the caller
    then renders plain — same fallback policy as the diff view). Tokens are NOT cleared while a
    new highlight is computing, so consumers don't flash the code back to plain. */
export function useShikiTokens(code: string, path: string, dark: boolean): TokenLine[] | null {
  const [tokens, setTokens] = useState<TokenLine[] | null>(null)
  useEffect(() => {
    const lang = langOf(path)
    if (!lang || lang === "txt") {
      setTokens(null)
      return
    }
    let live = true
    void (async () => {
      try {
        const { codeToTokens, getHighlighter } = await import("@/features/diff/shiki-highlighter")
        const highlighter = await getHighlighter()
        const res = codeToTokens(highlighter, code, { lang, theme: dark ? "github-dark" : "github-light" })
        if (live) setTokens(res.tokens)
      } catch {
        /* unknown grammar: stay plain */
      }
    })()
    return () => {
      live = false
    }
  }, [code, path, dark])
  return tokens
}

/** One rendered code line: shiki spans when tokens are there, raw text otherwise. */
export function CodeLine({ text, tokens }: { text: string; tokens?: TokenLine }) {
  if (!tokens || !tokens.some((t) => t.content)) return <>{text || " "}</>
  return tokens.map((t, i) => (
    <span key={i} style={{ color: t.color }}>
      {t.content}
    </span>
  ))
}
