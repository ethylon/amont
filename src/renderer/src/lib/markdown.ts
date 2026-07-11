/* Markdown du corps de commit (AUDIT.md §7, phase 5 — anciennement lib/commit-message.ts).
   Sous-ensemble réellement écrit dans un message de commit : paragraphes, puces, `code`,
   **gras**, *italique*, URLs nues. Le parseur ne rend que des données : aucun HTML n'est injecté.
   No headings, no tables, no fenced code blocks — pull in a real markdown dependency the day
   one of those is actually missing. */

export type MdKind = "text" | "code" | "bold" | "em" | "link"
export type MdToken = { t: MdKind; v: string }
export type MdBlock = { kind: "p"; tokens: MdToken[] } | { kind: "ul"; items: MdToken[][] }

/* `(?<![*\w])` : l'italique ne coupe pas un `a*b*c`. Un `*` en tête de ligne est déjà une puce. */
const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|(?<![*\w])\*([^*]+)\*(?!\*)|(https?:\/\/[^\s<>()]+)/g
const BULLET = /^\s*[-*+]\s+(.*)/

function tokenize(s: string): MdToken[] {
  const out: MdToken[] = []
  const push = (t: MdKind, v: string) => void (v && out.push({ t, v }))
  let last = 0
  for (const m of s.matchAll(INLINE)) {
    push("text", s.slice(last, m.index))
    push(m[1] ? "code" : m[2] ? "bold" : m[3] ? "em" : "link", m[1] ?? m[2] ?? m[3] ?? m[4])
    last = m.index + m[0].length
  }
  push("text", s.slice(last))
  return out
}

export function parseMarkdown(text: string): MdBlock[] {
  const blocks: MdBlock[] = []
  let para: string[] = []
  let items: string[] = []

  /* une ligne vide, ou le passage puce ↔ paragraphe, ferme le bloc courant */
  const flush = () => {
    if (para.length) blocks.push({ kind: "p", tokens: tokenize(para.join("\n")) })
    if (items.length) blocks.push({ kind: "ul", items: items.map(tokenize) })
    para = []
    items = []
  }

  for (const line of text.split("\n")) {
    const m = BULLET.exec(line)
    if (m) {
      if (para.length) flush()
      items.push(m[1])
    } else if (!line.trim()) flush()
    else {
      if (items.length) flush()
      para.push(line)
    }
  }
  flush()
  return blocks
}
