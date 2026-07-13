import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  File01Icon,
  FolderOpenIcon,
  Folder01Icon,
  ListTreeIcon,
  Menu01Icon,
} from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { buildPathTree, compactPathTree, type PathTree } from "@/lib/path-tree"
import { prefs } from "@/lib/prefs"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { LABEL_CLS } from "@/components/ui/typography"

export type FileView = "flat" | "tree"

/* Flat / tree view, remembered across all file panels (commit detail,
   staging): toggling it on one side applies to the other on its next mount. */
export function useFileView() {
  const [view, setView] = useState<FileView>(() => prefs.fileView.get() || "tree")
  const set = (v: FileView) => {
    setView(v)
    prefs.fileView.set(v)
  }
  return [view, set] as const
}

export function FileViewToggle({ view, onChange }: { view: FileView; onChange(v: FileView): void }) {
  return (
    <ToggleGroup
      spacing={0}
      variant="outline"
      size="sm"
      value={[view]}
      onValueChange={(v) => v[0] && onChange(v[0] as FileView)}
    >
      <ToggleGroupItem value="flat" aria-label={messages.repo.flatView}>
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
      </ToggleGroupItem>
      <ToggleGroupItem value="tree" aria-label={messages.repo.treeView}>
        <HugeiconsIcon icon={ListTreeIcon} strokeWidth={2} />
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

const STATUS_TEXT: Record<string, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
}

/* `git diff --name-status` statuses. A two-letter status is a conflict (UU, AA, DD…).
   R and C no longer have their own tint: they're moves, not content changes.
   Only consumer of this tint (AUDIT.md §7, phase 5 — used to live in lib/commit-message.ts,
   on the domain side, even though it's a display decision specific to this file row): the
   function stays private to this module rather than exposing a `BadgeColor` that no one else
   reads. */
const fileStatusColor = (st: string): keyof typeof STATUS_TEXT =>
  st.length > 1
    ? "danger"
    : st === "A" || st === "?"
      ? "success"
      : st === "M"
        ? "warning"
        : st === "D"
          ? "danger"
          : "neutral"

export type FileRowProps = {
  file: FileChange
  active?: boolean
  nameOnly?: boolean
  icon?: React.ReactNode
  onClick?(): void
  onDoubleClick?(): void
  /** opens the file in the OS — grafts a context menu entry on top of the double-click
      (AUDIT.md §8): the file list is a core interaction, it can't stay
      mouse-only for this action. */
  onOpenFile?(): void
  action?: React.ReactNode
}

export function FileRow({ file, active, nameOnly, icon, onClick, onDoubleClick, onOpenFile, action }: FileRowProps) {
  const cut = file.path.lastIndexOf("/")
  /* Selection = a quiet tinted fill alone, no rail or border: one visual channel for the
     open diff, neutral hover on the rest. Rounded list rows read cleaner with just the fill
     than with the left rail the flat graph rows carry. */
  const rowCls = cn(
    "group/file flex items-baseline gap-2 rounded-sm px-1.5 py-0.5 hover:bg-muted/60",
    active && "bg-primary/15 hover:bg-primary/20"
  )
  /* The stage/unstage button (`action`) is a real <button> too: it stays a sibling of the
     main button, never nested inside it (two <button>s nested would be invalid
     and would break focus/AT) — `action`'s `onClick` already stops its propagation (worktree-panel.tsx). */
  const inner = (
    <>
      <button
        type="button"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className={cn("w-3 shrink-0 text-[0.625rem] font-semibold", STATUS_TEXT[fileStatusColor(file.st)])}>
          {file.st}
        </span>
        {icon}
        {/* flat: the folder truncates, the file name stays whole */}
        <span className="flex min-w-0 text-xs whitespace-nowrap">
          {!nameOnly && cut >= 0 && (
            <span className="truncate text-muted-foreground">{file.path.slice(0, cut + 1)}</span>
          )}
          <span className="shrink-0 truncate">{file.path.slice(cut + 1)}</span>
        </span>
      </button>
      {action}
    </>
  )

  if (!onOpenFile) return <div className={rowCls}>{inner}</div>

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className={rowCls} />}>{inner}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onOpenFile}>
          <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
          {messages.repo.openInFileExplorer}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/* Windows shell icons are attached to the extension: a single IPC round-trip per
   extension, not per file. A `null` (file missing from disk) isn't cached. */
const iconByExt = new Map<string, string>()

const extOf = (path: string) => {
  const name = path.slice(path.lastIndexOf("/") + 1)
  const dot = name.lastIndexOf(".")
  return dot > 0 ? name.slice(dot).toLowerCase() : ""
}

function FileIcon({ api, path }: { api: RepoApi; path: string }) {
  const ext = extOf(path)
  const [url, setUrl] = useState(() => iconByExt.get(ext))

  useEffect(() => {
    const cached = iconByExt.get(ext)
    if (cached) return setUrl(cached)
    let live = true
    void api.fileIcon(path).then((d) => {
      if (d) iconByExt.set(ext, d)
      if (live) setUrl(d ?? undefined)
    })
    return () => void (live = false)
  }, [api, ext, path])

  return url ? (
    <img src={url} alt="" className="size-3.5 shrink-0 self-center" />
  ) : (
    <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-3.5 shrink-0 self-center text-muted-foreground" />
  )
}

function TreeFile<T extends FileChange>({
  api,
  file,
  active,
  onOpen,
  action,
}: {
  api: RepoApi
  file: T
  active?: boolean
  onOpen?(f: T): void
  action?: React.ReactNode
}) {
  /* Instant single click (AUDIT.md §8): no more disambiguation delay with the double-click
     — the hot path (viewing the diff) shouldn't pay an artificial latency for the rare case
     (opening in the OS). A double-click therefore fires both in sequence (diff then open),
     an accepted, harmless side effect: opening the file does nothing destructive. */
  return (
    <FileRow
      file={file}
      nameOnly
      icon={<FileIcon api={api} path={file.path} />}
      active={active}
      action={action}
      onClick={onOpen && (() => onOpen(file))}
      onDoubleClick={() => api.openFile(file.path)}
      onOpenFile={() => api.openFile(file.path)}
    />
  )
}

const countFiles = <T,>(d: PathTree<T>): number =>
  d.items.length + [...d.dirs.values()].reduce((n, c) => n + countFiles(c), 0)

/** All files of a subtree, flattened — to stage / unstage a folder in one go. */
const collectFiles = <T,>(d: PathTree<T>): T[] => [...d.items, ...[...d.dirs.values()].flatMap((c) => collectFiles(c))]

function Tree<T extends FileChange>({
  node,
  api,
  activePath,
  onOpen,
  action,
  dirAction,
}: {
  node: PathTree<T>
  api: RepoApi
  activePath?: string
  onOpen?(f: T): void
  action?(f: T): React.ReactNode
  /** one button per folder, acting on all files of the subtree */
  dirAction?(files: T[]): React.ReactNode
}) {
  return (
    <>
      {[...node.dirs.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((k) => {
          const d = node.dirs.get(k)!
          return (
            <Collapsible key={k} defaultOpen>
              {/* trigger and folder button side by side: a button doesn't nest inside
                  another. The row carries the hover; the chevron keeps its state on the trigger. */}
              <div className="group/dirrow flex items-center rounded-sm pe-1 hover:bg-muted/60">
                <CollapsibleTrigger className="group/dir flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                    className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
                  />
                  <HugeiconsIcon
                    icon={Folder01Icon}
                    strokeWidth={2}
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="truncate font-medium">{k}</span>
                  <span className="text-[0.625rem] text-muted-foreground tabular-nums">{countFiles(d)}</span>
                </CollapsibleTrigger>
                {dirAction?.(collectFiles(d))}
              </div>
              <CollapsibleContent className="ml-2 border-l pl-2">
                <Tree
                  node={d}
                  api={api}
                  activePath={activePath}
                  onOpen={onOpen}
                  action={action}
                  dirAction={dirAction}
                />
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      {[...node.items]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => (
          <TreeFile
            key={f.path}
            api={api}
            file={f}
            active={f.path === activePath}
            onOpen={onOpen}
            action={action?.(f)}
          />
        ))}
    </>
  )
}

export function FileListHeader({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={cn("mb-2 flex min-h-6 shrink-0 items-center justify-between", LABEL_CLS)}>
      <span>{children}</span>
      {actions}
    </div>
  )
}

/* Bare rendering of files, flat or tree — without header or scroll container, which
   the caller owns. `action` grafts a button per file (stage / unstage). */
export function FileEntries<T extends FileChange>({
  files,
  view,
  api,
  activePath,
  onOpen,
  action,
  dirAction,
}: {
  files: T[]
  view: FileView
  api: RepoApi
  activePath?: string
  onOpen?(f: T): void
  action?(f: T): React.ReactNode
  /** tree view only: one button per folder, acting on all files of the subtree */
  dirAction?(files: T[]): React.ReactNode
}) {
  if (view === "tree")
    return (
      <Tree
        node={compactPathTree(buildPathTree(files, (f) => f.path))}
        api={api}
        activePath={activePath}
        onOpen={onOpen}
        action={action}
        dirAction={dirAction}
      />
    )
  return (
    <>
      {files.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          active={f.path === activePath}
          onClick={onOpen && (() => onOpen(f))}
          /* the tree view (TreeFile) has always opened in the OS on double-click; the flat view
             never gained it (AUDIT.md §8, audit/actual-code gap) — the two views of the same
             toggle (FileViewToggle) must offer the same action. */
          onOpenFile={() => api.openFile(f.path)}
          action={action?.(f)}
        />
      ))}
    </>
  )
}

export function FileList({
  files,
  api,
  activePath,
  onOpen,
}: {
  files: FileChange[]
  api: RepoApi
  activePath?: string
  onOpen?(f: FileChange): void
}) {
  const [view, setView] = useFileView()

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
      <FileListHeader actions={files.length > 0 && <FileViewToggle view={view} onChange={setView} />}>
        {messages.repo.fileCount(files.length)}
      </FileListHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileEntries files={files} view={view} api={api} activePath={activePath} onOpen={onOpen} />
      </div>
    </div>
  )
}
