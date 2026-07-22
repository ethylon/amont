/* File-history overlay (detail panel's "File history" context entry): the commits that
   touched one file — walked from the commit the menu was opened on, renames followed
   (`repo:fileLog`) — as a list beside the selected commit's diff of that file. The diff pane
   IS DiffView: same unified/side-by-side toggle, same image preview, and the same interactive
   commit-diff body, so every hunk/line can be reverted right here without leaving the view
   (the worktree caches refresh; the history itself is content-addressed and never moves).
   DiffView's close button (and Escape, via repo-view's registry) closes the whole overlay. */

import { useState } from "react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import type { FileLogEntry, RepoApi } from "@/lib/git"
import { parseSubject } from "@/lib/commit-parse"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { shortHash } from "@/features/graph/ids"
import { DiffView, type DiffViewMode } from "@/features/diff/diff-view"
import { fileStatusCls } from "@/features/repo/file-list"
import { useFileLogQuery } from "@/features/history/history-queries"
import { IconButton } from "@/components/ui/icon-button"
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton"
import { LABEL_CLS } from "@/components/ui/typography"

type Props = {
  api: RepoApi
  repoId: number
  /** the file whose history is shown, and the commit the walk is anchored on */
  path: string
  from: string
  view: DiffViewMode
  onViewChange(v: DiffViewMode): void
  onClose(): void
}

/* Ghost of the commit list: subject bar + meta bar per row, fixed pseudo-random widths
   (a skeleton stable across renders — same policy as the detail panel's file ghosts). */
const GHOST_ROWS = ["w-36", "w-24", "w-40", "w-28", "w-32"]
const ListSkeleton = () => (
  <SkeletonGroup label={messages.history.loading} className="space-y-3 p-3">
    {GHOST_ROWS.map((w, i) => (
      <div key={i} className="space-y-1.5">
        <Skeleton className={cn("h-2.5 rounded-full", w)} />
        <Skeleton className="h-2 w-20 rounded-full" />
      </div>
    ))}
  </SkeletonGroup>
)

function CommitRow({ e, active, onClick }: { e: FileLogEntry; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active || undefined}
      /* same selection grammar as the file rows: a quiet tinted fill for the open diff */
      className={cn(
        "flex w-full cursor-pointer items-baseline gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-muted/60",
        "focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
        active && "bg-primary/15 hover:bg-primary/20"
      )}
    >
      <span className={cn("w-3 shrink-0 text-[0.625rem] font-semibold", fileStatusCls(e.st))}>{e.st}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs">{parseSubject(e.s).text}</span>
        <span className="block truncate text-[0.625rem] text-muted-foreground">
          <span className="font-mono" title={e.h}>
            {shortHash(e.h)}
          </span>
          {" · "}
          <span className="tabular-nums">{e.d}</span>
          {" · "}
          {e.a}
        </span>
      </span>
    </button>
  )
}

export function FileHistoryView({ api, repoId, path, from, view, onViewChange, onClose }: Props) {
  const { data: log, isError } = useFileLogQuery(api, repoId, from, path)
  /* Selected entry, by hash rather than index: the list is immutable once loaded, but a
     hash key is self-describing and survives any future reordering. Defaults to the most
     recent commit — the one whose file list the menu was opened from. */
  const [selected, setSelected] = useState<string | null>(null)
  const entry = log?.find((e) => e.h === selected) ?? log?.[0] ?? null

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-60 shrink-0 flex-col border-e">
        <div className={cn("flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3", LABEL_CLS)}>
          <span className="truncate" title={path}>
            {messages.detail.fileHistory}
          </span>
          {log && <span className="shrink-0">{messages.history.commitCount(log.length)}</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {isError ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">{messages.history.unavailable}</p>
          ) : !log ? (
            <ListSkeleton />
          ) : log.length === 0 ? (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">{messages.history.empty}</p>
          ) : (
            log.map((e) => <CommitRow key={e.h} e={e} active={e === entry} onClick={() => setSelected(e.h)} />)
          )}
        </div>
      </div>

      {entry ? (
        /* keyed on the commit: DiffView resets its per-file state (image toggle, focus) per
           entry, exactly like the keyed remount it gets in graph-column */
        <DiffView
          key={entry.h}
          api={api}
          repoId={repoId}
          ctx={{ hash: entry.h, parent: entry.parent }}
          file={{ st: entry.st, path: entry.path, old: entry.old }}
          view={view}
          onViewChange={onViewChange}
          onClose={onClose}
        />
      ) : (
        /* loading / empty / error: no DiffView yet, so this pane carries the close button */
        <div className="flex min-h-0 flex-1 flex-col px-4.5 py-4">
          <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
            <span className="text-xs break-all text-muted-foreground">{messages.history.title(path)}</span>
            <IconButton label={messages.diff.close} icon={Cancel01Icon} onClick={onClose} />
          </div>
        </div>
      )}
    </div>
  )
}
