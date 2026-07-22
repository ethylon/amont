/* Framework-free DOM machinery under the diff2html render path: shiki coloring on top of
   the diff2html output, the plain raw fallback past the line cap, and the side-by-side
   scroll sync. Everything here paints into the diff body element owned by diff-view.tsx. */

import { DIFF_MAX_LINES } from "../../../shared/diff.ts"
import { getLangAliases } from "@/lib/customization"
import { messages } from "@/lib/messages"
import { isDark } from "@/lib/theme"

/* Reapplied on every render — the effects rewrite `className` from top to bottom. */
export const DIFF_BODY =
  "amont-diffbody min-h-0 flex-auto overflow-auto rounded-md font-mono text-xs leading-normal [tab-size:4]"

/* Shiki coloring on top of the diff2html render.
   <ins>/<del> segments (word-diff) are preserved by redistributing the tokens.
   The highlighter (shiki/core + the JS regex engine, cf. shiki-highlighter.ts) is loaded
   dynamically here — its own module graph never touches the app's initial bundle.
   `signal` comes from the owning effect: tokenization yields to the event loop between
   slices (cf. shiki-highlighter.ts tokenize), so by the time a slice finishes the effect
   may have re-run and `body` may be detached — the abort check stops the pass instead of
   tokenizing and painting DOM nobody is looking at (audit §23). */
export async function shikiPass(body: HTMLElement, signal: AbortSignal) {
  let lang = body.querySelector(".d2h-file-wrapper")?.getAttribute("data-lang")
  if (!lang || lang === "txt") return
  lang = getLangAliases()[lang] || lang
  const ctns = [...body.querySelectorAll<HTMLElement>(".d2h-code-line-ctn")]
  if (!ctns.length) return

  /* Side-by-side renders two independent panes (.d2h-file-side-diff): old on the left, new
     on the right. Shiki is a stateful tokenizer — an unterminated string, comment, template
     literal or JSX element carries grammar state from one line to the next — so each pane
     must be tokenized on its own, from a clean state. Concatenating them feeds the old
     pane's text ahead of the new pane's, leaking the boundary state into the right column
     and mis-coloring all of it. Group the containers by their owning pane and tokenize each
     group separately; unified mode has no side panes, so every line falls in one group. */
  const groups = new Map<Element | null, HTMLElement[]>()
  for (const ctn of ctns) {
    const side = ctn.closest(".d2h-file-side-diff")
    let group = groups.get(side)
    if (!group) groups.set(side, (group = []))
    group.push(ctn)
  }

  try {
    const { tokenize } = await import("@/features/diff/shiki-highlighter")
    const theme = isDark() ? "github-dark" : "github-light"
    for (const group of groups.values()) {
      /* One await per pane document: painting only happens once the whole group's tokens are
         in, so a pane is either fully colored or untouched — never striped mid-slice. */
      const lines = await tokenize(group.map((e) => e.textContent).join("\n"), lang, theme, signal)
      if (!lines || signal.aborted) return // unknown grammar (same for every group) or stale run
      group.forEach((ctn, i) => paintLine(ctn, lines[i]))
    }
  } catch {
    return // grammar / theme load failure: stay plain
  }
}

/* Repaint one line container with its shiki tokens, preserving any <ins>/<del> word-diff
   segments by redistributing the tokens across (and around) them. */
export function paintLine(ctn: HTMLElement, tokens: { content: string; color?: string }[] | undefined) {
  if (!tokens || !tokens.length) return
  const marks: { start: number; end: number; shell: Node; el: HTMLElement | null }[] = []
  let off = 0
  for (const n of ctn.childNodes) {
    const len = n.textContent!.length
    if (n.nodeType === 1 && ((n as Element).tagName === "INS" || (n as Element).tagName === "DEL"))
      marks.push({ start: off, end: off + len, shell: n.cloneNode(false), el: null })
    off += len
  }
  ctn.textContent = ""
  let pos = 0
  for (const t of tokens) {
    let local = 0
    while (local < t.content.length) {
      const abs = pos + local
      const mark = marks.find((m) => abs >= m.start && abs < m.end)
      const limit = mark ? mark.end : Math.min(...marks.filter((m) => m.start > abs).map((m) => m.start), Infinity)
      const end = Math.min(t.content.length, limit - pos)
      const span = document.createElement("span")
      span.style.color = t.color!
      span.textContent = t.content.slice(local, end)
      if (mark) {
        if (!mark.el) {
          mark.el = mark.shell as HTMLElement
          ctn.appendChild(mark.el)
        }
        mark.el.appendChild(span)
      } else {
        ctn.appendChild(span)
      }
      local = end
    }
    pos += t.content.length
  }
}

const RAW_CLASS: Record<string, string> = {
  meta: "text-muted-foreground",
  hunk: "pt-1 text-primary",
  add: "bg-success/16",
  del: "bg-destructive/16",
  ctx: "",
}

/* Past DIFF_MAX_LINES: plain, uncolored rendering — diff2html chokes, and nobody reads a diff
   that big anyway. `text` is already capped main-side (at most a slack past the cap, cf.
   shared/diff.ts); `totalLines` is the true length of the full output, so the footer count
   stays exact even though the tail never crossed IPC. */
export function renderRaw(body: HTMLElement, text: string, totalLines: number) {
  const lines = text.split("\n")
  body.textContent = ""
  body.className = DIFF_BODY + " bg-muted py-1.5"
  /* `w-max min-w-full` (cf. diff-body SCROLL_ROWS): every row stretches to the widest
     line, so the add/del tints span the whole scroll width instead of stopping at the pane
     edge on the shorter lines once scrolled sideways. */
  const rows = document.createElement("div")
  rows.className = "w-max min-w-full"
  body.appendChild(rows)
  lines.slice(0, DIFF_MAX_LINES).forEach((l) => {
    const kind = /^(diff |index |new file|deleted file|similarity|rename |--- |\+\+\+ )/.test(l)
      ? "meta"
      : l.startsWith("@@")
        ? "hunk"
        : l[0] === "+"
          ? "add"
          : l[0] === "-"
            ? "del"
            : "ctx"
    const d = document.createElement("div")
    d.className = "px-2 whitespace-pre " + RAW_CLASS[kind]
    d.textContent = l || " "
    rows.appendChild(d)
  })
  if (totalLines > DIFF_MAX_LINES) {
    const more = document.createElement("div")
    more.className = "px-2 text-muted-foreground"
    more.textContent = messages.diff.truncated((totalLines - DIFF_MAX_LINES).toLocaleString())
    rows.appendChild(more)
  }
}

/* Side by side: d2h gives each pane its own `overflow-x`. The two facing lines only stay
   aligned if the panes advance together — and the panes' native scrollbars sit at the bottom
   of the whole file render, below the fold for anything taller than the pane, so they are
   hidden and replaced by one shared bar stuck to the body's bottom edge (same construction
   as diff-body's SyncedColumns: the spacer sizes the bar's range to the widest pane's,
   keeping the plain scrollLeft mirroring exact). */
export function syncSides(body: HTMLElement) {
  const sides = [...body.querySelectorAll<HTMLElement>(".d2h-file-side-diff")]
  if (sides.length < 2) return
  for (const s of sides) s.style.scrollbarWidth = "none"
  const bar = document.createElement("div")
  bar.className = "sticky bottom-0 z-10 overflow-x-auto bg-background"
  /* 1px tall, not 0: Chromium leaves a zero-height box out of the scrollable overflow,
     which would zero the bar's range */
  const spacer = document.createElement("div")
  spacer.className = "h-px"
  bar.appendChild(spacer)
  body.appendChild(bar)
  const fit = () => {
    const range = Math.max(0, ...sides.map((s) => s.scrollWidth - s.clientWidth))
    bar.style.display = range > 0 ? "" : "none"
    spacer.style.width = `calc(100% + ${range}px)`
  }
  const ro = new ResizeObserver(fit)
  for (const s of sides) {
    ro.observe(s)
    if (s.firstElementChild) ro.observe(s.firstElementChild)
  }
  fit()
  const scrollers = [...sides, bar]
  let echo = false
  const onScroll = (ev: Event) => {
    if (echo) return
    echo = true
    const src = ev.currentTarget as HTMLElement
    for (const s of scrollers) if (s !== src) s.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => (echo = false))
  }
  scrollers.forEach((s) => s.addEventListener("scroll", onScroll))
  return () => {
    ro.disconnect()
    bar.remove()
    scrollers.forEach((s) => s.removeEventListener("scroll", onScroll))
  }
}
