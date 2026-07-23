import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { html as d2hHtml, parse as d2hParse } from "diff2html"
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

import { DIFF_MAX_LINES } from "../../../../shared/diff.ts"
import { DIFF_BODY, renderRaw, shikiPass, syncSides } from "@/lib/d2h-render"
import type { FileChange, RepoApi } from "@/lib/git"
import { parseUnifiedDiff } from "@/features/diff/diff-parse"
import { useDiffQuery } from "@/features/diff/diff-queries"
import { DiffBody, type DiffBodySource } from "@/features/diff/diff-body"
import { imageExt, isTextImage } from "@/features/diff/image-diff-queries"
import { ImageDiffView } from "@/features/diff/image-diff-view"
import { useLangAliasSig } from "@/lib/customization"
import { messages } from "@/lib/messages"
import { useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { IconButton } from "@/components/ui/icon-button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/** Named `DiffViewMode` (not `DiffView`) to avoid colliding with the identically named
    React component below (AUDIT.md §7, phase 5, item 6). */
export type DiffViewMode = "unified" | "sbs"
/** A context carries either a pair of commits, or the source within the working tree. */
export type DiffCtx = { hash: string; parent: string | null } | { wt: "staged" | "unstaged" | "untracked" }

/* The line cap (DIFF_MAX_LINES, shared/diff.ts) is enforced on BOTH sides: main truncates the
   IPC payload a slack past it and ships `{text, totalLines}`, and the gates below keep
   diff2html/shiki away from anything whose *total* exceeds it — a truncated payload (which by
   construction always carries more than the cap) can never reach them looking complete.
   The DOM machinery itself (shikiPass, renderRaw, syncSides, and the shared DIFF_BODY
   canvas class) lives in @/lib/d2h-render. */

/* Ghost of a diff render in the body's frame: a file-header bar, then code-length lines
   (fixed pseudo-random widths — a skeleton stable across renders). */
const GHOST_LINES = ["w-3/5", "w-2/5", "w-4/5", "w-1/3", "w-1/2", "w-2/3", "w-1/4", "w-3/5", "w-2/5", "w-1/2"]
function DiffSkeleton() {
  return (
    <SkeletonGroup label={messages.diff.loading} className="min-h-0 flex-auto overflow-hidden rounded-md border">
      <div className="border-b bg-muted/40 px-3 py-2">
        <Skeleton className="h-2.5 w-40 rounded-full" />
      </div>
      <div className="space-y-2.5 p-3">
        {GHOST_LINES.map((w, i) => (
          <Skeleton key={i} className={cn("h-2.5 rounded-full", w)} />
        ))}
      </div>
    </SkeletonGroup>
  )
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
  /* re-run the highlight effect when the extension→grammar map changes (shikiPass reads the live
     map); a stable signature keeps unrelated customization edits from re-highlighting the diff */
  const langSig = useLangAliasSig()

  /* The diff overlays the graph: we bring focus to it on open (Escape and close
     reachable from the keyboard) and return it to the previous element on close.
     Layout effect + `contains` guard: switching file remounts the view (keyed on the path
     in graph-column), and focus only goes back if the view still holds it — a click on
     another row must not yank focus (and the file list scroll) back to the old row.
     Opened from a file row (click or ArrowUp/Down — cf. file-list.tsx onFileRowKeyDown),
     the row keeps focus so the arrows keep walking the list, the diff following along;
     Escape still closes from there (repo-view's document-level shortcut registry). */
  useLayoutEffect(() => {
    const el = root.current
    const prev = document.activeElement as HTMLElement | null
    if (!prev?.closest("[data-file-row]")) el?.focus()
    return () => {
      if (el?.contains(document.activeElement)) prev?.focus?.()
    }
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
  const { data: diff = null, isError: error } = useDiffQuery(api, repoId, ctx, file.path, file.old ?? null, !showImage)

  /* The line count ships with the text (`totalLines`, counted main-side during the truncation
     scan — cf. shared/diff.ts): the gates below key off it, so an oversized diff is routed to
     the raw fallback whether or not its tail actually crossed IPC. Under the cap the payload
     is always complete, so diff2html/shiki still only ever see whole, uncapped diffs. */

  /* Any single-file text diff gets the interactive per-hunk/per-line body instead of
     diff2html — it honors the same unified/side-by-side toggle. Staged/unstaged sources get
     the staging actions; a commit↔commit context gets the revert action (the file-history
     view's behavior, available in every commit diff). Untracked files (no index entry to
     patch) and oversized or out-of-grammar diffs fall through to the existing render paths. */
  const src: DiffBodySource | null = "wt" in ctx ? (ctx.wt !== "untracked" ? ctx.wt : null) : "commit"
  const parsed = useMemo(
    () =>
      src && !showImage && diff !== null && diff.totalLines <= DIFF_MAX_LINES ? parseUnifiedDiff(diff.text) : null,
    [src, showImage, diff]
  )

  /* diff2html's parse is memoized apart from its HTML render: the unified↔side-by-side and
     theme toggles only change render options (`outputFormat`, `colorScheme`, and `matching`
     is applied by the renderers too), so they re-run `d2hHtml` on the already-parsed files
     instead of re-parsing the whole diff text. */
  const d2hFiles = useMemo(
    () =>
      !showImage && diff !== null && !parsed && diff.text.trim() && diff.totalLines <= DIFF_MAX_LINES
        ? d2hParse(diff.text)
        : null,
    [showImage, diff, parsed]
  )

  useEffect(() => {
    const el = body.current
    if (!el || showImage || diff === null || parsed) return
    if (!diff.text.trim()) {
      el.textContent = messages.diff.empty
      el.className = DIFF_BODY + " text-muted-foreground"
      return
    }
    el.className = DIFF_BODY
    if (!d2hFiles) {
      renderRaw(el, diff.text, diff.totalLines) // over DIFF_MAX_LINES: plain, uncolored fallback
      return
    }
    /* diff2html escapes the content; shiki tokens are re-injected via textContent */
    el.innerHTML = d2hHtml(d2hFiles, {
      outputFormat: view === "sbs" ? OutputFormatType.SIDE_BY_SIDE : OutputFormatType.LINE_BY_LINE,
      drawFileList: false,
      matching: "lines",
      colorScheme: dark ? ColorSchemeType.DARK : ColorSchemeType.LIGHT,
    })
    /* Aborted on cleanup so a superseded pass (file switch, view/theme toggle) stops
       tokenizing between slices instead of finishing against detached DOM. */
    const abort = new AbortController()
    shikiPass(el, abort.signal).catch(() => {})
    const offSync = syncSides(el)
    return () => {
      abort.abort()
      offSync?.()
    }
  }, [diff, view, dark, showImage, parsed, d2hFiles, langSig])

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
      ) : diff === null ? (
        <DiffSkeleton />
      ) : parsed && src ? (
        <DiffBody api={api} repoId={repoId} path={file.path} source={src} parsed={parsed} view={view} />
      ) : (
        <div ref={body} className={DIFF_BODY} />
      )}
    </div>
  )
}
