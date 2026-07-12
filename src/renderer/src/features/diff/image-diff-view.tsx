import { useState } from "react"

import type { BlobData, FileChange, RepoApi } from "@/lib/git"
import { IMAGE_MIME, useImageDiffQuery } from "@/features/diff/image-diff-queries"
import type { DiffCtx } from "@/features/diff/diff-view"
import { messages } from "@/lib/messages"
import { cn, formatBytes } from "@/lib/utils"
import { AsyncHint } from "@/components/ui/async-hint"

/* A light/dark checkerboard so a transparent PNG/SVG reads as transparent instead of blending
   into the panel. Pure CSS — no asset, no extra request under the CSP. */
const CHECKER =
  "bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0] " +
  "bg-[image:linear-gradient(45deg,var(--muted)_25%,transparent_25%),linear-gradient(-45deg,var(--muted)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,var(--muted)_75%),linear-gradient(-45deg,transparent_75%,var(--muted)_75%)]"

const TONE: Record<"add" | "del", string> = {
  add: "bg-success/16 text-success",
  del: "bg-destructive/16 text-destructive",
}

function ImagePanel({
  label,
  tone,
  data,
  ext,
}: {
  label: string
  tone: "add" | "del"
  data: BlobData | null
  ext: string
}) {
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  return (
    <figure className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <figcaption className="flex items-center gap-2 text-xs">
        <span className={cn("rounded px-1.5 py-0.5 font-medium", TONE[tone])}>{label}</span>
        {data && data.b64 !== null && (
          <span className="text-muted-foreground">
            {dims && `${messages.diff.dimensions(dims.w, dims.h)} · `}
            {formatBytes(data.size)}
          </span>
        )}
      </figcaption>
      {!data ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-6 text-xs text-muted-foreground">
          {messages.diff.imageNone}
        </div>
      ) : data.b64 === null ? (
        <div className="flex flex-1 items-center justify-center rounded-md border border-dashed p-6 text-xs text-muted-foreground">
          {messages.diff.imageTooLarge} ({formatBytes(data.size)})
        </div>
      ) : (
        <div className={cn("flex flex-1 items-center justify-center overflow-auto rounded-md p-2", CHECKER)}>
          <img
            src={`data:${IMAGE_MIME[ext]};base64,${data.b64}`}
            alt={label}
            className="max-h-[70vh] max-w-full object-contain"
            onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          />
        </div>
      )}
    </figure>
  )
}

type Props = {
  api: RepoApi
  repoId: number
  ctx: DiffCtx
  file: FileChange
  ext: string
}

/** Before/after image preview shown in place of a diff2html render for binary image paths. */
export function ImageDiffView({ api, repoId, ctx, file, ext }: Props) {
  const { data, isPending, isError } = useImageDiffQuery(api, repoId, ctx, file, true)

  if (isPending) return <AsyncHint className="shrink-0 py-1">{messages.diff.loading}</AsyncHint>
  if (isError || (!data.old && !data.new))
    return <p className="shrink-0 text-xs text-muted-foreground">{messages.diff.imageUnavailable}</p>

  const both = Boolean(data.old && data.new)

  return (
    <div className="min-h-0 flex-auto overflow-auto rounded-md bg-muted/40">
      <div className="flex min-h-full flex-col gap-4 p-4 lg:flex-row">
        {data.old && (
          <ImagePanel label={both ? messages.diff.before : messages.diff.imageDeleted} tone="del" data={data.old} ext={ext} />
        )}
        {data.new && (
          <ImagePanel label={both ? messages.diff.after : messages.diff.imageAdded} tone="add" data={data.new} ext={ext} />
        )}
      </div>
    </div>
  )
}
