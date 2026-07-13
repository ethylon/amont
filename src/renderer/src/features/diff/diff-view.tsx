import { useEffect, useMemo, useRef, useState } from "react"
import { html as d2hHtml } from "diff2html"
import { ColorSchemeType, OutputFormatType } from "diff2html/lib/types"
import "diff2html/bundles/css/diff2html.min.css"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Cancel01Icon,
  Image01Icon,
  LayoutTwoColumnIcon,
  MenuSquareIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi } from "@/lib/git"
import { parseUnifiedDiff } from "@/features/diff/diff-parse"
import { useDiffQuery } from "@/features/diff/diff-queries"
import { WtDiffBody } from "@/features/diff/wt-diff-body"
import { imageExt, isTextImage } from "@/features/diff/image-diff-queries"
import { ImageDiffView } from "@/features/diff/image-diff-view"
import { messages } from "@/lib/messages"
import { isDark, useTheme } from "@/lib/theme"
import { AsyncHint } from "@/components/ui/async-hint"
import { IconButton } from "@/components/ui/icon-button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** Named `DiffViewMode` (not `DiffView`) to avoid colliding with the identically named
    React component below (AUDIT.md §7, phase 5, item 6). */
export type DiffViewMode = "unified" | "sbs"
/** A context carries either a pair of commits, or the source within the working tree. */
export type DiffCtx = { hash: string; parent: string | null } | { wt: "staged" | "unstaged" | "untracked" }

const MAX_LINES = 3000
/* Reapplied on every render — the effects rewrite `className` from top to bottom. */
const DIFF_BODY =
  "amont-diffbody min-h-0 flex-auto overflow-auto rounded-md font-mono text-xs leading-normal [tab-size:4]"

/* in-house extensions -> shiki grammar; MSBuild project/props files are XML */
const LANG_ALIASES: Record<string, string> = {
  jet: "sql",
  csproj: "xml",
  props: "xml",
  targets: "xml",
  slnx: "xml",
  svg: "xml",
}

/* Shiki coloring on top of the diff2html render.
   <ins>/<del> segments (word-diff) are preserved by redistributing the tokens.
   The highlighter (shiki/core + the JS regex engine, cf. shiki-highlighter.ts) is loaded
   dynamically here — its own module graph never touches the app's initial bundle. */
async function shikiPass(body: HTMLElement) {
  let lang = body.querySelector(".d2h-file-wrapper")?.getAttribute("data-lang")
  if (!lang || lang === "txt") return
  lang = LANG_ALIASES[lang] || lang
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
    const { codeToTokens, getHighlighter } = await import("./shiki-highlighter")
    const highlighter = await getHighlighter()
    const theme = isDark() ? "github-dark" : "github-light"
    for (const group of groups.values()) {
      const lines = codeToTokens(highlighter, group.map((e) => e.textContent).join("\n"), { lang, theme }).tokens
      group.forEach((ctn, i) => paintLine(ctn, lines[i]))
    }
  } catch {
    return // unknown grammar / load failure: stay plain
  }
}

/* Repaint one line container with its shiki tokens, preserving any <ins>/<del> word-diff
   segments by redistributing the tokens across (and around) them. */
function paintLine(ctn: HTMLElement, tokens: { content: string; color?: string }[] | undefined) {
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

/* Past 3000 lines: plain, uncolored rendering — diff2html chokes, and nobody reads a diff that big anyway */
function renderRaw(body: HTMLElement, text: string) {
  const lines = text.split("\n")
  body.textContent = ""
  body.className = DIFF_BODY + " bg-muted py-1.5"
  lines.slice(0, MAX_LINES).forEach((l) => {
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
    d.className = "min-w-max px-2 whitespace-pre " + RAW_CLASS[kind]
    d.textContent = l || " "
    body.appendChild(d)
  })
  if (lines.length > MAX_LINES) {
    const more = document.createElement("div")
    more.className = "min-w-max px-2 text-muted-foreground"
    more.textContent = messages.diff.truncated((lines.length - MAX_LINES).toLocaleString())
    body.appendChild(more)
  }
}

/* Side by side: d2h gives each pane its own `overflow-x`. The two facing lines
   only stay aligned if both scrollbars advance together. */
function syncSides(body: HTMLElement) {
  const sides = [...body.querySelectorAll<HTMLElement>(".d2h-file-side-diff")]
  if (sides.length < 2) return
  let echo = false
  const onScroll = (ev: Event) => {
    if (echo) return
    echo = true
    const src = ev.currentTarget as HTMLElement
    for (const s of sides) if (s !== src) s.scrollLeft = src.scrollLeft
    requestAnimationFrame(() => (echo = false))
  }
  sides.forEach((s) => s.addEventListener("scroll", onScroll))
  return () => sides.forEach((s) => s.removeEventListener("scroll", onScroll))
}

type Props = {
  api: RepoApi
  repoId: number
  ctx: DiffCtx
  file: FileChange
  view: DiffViewMode
  onViewChange(v: DiffViewMode): void
  onClose(): void
}

export function DiffView({ api, repoId, ctx, file, view, onViewChange, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  /* the diff is painted outside the `.dark` class (diff2html + shiki receive the theme hardcoded):
     an explicit re-render on every toggle, otherwise it stays frozen on the theme it opened with */
  const dark = useTheme()

  /* The diff overlays the graph: we bring focus to it on open (Escape and close
     reachable from the keyboard) and return it to the previous element on close. */
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    root.current?.focus()
    return () => prev?.focus?.()
  }, [])

  /* Image paths bypass diff2html (it can only render text). A text-based image (svg) can also be
     shown as a real text diff, so it gets a preview↔diff toggle, defaulting to the preview; raster
     images have no meaningful text diff and stay preview-only. */
  const imgExt = imageExt(file.path)
  const [imgPreview, setImgPreview] = useState(true)
  const textImage = imgExt !== null && isTextImage(imgExt)
  const showImage = imgExt !== null && (!textImage || imgPreview)
  /* Fetch the text diff only when it can actually be shown — never for a raster image, and for an
     svg only once the user flips to the diff view (react-query fetches lazily on that toggle). */
  const { data: text = null, isError: error } = useDiffQuery(api, repoId, ctx, file.path, file.old ?? null, !showImage)

  /* A staged/unstaged text diff gets the interactive per-hunk/per-line staging body instead
     of diff2html — it honors the same unified/side-by-side toggle. Untracked files (no index
     entry to patch) and oversized or out-of-grammar diffs fall through to the existing
     render paths. */
  const wtSrc = "wt" in ctx && ctx.wt !== "untracked" ? ctx.wt : null
  const parsed = useMemo(
    () =>
      wtSrc && !showImage && text !== null && text.split("\n").length <= MAX_LINES ? parseUnifiedDiff(text) : null,
    [wtSrc, showImage, text]
  )

  useEffect(() => {
    const el = body.current
    if (!el || showImage || text === null || parsed) return
    if (!text.trim()) {
      el.textContent = messages.diff.empty
      el.className = DIFF_BODY + " text-muted-foreground"
      return
    }
    el.className = DIFF_BODY
    if (text.split("\n").length > MAX_LINES) {
      renderRaw(el, text)
      return
    }
    /* diff2html escapes the content; shiki tokens are re-injected via textContent */
    el.innerHTML = d2hHtml(text, {
      outputFormat: view === "sbs" ? OutputFormatType.SIDE_BY_SIDE : OutputFormatType.LINE_BY_LINE,
      drawFileList: false,
      matching: "lines",
      colorScheme: dark ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
    })
    shikiPass(el).catch(() => {})
    return syncSides(el)
  }, [text, view, dark, showImage, parsed])

  return (
    <div ref={root} tabIndex={-1} className="flex min-h-0 flex-1 flex-col px-4.5 py-4 outline-none">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-xs break-all text-muted-foreground">{file.path}</span>
        <div className="flex shrink-0 items-center gap-1">
          {/* A text-based image (svg) can be shown either rendered or as a text diff. */}
          {textImage && (
            <ToggleGroup
              spacing={0}
              variant="outline"
              size="sm"
              value={[imgPreview ? "preview" : "text"]}
              onValueChange={(v) => v[0] && setImgPreview(v[0] === "preview")}
            >
              <ToggleGroupItem value="preview" aria-label={messages.diff.imagePreview}>
                <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
              </ToggleGroupItem>
              <ToggleGroupItem value="text" aria-label={messages.diff.textDiff}>
                <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          {/* The unified/side-by-side toggle applies to every text diff — diff2html render
              and interactive staging body alike — never to an image preview. */}
          {!showImage && (
            <ToggleGroup
              spacing={0}
              variant="outline"
              size="sm"
              value={[view]}
              onValueChange={(v) => v[0] && onViewChange(v[0] as DiffViewMode)}
            >
              <ToggleGroupItem value="unified" aria-label={messages.diff.unified}>
                <HugeiconsIcon icon={MenuSquareIcon} strokeWidth={2} />
              </ToggleGroupItem>
              <ToggleGroupItem value="sbs" aria-label={messages.diff.sideBySide}>
                <HugeiconsIcon icon={LayoutTwoColumnIcon} strokeWidth={2} />
              </ToggleGroupItem>
            </ToggleGroup>
          )}
          <IconButton label={messages.diff.close} icon={Cancel01Icon} onClick={onClose} />
        </div>
      </div>

      {showImage ? (
        <ImageDiffView api={api} repoId={repoId} ctx={ctx} file={file} ext={imgExt} />
      ) : error ? (
        <p className="shrink-0 text-xs text-muted-foreground">{messages.diff.unavailable}</p>
      ) : text === null ? (
        <AsyncHint className="shrink-0 py-1">{messages.diff.loading}</AsyncHint>
      ) : parsed && wtSrc ? (
        <WtDiffBody api={api} repoId={repoId} path={file.path} source={wtSrc} parsed={parsed} view={view} />
      ) : (
        <div ref={body} className={DIFF_BODY} />
      )}
    </div>
  )
}
