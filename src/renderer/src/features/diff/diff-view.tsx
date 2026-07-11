import { useEffect, useRef } from "react"
import { html as d2hHtml } from "diff2html"
import { ColorSchemeType, OutputFormatType } from "diff2html/lib/types"
import "diff2html/bundles/css/diff2html.min.css"
import { codeToTokens, type BundledLanguage } from "shiki"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, LayoutTwoColumnIcon, MenuSquareIcon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi } from "@/lib/git"
import { useDiffQuery } from "@/features/diff/diff-queries"
import { isDark, useTheme } from "@/lib/theme"
import { AsyncHint } from "@/components/ui/async-hint"
import { IconButton } from "@/components/ui/icon-button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** Nommé `DiffViewMode` (pas `DiffView`) pour ne pas entrer en collision avec le composant
    React homonyme ci-dessous (AUDIT.md §7, phase 5, item 6). */
export type DiffViewMode = "unified" | "sbs"
/** Un contexte porte soit un couple de commits, soit la source dans l'arbre de travail. */
export type DiffCtx = { hash: string; parent: string | null } | { wt: "staged" | "unstaged" | "untracked" }

const MAX_LINES = 3000
/* Réappliqué à chaque rendu — les effets réécrivent `className` de fond en comble. */
const DIFF_BODY = "amont-diffbody min-h-0 flex-auto overflow-auto rounded-md font-mono text-xs leading-normal [tab-size:4]"

/* extensions maison -> grammaire shiki ; les projets/props MSBuild sont du XML */
const LANG_ALIASES: Record<string, string> = { jet: "sql", csproj: "xml", props: "xml", targets: "xml", slnx: "xml" }

/* Coloration shiki par-dessus le rendu diff2html.
   Les segments <ins>/<del> (word-diff) sont préservés en re-répartissant les tokens. */
async function shikiPass(body: HTMLElement) {
  let lang = body.querySelector(".d2h-file-wrapper")?.getAttribute("data-lang")
  if (!lang || lang === "txt") return
  lang = LANG_ALIASES[lang] || lang
  const ctns = [...body.querySelectorAll<HTMLElement>(".d2h-code-line-ctn")]
  if (!ctns.length) return
  let lines
  try {
    const res = await codeToTokens(ctns.map((e) => e.textContent).join("\n"), {
      lang: lang as BundledLanguage,
      theme: isDark() ? "github-dark" : "github-light",
    })
    lines = res.tokens
  } catch {
    return // grammaire inconnue : on reste brut
  }
  ctns.forEach((ctn, i) => {
    const tokens = lines[i]
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
        const limit = mark
          ? mark.end
          : Math.min(...marks.filter((m) => m.start > abs).map((m) => m.start), Infinity)
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
  })
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
    more.textContent = `… ${(lines.length - MAX_LINES).toLocaleString()} lignes tronquées`
    body.appendChild(more)
  }
}

/* Côte à côte : d2h donne à chaque volet son propre `overflow-x`. Les deux lignes en vis-à-vis
   ne restent alignées que si les deux barres avancent ensemble. */
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
  /* le diff est peint hors de la classe `.dark` (diff2html + shiki reçoivent le thème en dur) :
     un re-rendu explicite à chaque bascule, sinon il reste figé sur le thème d'ouverture */
  const dark = useTheme()

  /* Le diff recouvre le graphe : on y amène le focus à l'ouverture (Échap et fermeture
     atteignables au clavier) et on le rend à l'élément précédent à la fermeture. */
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    root.current?.focus()
    return () => prev?.focus?.()
  }, [])

  const { data: text = null, isError: error } = useDiffQuery(api, repoId, ctx, file.path, file.old ?? null)

  useEffect(() => {
    const el = body.current
    if (!el || text === null) return
    if (!text.trim()) {
      el.textContent = "Diff vide."
      el.className = DIFF_BODY + " text-muted-foreground"
      return
    }
    el.className = DIFF_BODY
    if (text.split("\n").length > MAX_LINES) {
      renderRaw(el, text)
      return
    }
    /* diff2html échappe le contenu ; les tokens shiki sont réinjectés par textContent */
    el.innerHTML = d2hHtml(text, {
      outputFormat: view === "sbs" ? OutputFormatType.SIDE_BY_SIDE : OutputFormatType.LINE_BY_LINE,
      drawFileList: false,
      matching: "lines",
      colorScheme: dark ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
    })
    shikiPass(el).catch(() => {})
    return syncSides(el)
  }, [text, view, dark])

  return (
    <div ref={root} tabIndex={-1} className="flex min-h-0 flex-1 flex-col px-4.5 py-4 outline-none">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <span className="text-xs break-all text-muted-foreground">{file.path}</span>
        <div className="flex shrink-0 items-center gap-1">
          <ToggleGroup
            spacing={0}
            variant="outline"
            size="sm"
            value={[view]}
            onValueChange={(v) => v[0] && onViewChange(v[0] as DiffViewMode)}
          >
            <ToggleGroupItem value="unified" aria-label="Diff unifié">
              <HugeiconsIcon icon={MenuSquareIcon} strokeWidth={2} />
            </ToggleGroupItem>
            <ToggleGroupItem value="sbs" aria-label="Côte à côte">
              <HugeiconsIcon icon={LayoutTwoColumnIcon} strokeWidth={2} />
            </ToggleGroupItem>
          </ToggleGroup>
          <IconButton label="Fermer (Échap)" icon={Cancel01Icon} onClick={onClose} />
        </div>
      </div>

      {error ? (
        <p className="shrink-0 text-xs text-muted-foreground">Diff indisponible.</p>
      ) : text === null ? (
        <AsyncHint className="shrink-0 py-1">diff…</AsyncHint>
      ) : (
        <div ref={body} className={DIFF_BODY} />
      )}
    </div>
  )
}

