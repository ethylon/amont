import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, ListTreeIcon, Menu01Icon } from "@hugeicons/core-free-icons"

import type { FileChange } from "@/lib/git"
import { fileStatusColor } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
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
  onClick?(): void
  action?: React.ReactNode
}

export function FileRow({ file, active, nameOnly, onClick, action }: FileRowProps) {
  const cut = file.path.lastIndexOf("/")
  return (
    <div
      onClick={onClick}
      className={cn(
        "group/file flex cursor-pointer items-baseline gap-2 rounded-sm px-1.5 py-0.5 hover:bg-muted",
        active && "bg-primary/10 ring-1 ring-primary/25 ring-inset"
      )}
      title={file.path + (file.old ? `  ←  ${file.old}` : "")}
    >
      <span className={cn("w-3 shrink-0 font-mono text-[0.625rem] font-semibold", STATUS_TEXT[fileStatusColor(file.st)])}>
        {file.st}
      </span>
      {/* à plat : le dossier se tronque, le nom de fichier reste entier */}
      <span className="flex min-w-0 font-mono text-xs whitespace-nowrap">
        {!nameOnly && cut >= 0 && <span className="truncate text-muted-foreground">{file.path.slice(0, cut + 1)}</span>}
        <span className="shrink-0 truncate">{file.path.slice(cut + 1)}</span>
      </span>
      {action}
    </div>
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

function Tree({ node, activePath, onOpen }: { node: TreeNode; activePath?: string; onOpen?(f: FileChange): void }) {
  return (
    <>
      {[...node.dirs.keys()]
        .sort((a, b) => a.localeCompare(b))
        .map((k) => {
          const d = node.dirs.get(k)!
          return (
            <Collapsible key={k} defaultOpen>
              <CollapsibleTrigger className="group/dir flex w-full items-baseline gap-1.5 py-0.5 text-xs select-none focus-visible:rounded-xs focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none">
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  strokeWidth={2}
                  className="size-2.5 shrink-0 self-center text-muted-foreground transition-transform group-data-[panel-open]/dir:rotate-90 motion-reduce:transition-none"
                />
                <span className="truncate font-mono font-medium">{k}/</span>
                <span className="text-[0.625rem] text-muted-foreground tabular-nums">{countFiles(d)}</span>
              </CollapsibleTrigger>
              <CollapsibleContent className="ml-1 border-l pl-3">
                <Tree node={d} activePath={activePath} onOpen={onOpen} />
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      {[...node.files]
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((f) => (
          <FileRow key={f.path} file={f} nameOnly active={f.path === activePath} onClick={onOpen && (() => onOpen(f))} />
        ))}
    </>
  )
}

export function FileListHeader({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-2 flex min-h-6 items-center justify-between text-[0.625rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
      <span>{children}</span>
      {actions}
    </div>
  )
}

export function FileList({ files, activePath, onOpen }: {
  files: FileChange[]
  activePath?: string
  onOpen?(f: FileChange): void
}) {
  const [view, setView] = useState<FileView>(() => (localStorage.getItem("gg.fileview") as FileView) || "flat")

  const setAndStore = (v: FileView) => {
    setView(v)
    localStorage.setItem("gg.fileview", v)
  }

  return (
    <div className="mt-4 border-t pt-3">
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

      {view === "tree" ? (
        <Tree node={buildTree(files)} activePath={activePath} onOpen={onOpen} />
      ) : (
        files.map((f) => (
          <FileRow key={f.path} file={f} active={f.path === activePath} onClick={onOpen && (() => onOpen(f))} />
        ))
      )}
    </div>
  )
}
