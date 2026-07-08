import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, File01Icon, Folder01Icon, ListTreeIcon, Menu01Icon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi } from "@/lib/git"
import { fileStatusColor } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import { Tip } from "@/components/ui/tip"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/primitives/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/primitives/toggle-group"

type FileView = "flat" | "tree"

const STATUS_TEXT: Record<string, string> = {
  neutral: "text-muted-foreground",
  success: "text-success",
  warning: "text-warning",
  danger: "text-destructive",
}

export type FileRowProps = {
  file: FileChange
  active?: boolean
  nameOnly?: boolean
  icon?: React.ReactNode
  onClick?(): void
  onDoubleClick?(): void
  action?: React.ReactNode
}

export function FileRow({ file, active, nameOnly, icon, onClick, onDoubleClick, action }: FileRowProps) {
  const cut = file.path.lastIndexOf("/")
  return (
    <Tip text={file.path + (file.old ? `  ←  ${file.old}` : "")} align="start">
      <div
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        className={cn(
          "group/file flex cursor-pointer items-baseline gap-2 rounded-sm px-1.5 py-0.5 hover:bg-muted",
          active && "bg-primary/10 ring-1 ring-primary/25 ring-inset"
        )}
      >
        <span className={cn("w-3 shrink-0 text-[0.625rem] font-semibold", STATUS_TEXT[fileStatusColor(file.st)])}>
          {file.st}
        </span>
        {icon}
        {/* à plat : le dossier se tronque, le nom de fichier reste entier */}
        <span className="flex min-w-0 text-xs whitespace-nowrap">
          {!nameOnly && cut >= 0 && <span className="truncate text-muted-foreground">{file.path.slice(0, cut + 1)}</span>}
          <span className="shrink-0 truncate">{file.path.slice(cut + 1)}</span>
        </span>
        {action}
      </div>
    </Tip>
  )
}

/* Les icônes shell de Windows sont attachées à l'extension : un seul aller-retour IPC par
   extension, pas par fichier. Un `null` (fichier absent du disque) n'est pas mémorisé. */
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
    api.fileIcon(path).then((d) => {
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

/* Le simple-clic attend la fenêtre de double-clic : sinon ouvrir le fichier ouvrirait aussi
   son diff au passage. Windows laisse 500 ms par défaut, non lisible depuis le renderer. */
const DBLCLICK_MS = 250

function TreeFile({ api, file, active, onOpen }: {
  api: RepoApi
  file: FileChange
  active?: boolean
  onOpen?(f: FileChange): void
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <FileRow
      file={file}
      nameOnly
      icon={<FileIcon api={api} path={file.path} />}
      active={active}
      onClick={
        onOpen &&
        (() => {
          clearTimeout(timer.current)
          timer.current = setTimeout(() => onOpen(file), DBLCLICK_MS)
        })
      }
      onDoubleClick={() => {
        clearTimeout(timer.current)
        api.openFile(file.path)
      }}
    />
  )
}

type TreeNode = { dirs: Map<string, TreeNode>; files: FileChange[] }

function buildTree(list: FileChange[]): TreeNode {
  const root: TreeNode = { dirs: new Map(), files: [] }
  for (const f of list) {
    const parts = f.path.split("/")
    let n = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), files: [] })
      n = n.dirs.get(parts[i])!
    }
    n.files.push(f)
  }
  return root
}

const countFiles = (d: TreeNode): number =>
  d.files.length + [...d.dirs.values()].reduce((n, c) => n + countFiles(c), 0)

function Tree({ node, api, activePath, onOpen }: {
  node: TreeNode
  api: RepoApi
  activePath?: string
  onOpen?(f: FileChange): void
}) {
  return (
    <>
      {[...node.dirs.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((k) => {
          const d = node.dirs.get(k)!
          return (
            <Collapsible key={k} defaultOpen>
              <CollapsibleTrigger className="group/dir flex w-full items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
                />
                <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate font-medium">{k}</span>
                <span className="text-[0.625rem] text-muted-foreground tabular-nums">{countFiles(d)}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-2 border-l pl-2">
                <Tree node={d} api={api} activePath={activePath} onOpen={onOpen} />
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      {[...node.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => (
          <TreeFile key={f.path} api={api} file={f} active={f.path === activePath} onOpen={onOpen} />
        ))}
    </>
  )
}

export function FileListHeader({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-6 shrink-0 items-center justify-between text-[0.625rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
      <span>{children}</span>
      {actions}
    </div>
  )
}

export function FileList({ files, api, activePath, onOpen }: {
  files: FileChange[]
  api: RepoApi
  activePath?: string
  onOpen?(f: FileChange): void
}) {
  const [view, setView] = useState<FileView>(() => (localStorage.getItem("gg.fileview") as FileView) || "tree")

  const setAndStore = (v: FileView) => {
    setView(v)
    localStorage.setItem("gg.fileview", v)
  }

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
      <FileListHeader
        actions={
          files.length > 0 && (
            <ToggleGroup
              spacing={0}
              variant="outline"
              size="sm"
              value={[view]}
              onValueChange={(v) => v[0] && setAndStore(v[0] as FileView)}
            >
              <ToggleGroupItem value="flat" aria-label="Vue à plat">
                <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
              </ToggleGroupItem>
              <ToggleGroupItem value="tree" aria-label="Arborescence">
                <HugeiconsIcon icon={ListTreeIcon} strokeWidth={2} />
              </ToggleGroupItem>
            </ToggleGroup>
          )
        }
      >
        {files.length ? `${files.length} fichier${files.length > 1 ? "s" : ""}` : "aucun fichier"}
      </FileListHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === "tree" ? (
          <Tree node={buildTree(files)} api={api} activePath={activePath} onOpen={onOpen} />
        ) : (
          files.map((f) => (
            <FileRow key={f.path} file={f} active={f.path === activePath} onClick={onOpen && (() => onOpen(f))} />
          ))
        )}
      </div>
    </div>
  )
}
