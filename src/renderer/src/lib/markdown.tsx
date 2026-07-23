/* Markdown for the commit body (AUDIT.md §7, phase 5 — formerly lib/commit-message.ts).
   The subset actually written in a commit message: paragraphs, bullets, `code`,
   **bold**, *italic*, bare URLs. The parser only produces data: no HTML is ever injected.
   No headings, no tables, no fenced code blocks — pull in a real markdown dependency the day
   one of those is actually missing. */

export type MdKind = "text" | "code" | "bold" | "em" | "link"
export type MdToken = { t: MdKind; v: string }
export type MdBlock = { kind: "p"; tokens: MdToken[] } | { kind: "ul"; items: MdToken[][] }

/* `(?<![*\w])`: italics don't cut through an `a*b*c`. A `*` at the start of a line is already a bullet. */
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

  /* a blank line, or switching bullet ↔ paragraph, closes the current block */
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

/* URLs go out to the browser: `setWindowOpenHandler` refuses navigation within the window. */
export const Inline = ({ tokens }: { tokens: MdToken[] }) => (
  <>
    {tokens.map((k, i) =>
      k.t === "code" ? (
        <code key={i} className="rounded-sm bg-muted px-1 font-mono">
          {k.v}
        </code>
      ) : k.t === "bold" ? (
        <strong key={i} className="font-medium text-foreground">
          {k.v}
        </strong>
      ) : k.t === "em" ? (
        <em key={i}>{k.v}</em>
      ) : k.t === "link" ? (
        <a key={i} href={k.v} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {k.v}
        </a>
      ) : (
        k.v
      )
    )}
  </>
)

export const Markdown = ({ text }: { text: string }) => (
  <>
    {parseMarkdown(text).map((b, i) =>
      b.kind === "p" ? (
        <p key={i} className="whitespace-pre-wrap text-pretty">
          <Inline tokens={b.tokens} />
        </p>
      ) : (
        <ul key={i} className="list-disc space-y-0.5 ps-4 text-pretty">
          {b.items.map((it, j) => (
            <li key={j}>
              <Inline tokens={it} />
            </li>
          ))}
        </ul>
      )
    )}
  </>
)
