import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, File01Icon, Folder01Icon, ListTreeIcon, Menu01Icon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi } from "@/lib/git"
import { fileStatusColor } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/primitives/collapsible"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/primitives/toggle-group"

export type FileView = "flat" | "tree"

/* Vue à plat / arborescence, mémorisée pour tous les panneaux de fichiers (détail de commit,
   staging) : la basculer d'un côté s'applique à l'autre dès son prochain montage. */
export function useFileView() {
  const [view, setView] = useState<FileView>(() => (localStorage.getItem("gg.fileview") as FileView) || "tree")
  const set = (v: FileView) => {
    setView(v)
    localStorage.setItem("gg.fileview", v)
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
      <ToggleGroupItem value="flat" aria-label="Vue à plat">
        <HugeiconsIcon icon={Menu01Icon} strokeWidth={2} />
      </ToggleGroupItem>
      <ToggleGroupItem value="tree" aria-label="Arborescence">
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
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group/file flex cursor-pointer items-baseline gap-2 rounded-sm border border-transparent px-1.5 py-0.5 hover:bg-muted",
        active && "border-primary bg-primary/30"
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

function TreeFile<T extends FileChange>({ api, file, active, onOpen, action }: {
  api: RepoApi
  file: T
  active?: boolean
  onOpen?(f: T): void
  action?: React.ReactNode
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <FileRow
      file={file}
      nameOnly
      icon={<FileIcon api={api} path={file.path} />}
      active={active}
      action={action}
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

type TreeNode<T> = { dirs: Map<string, TreeNode<T>>; files: T[] }

function buildTree<T extends FileChange>(list: T[]): TreeNode<T> {
  const root: TreeNode<T> = { dirs: new Map(), files: [] }
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

const countFiles = <T,>(d: TreeNode<T>): number =>
  d.files.length + [...d.dirs.values()].reduce((n, c) => n + countFiles(c), 0)

/** Tous les fichiers d'un sous-arbre, à plat — pour indexer / désindexer un dossier d'un coup. */
const collectFiles = <T,>(d: TreeNode<T>): T[] =>
  [...d.files, ...[...d.dirs.values()].flatMap((c) => collectFiles(c))]

function Tree<T extends FileChange>({ node, api, activePath, onOpen, action, dirAction }: {
  node: TreeNode<T>
  api: RepoApi
  activePath?: string
  onOpen?(f: T): void
  action?(f: T): React.ReactNode
  /** bouton par dossier, portant sur tous les fichiers du sous-arbre */
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
              {/* trigger et bouton de dossier côte à côte : un bouton ne s'imbrique pas dans un
                  autre. La rangée porte le survol ; le chevron garde son état sur le trigger. */}
              <div className="group/dirrow flex items-center rounded-sm pe-1 hover:bg-muted">
                <CollapsibleTrigger className="group/dir flex min-w-0 flex-1 items-center gap-1.5 rounded-sm px-1.5 py-0.5 text-xs select-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    strokeWidth={2}
                    className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
                  />
                  <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate font-medium">{k}</span>
                  <span className="text-[0.625rem] text-muted-foreground tabular-nums">{countFiles(d)}</span>
                </CollapsibleTrigger>
                {dirAction?.(collectFiles(d))}
              </div>
              <CollapsibleContent className="ml-2 border-l pl-2">
                <Tree node={d} api={api} activePath={activePath} onOpen={onOpen} action={action} dirAction={dirAction} />
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      {[...node.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => (
          <TreeFile key={f.path} api={api} file={f} active={f.path === activePath} onOpen={onOpen} action={action?.(f)} />
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

/* Rendu nu des fichiers, à plat ou en arbre — sans en-tête ni conteneur de scroll, que
   l'appelant possède. `action` greffe un bouton par fichier (indexer / désindexer). */
export function FileEntries<T extends FileChange>({ files, view, api, activePath, onOpen, action, dirAction }: {
  files: T[]
  view: FileView
  api: RepoApi
  activePath?: string
  onOpen?(f: T): void
  action?(f: T): React.ReactNode
  /** vue arbre seulement : bouton par dossier, portant sur tous les fichiers du sous-arbre */
  dirAction?(files: T[]): React.ReactNode
}) {
  if (view === "tree")
    return <Tree node={buildTree(files)} api={api} activePath={activePath} onOpen={onOpen} action={action} dirAction={dirAction} />
  return (
    <>
      {files.map((f) => (
        <FileRow
          key={f.path}
          file={f}
          active={f.path === activePath}
          onClick={onOpen && (() => onOpen(f))}
          action={action?.(f)}
        />
      ))}
    </>
  )
}

export function FileList({ files, api, activePath, onOpen }: {
  files: FileChange[]
  api: RepoApi
  activePath?: string
  onOpen?(f: FileChange): void
}) {
  const [view, setView] = useFileView()

  return (
    <div className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
      <FileListHeader actions={files.length > 0 && <FileViewToggle view={view} onChange={setView} />}>
        {files.length ? `${files.length} fichier${files.length > 1 ? "s" : ""}` : "aucun fichier"}
      </FileListHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <FileEntries files={files} view={view} api={api} activePath={activePath} onOpen={onOpen} />
      </div>
    </div>
  )
}
