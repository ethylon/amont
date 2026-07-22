import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowRight01Icon,
  File01Icon,
  FileSyncIcon,
  FolderOpenIcon,
  Folder01Icon,
  HistoryIcon,
  ListTreeIcon,
  Menu01Icon,
} from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi } from "@/lib/git"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { buildPathTree, compactPathTree, type PathTree } from "@/lib/path-tree"
import { ScrollText, scrollTextHover, scrollTextStop } from "@/features/graph/interactions/scroll-text"
import { prefs } from "@/lib/prefs"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
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
   (AUDIT.md §7, phase 5 — used to live in lib/commit-message.ts, on the domain side, even
   though it's a display decision.) Exposed as the ready-to-use class (`fileStatusCls`)
   rather than a `BadgeColor`: the file-history rows show the same status letters and must
   tint them identically, but nobody needs the intermediate color name. */
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

/** Tint class of a status letter — shared with the file-history view's commit rows. */
export const fileStatusCls = (st: string): string => STATUS_TEXT[fileStatusColor(st)]

/* ArrowUp/ArrowDown move to the previous/next visible file and open it — the diff follows
   the selection, like a click. DOM-based on purpose: the rendered order already accounts
   for tree/flat view, sorting and collapsed folders (Base UI unmounts a closed panel), no
   need to re-derive a flattened list from state. Scope = the closest [data-file-nav]
   container (the scroll area), so each block (staged / unstaged / commit files) navigates
   within itself. */
const onFileRowKeyDown = (ev: React.KeyboardEvent<HTMLButtonElement>) => {
  if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return
  const scope = ev.currentTarget.closest("[data-file-nav]")
  if (!scope) return
  const rows = [...scope.querySelectorAll<HTMLButtonElement>("[data-file-row]")]
  const next = rows[rows.indexOf(ev.currentTarget) + (ev.key === "ArrowDown" ? 1 : -1)]
  if (!next) return
  ev.preventDefault()
  next.focus()
  next.click()
}

/* Stage/unstage unmounts the very button that was clicked — the file moves to the other
   block — and DOM focus falls to <body>, killing the arrow-key flow above (refresh audit,
   §3). Once the action settles, focus goes back to the row that takes the clicked one's
   place in the same block (the last row when the removed one was last, like a file manager).
   Lives here because this module owns the [data-file-nav]/[data-file-row] convention.
   Folder buttons have no sibling row: they aim at the first row below the folder header. */
export function refocusAfterFileAction(btn: HTMLElement, done: Promise<void>): void {
  const scope = btn.closest<HTMLElement>("[data-file-nav]")
  if (!scope) return
  const rows = [...scope.querySelectorAll<HTMLButtonElement>("[data-file-row]")]
  const own = btn.parentElement?.querySelector<HTMLButtonElement>("[data-file-row]")
  const below = own ? -1 : rows.findIndex((row) => btn.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING)
  const idx = own ? rows.indexOf(own) : below === -1 ? rows.length : below
  void done.then(() =>
    /* two frames: `done` resolves when the refetch settles, but React commits the new rows
       on its own schedule — the second frame lands reliably after that commit */
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        /* restore only orphaned focus (fallen to <body>): a user who already moved on — or a
           failed action whose button survived and kept focus — must not have focus stolen */
        if (!scope.isConnected || document.activeElement !== document.body) return
        const after = [...scope.querySelectorAll<HTMLButtonElement>("[data-file-row]")]
        after[Math.min(idx, after.length - 1)]?.focus()
      })
    )
  )
}

/* Offscreen rows skip layout/paint (perf audit, finding 13): a multi-thousand-file commit
   only pays rendering for the visible window of its 320-px panel. `contain-intrinsic-size`
   reserves the row's height (~20px: text-xs line + py-0.5) so the scrollbar doesn't dance. */
const ROW_CV_CLS = "[content-visibility:auto] [contain-intrinsic-size:auto_1.25rem]"

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
  /** commit-anchored context entries (detail panel only — the staging panel has no commit
      to anchor them on): the file's history view, and the confirmed working-tree restore. */
  onHistory?(): void
  onRestore?(): void
  action?: React.ReactNode
}

export function FileRow({
  file,
  active,
  nameOnly,
  icon,
  onClick,
  onDoubleClick,
  onOpenFile,
  onHistory,
  onRestore,
  action,
}: FileRowProps) {
  const cut = file.path.lastIndexOf("/")
  /* Selection = a quiet tinted fill alone, no rail or border: one visual channel for the
     open diff, neutral hover on the rest. Rounded list rows read cleaner with just the fill
     than with the left rail the flat graph rows carry. */
  const rowCls = cn(
    "group/file flex items-baseline gap-2 rounded-sm pe-1.5 hover:bg-muted/60",
    ROW_CV_CLS,
    active && "bg-primary/15 hover:bg-primary/20"
  )
  /* The marquee is armed by the whole row, like the graph rows — not just the name span. */
  const rowHover = {
    onMouseEnter: (ev: React.MouseEvent<HTMLElement>) =>
      scrollTextHover(ev.currentTarget.querySelector<HTMLElement>(".amont-scrolltext")),
    onMouseLeave: () => scrollTextStop(),
  }
  /* The stage/unstage button (`action`) is a real <button> too: it stays a sibling of the
     main button, never nested inside it (two <button>s nested would be invalid
     and would break focus/AT) — `action`'s `onClick` already stops its propagation (worktree-panel.tsx).
     The row's padding lives on the main button so the pointer and the click cover the
     full row surface, not just the text. */
  const inner = (
    <>
      <button
        type="button"
        data-file-row=""
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onFileRowKeyDown}
        className="flex min-w-0 flex-1 cursor-pointer items-baseline gap-2 rounded-sm ps-1.5 py-0.5 text-left focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <span className={cn("w-3 shrink-0 text-[0.625rem] font-semibold", fileStatusCls(file.st))}>{file.st}</span>
        {icon}
        {/* tree: the name marquee-scrolls on hover; flat: the folder truncates, the file name stays whole */}
        {nameOnly ? (
          <ScrollText text={file.path.slice(cut + 1)} className="text-xs" selfHover={false} />
        ) : (
          <span className="flex min-w-0 text-xs whitespace-nowrap">
            {cut >= 0 && <span className="truncate text-muted-foreground">{file.path.slice(0, cut + 1)}</span>}
            <span className="shrink-0 truncate">{file.path.slice(cut + 1)}</span>
          </span>
        )}
      </button>
      {action}
    </>
  )

  if (!onOpenFile && !onHistory && !onRestore)
    return (
      <div className={rowCls} {...rowHover}>
        {inner}
      </div>
    )

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className={rowCls} {...rowHover} />}>{inner}</ContextMenuTrigger>
      <ContextMenuContent>
        {onOpenFile && (
          <ContextMenuItem onClick={onOpenFile}>
            <HugeiconsIcon icon={FolderOpenIcon} strokeWidth={2} />
            {messages.repo.openInFileExplorer}
          </ContextMenuItem>
        )}
        {onOpenFile && (onHistory || onRestore) && <ContextMenuSeparator />}
        {onHistory && (
          <ContextMenuItem onClick={onHistory}>
            <HugeiconsIcon icon={HistoryIcon} strokeWidth={2} />
            {messages.detail.fileHistory}
          </ContextMenuItem>
        )}
        {onRestore && (
          <ContextMenuItem onClick={onRestore}>
            <HugeiconsIcon icon={FileSyncIcon} strokeWidth={2} />
            {messages.detail.restoreFromCommit}
          </ContextMenuItem>
        )}
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
  onHistory,
  onRestore,
  action,
}: {
  api: RepoApi
  file: T
  active?: boolean
  onOpen?(f: T): void
  onHistory?(f: T): void
  onRestore?(f: T): void
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
      onHistory={onHistory && (() => onHistory(file))}
      onRestore={onRestore && (() => onRestore(file))}
    />
  )
}

/* Render-ready tree node (perf audit, findings 4a/23/7): dirs and items pre-sorted, the
   subtree's file count and flattened file list computed once at construction — the render
   used to redo the `localeCompare` sorts and the `countFiles`/`collectFiles` recursions on
   every folder, every render (per keystroke with the commit form in the same component). */
type ViewTree<T> = {
  dirs: { label: string; node: ViewTree<T> }[]
  items: T[]
  /** total files in the subtree (the folder counter) */
  count: number
  /** all files of the subtree, flattened — to stage / unstage a folder in one go */
  all: T[]
}

function toViewTree<T extends FileChange>(node: PathTree<T>): ViewTree<T> {
  const dirs = [...node.dirs.keys()]
    .sort((a, b) => a.localeCompare(b))
    .map((label) => ({ label, node: toViewTree(node.dirs.get(label)!) }))
  const items = [...node.items].sort((a, b) => a.path.localeCompare(b.path))
  const all = [...items, ...dirs.flatMap((d) => d.node.all)]
  return { dirs, items, count: all.length, all }
}

function Tree<T extends FileChange>({
  node,
  prefix,
  collapsed,
  onToggleDir,
  api,
  activePath,
  onOpen,
  onHistory,
  onRestore,
  action,
  dirAction,
}: {
  node: ViewTree<T>
  /** path of `node` ("" at the root, "src/app/" below) — folder identity for `collapsed` */
  prefix: string
  /** collapsed folder paths — controlled here rather than `defaultOpen` on the Collapsible:
      a refetch rebuilds the tree with possibly different compacted labels, and uncontrolled
      state (living in the keyed-by-label component) used to pop folders back open and remount
      their subtrees on every stage/unstage (refresh audit, §3) */
  collapsed: ReadonlySet<string>
  onToggleDir(path: string, open: boolean): void
  api: RepoApi
  activePath?: string
  onOpen?(f: T): void
  onHistory?(f: T): void
  onRestore?(f: T): void
  action?(f: T): React.ReactNode
  /** one button per folder, acting on all files of the subtree */
  dirAction?(files: T[]): React.ReactNode
}) {
  return (
    <>
      {node.dirs.map(({ label, node: d }) => {
        const path = `${prefix}${label}/`
        return (
          <Collapsible key={label} open={!collapsed.has(path)} onOpenChange={(open) => onToggleDir(path, open)}>
            {/* trigger and folder button side by side: a button doesn't nest inside
                another. The row carries the hover; the chevron keeps its state on the trigger. */}
            <div className={cn("group/dirrow flex items-center rounded-sm pe-1 hover:bg-muted/60", ROW_CV_CLS)}>
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
                <span className="truncate font-medium">{label}</span>
                <span className="text-[0.625rem] text-muted-foreground tabular-nums">{d.count}</span>
              </CollapsibleTrigger>
              {dirAction?.(d.all)}
            </div>
            <CollapsibleContent className="ml-2 border-l pl-2">
              <Tree
                node={d}
                prefix={path}
                collapsed={collapsed}
                onToggleDir={onToggleDir}
                api={api}
                activePath={activePath}
                onOpen={onOpen}
                onHistory={onHistory}
                onRestore={onRestore}
                action={action}
                dirAction={dirAction}
              />
            </CollapsibleContent>
          </Collapsible>
        )
      })}
      {node.items.map((f) => (
        <TreeFile
          key={f.path}
          api={api}
          file={f}
          active={f.path === activePath}
          onOpen={onOpen}
          onHistory={onHistory}
          onRestore={onRestore}
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
function FileEntriesInner<T extends FileChange>({
  files,
  view,
  api,
  activePath,
  onOpen,
  onHistory,
  onRestore,
  action,
  dirAction,
}: {
  files: T[]
  view: FileView
  api: RepoApi
  activePath?: string
  onOpen?(f: T): void
  /** commit-anchored context entries (cf. FileRowProps) — only the detail panel passes them */
  onHistory?(f: T): void
  onRestore?(f: T): void
  action?(f: T): React.ReactNode
  /** tree view only: one button per folder, acting on all files of the subtree */
  dirAction?(files: T[]): React.ReactNode
}) {
  /* memo'd component + localized descendants (the row's context menu): re-render on a
     runtime language switch without waiting for a prop to change */
  useLocale()
  /* the built tree only depends on the file set: selection/diff/draft churn upstream no
     longer re-runs buildPathTree + the recursive sorts (perf audit, finding 4a) */
  const tree = useMemo(
    () => (view === "tree" ? toViewTree(compactPathTree(buildPathTree(files, (f) => f.path))) : null),
    [files, view]
  )
  /* collapsed folders, keyed by full path so the choice survives refetch-driven rebuilds
     (a folder that disappears and comes back — recompaction — simply defaults to open) */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const onToggleDir = useCallback((path: string, open: boolean) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      open ? next.delete(path) : next.add(path)
      return next
    })
  }, [])
  if (tree)
    return (
      <Tree
        node={tree}
        prefix=""
        collapsed={collapsed}
        onToggleDir={onToggleDir}
        api={api}
        activePath={activePath}
        onOpen={onOpen}
        onHistory={onHistory}
        onRestore={onRestore}
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
          onHistory={onHistory && (() => onHistory(f))}
          onRestore={onRestore && (() => onRestore(f))}
          action={action?.(f)}
        />
      ))}
    </>
  )
}

/* memo: with stable `files` arrays and callbacks upstream (worktree-panel useMemo/useCallback),
   a panel re-render whose file set hasn't moved skips the whole list. The cast keeps the
   generic signature — React.memo would erase `<T>`. */
export const FileEntries = memo(FileEntriesInner) as typeof FileEntriesInner

export function FileList({
  files,
  api,
  activePath,
  onOpen,
  onHistory,
  onRestore,
}: {
  files: FileChange[]
  api: RepoApi
  activePath?: string
  onOpen?(f: FileChange): void
  /** commit-anchored context entries (cf. FileRowProps) — only the detail panel passes them */
  onHistory?(f: FileChange): void
  onRestore?(f: FileChange): void
}) {
  const [view, setView] = useFileView()

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
      <FileListHeader actions={files.length > 0 && <FileViewToggle view={view} onChange={setView} />}>
        {messages.repo.fileCount(files.length)}
      </FileListHeader>

      <div data-file-nav="" className="min-h-0 flex-1 overflow-y-auto">
        <FileEntries
          files={files}
          view={view}
          api={api}
          activePath={activePath}
          onOpen={onOpen}
          onHistory={onHistory}
          onRestore={onRestore}
        />
      </div>
    </div>
  )
}
