/* Image preview query (sibling of diff-queries.ts): for a binary path that diff2html can only
   render as "Binary files differ", fetch the raw bytes of each side so the diff view can show a
   real before/after image. The two sides are read in parallel; either is null when the path is
   absent on that side (added file → no "before", deleted file → no "after"). */

import { useQuery } from "@tanstack/react-query"

import type { BlobData, BlobRef, FileChange, RepoApi } from "@/lib/git"
import { queryKeys } from "@/lib/queries"
import type { DiffCtx } from "@/features/diff/diff-view"

export type ImageSide = { path: string; ref: BlobRef }
export type ImageDiff = { old: BlobData | null; new: BlobData | null }

/* Extensions we render as an image rather than a text/binary diff, mapped to their MIME type
   for the renderer's `data:` URL. `<img>` (unlike inline markup) never executes an SVG's
   scripts, so svg is safe to include as a rendered preview. */
export const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  apng: "image/apng",
  svg: "image/svg+xml",
}

/** Image extensions that are themselves text (svg is XML): a real text diff is meaningful for
    them, so the diff view offers a preview↔diff toggle instead of forcing the rendered preview. */
const TEXT_IMAGE_EXT = new Set(["svg"])

/** The image extension of `path` (lowercased, no dot), or null if it isn't one we preview. */
export function imageExt(path: string): string | null {
  const m = /\.([a-z0-9]+)$/i.exec(path)
  const e = m?.[1]?.toLowerCase()
  return e && e in IMAGE_MIME ? e : null
}

/** Whether `ext` is a text-based image (svg) that can also be shown as a text diff. */
export function isTextImage(ext: string): boolean {
  return TEXT_IMAGE_EXT.has(ext)
}

/** Which version of the file to read on each side, from the diff context and the rename origin.
    A commit compares parent↔commit; the working tree compares its base (HEAD or the index) to the
    edited copy (the index or the file on disk). Renamed paths read their old name on the old side. */
export function imageSides(ctx: DiffCtx, file: FileChange): { old: ImageSide | null; new: ImageSide | null } {
  const newPath = file.path
  const oldPath = file.old ?? file.path
  if ("wt" in ctx) {
    if (ctx.wt === "untracked") return { old: null, new: { path: newPath, ref: { kind: "worktree" } } }
    if (ctx.wt === "staged")
      return {
        old: { path: oldPath, ref: { kind: "commit", rev: "HEAD" } },
        new: { path: newPath, ref: { kind: "index" } },
      }
    // unstaged: index (staged/HEAD version) vs the working file on disk
    return {
      old: { path: oldPath, ref: { kind: "index" } },
      new: { path: newPath, ref: { kind: "worktree" } },
    }
  }
  return {
    old: ctx.parent ? { path: oldPath, ref: { kind: "commit", rev: ctx.parent } } : null,
    new: { path: newPath, ref: { kind: "commit", rev: ctx.hash } },
  }
}

export function useImageDiffQuery(
  api: RepoApi,
  id: number,
  ctx: DiffCtx,
  file: FileChange,
  enabled: boolean
) {
  return useQuery({
    enabled,
    queryKey: queryKeys.imageDiff(id, ctx, file.path, file.old ?? null),
    queryFn: async (): Promise<ImageDiff> => {
      const sides = imageSides(ctx, file)
      const [oldData, newData] = await Promise.all([
        sides.old ? api.blob(sides.old.path, sides.old.ref) : Promise.resolve(null),
        sides.new ? api.blob(sides.new.path, sides.new.ref) : Promise.resolve(null),
      ])
      return { old: oldData, new: newData }
    },
  })
}
