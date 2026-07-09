import { useId, useState } from "react"
import { MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi, Worktree, WtSource } from "@/lib/git"
import type { DiffCtx } from "@/components/diff-view"
import { cn } from "@/lib/utils"
import { FileEntries, FileListHeader, FileViewToggle, useFileView, type FileView } from "@/components/file-list"
import { IconButton } from "@/components/ui/icon-button"
import { Tip } from "@/components/ui/tip"
import { Button } from "@/components/ui/primitives/button"
import { Checkbox } from "@/components/ui/primitives/checkbox"
import { Field, FieldError, FieldGroup } from "@/components/ui/primitives/field"
import { Input } from "@/components/ui/primitives/input"
import { Textarea } from "@/components/ui/primitives/textarea"

/** Un fichier de l'arbre porte sa source : c'est elle qui choisit la commande de diff. */
type WtFile = FileChange & { source: WtSource }

export type WtAct = (api: RepoApi, paths: string[]) => Promise<void>

const STAGE: WtAct = (a, p) => a.stage(p)
const UNSTAGE: WtAct = (a, p) => a.unstage(p)

/* Le bouton par ligne n'apparaît qu'au survol, mais reste atteignable au clavier. */
const ACTION_CLS = "ms-auto shrink-0 self-center opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100"
const DIR_ACTION_CLS = "shrink-0 self-center opacity-0 group-hover/dirrow:opacity-100 focus-visible:opacity-100"

function WtBlock({ title, files, view, api, activePath, onOpen, action, dirAction, bulk, empty, className }: {
  title: string
  files: WtFile[]
  view: FileView
  api: RepoApi
  activePath?: string
  onOpen(f: WtFile): void
  action(f: WtFile): React.ReactNode
  dirAction(files: WtFile[]): React.ReactNode
  bulk?: { label: string; onClick(): void }
  empty: string
  className?: string
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 basis-0 flex-col", className)}>
      <FileListHeader
        actions={
          files.length > 0 &&
          bulk && (
            <Button variant="ghost" size="sm" className="normal-case tracking-normal" onClick={bulk.onClick}>
              {bulk.label}
            </Button>
          )
        }
      >
        {title} · {files.length}
      </FileListHeader>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length ? (
          <FileEntries files={files} view={view} api={api} activePath={activePath} onOpen={onOpen} action={action} dirAction={dirAction} />
        ) : (
          <p className="px-1.5 py-0.5 text-xs text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  )
}

type Props = {
  api: RepoApi
  worktree: Worktree
  activePath?: string
  /** première ligne du message ; la description remplit le corps */
  subject: string
  description: string
  /** l'amend est piloté par la vue parente : elle préremplit le message et restaure le brouillon */
  amend: boolean
  /** un dépôt sans commit n'a rien à amender */
  canAmend: boolean
  onSubjectChange(v: string): void
  onDescriptionChange(v: string): void
  onAmendChange(v: boolean): void
  onOpenDiff(ctx: DiffCtx, file: FileChange): void
  onRun(act: WtAct, paths: string[]): void
  onCommit(): Promise<void>
}

export function WorktreePanel({
  api, worktree, activePath, subject, description, amend, canAmend,
  onSubjectChange, onDescriptionChange, onAmendChange, onOpenDiff, onRun, onCommit,
}: Props) {
  const [committing, setCommitting] = useState(false)
  const [view, setView] = useFileView()
  const amendId = useId()

  const staged = worktree.staged.length
  const hasConflicts = worktree.conflicts.length > 0
  const ready = subject.trim().length > 0 && !hasConflicts && (amend ? canAmend : staged > 0)

  /* Un seul bloc « non indexés » : conflits, modifications et fichiers non suivis. Chacun garde
     sa source pour que le diff s'ouvre avec la bonne commande. */
  const unindexed: WtFile[] = [
    ...worktree.conflicts.map((f) => ({ ...f, source: "unstaged" as const })),
    ...worktree.unstaged.map((f) => ({ ...f, source: "unstaged" as const })),
    ...worktree.untracked.map((f) => ({ ...f, source: "untracked" as const })),
  ]
  const indexed: WtFile[] = worktree.staged.map((f) => ({ ...f, source: "staged" as const }))

  const openDiff = (f: WtFile) => onOpenDiff({ wt: f.source }, f)

  const stageBtn = (f: WtFile) => (
    <IconButton
      label="Indexer"
      icon={PlusSignIcon}
      size="icon-xs"
      className={ACTION_CLS}
      onClick={(ev) => {
        ev.stopPropagation()
        onRun(STAGE, [f.path])
      }}
    />
  )
  const unstageBtn = (f: WtFile) => (
    <IconButton
      label="Désindexer"
      icon={MinusSignIcon}
      size="icon-xs"
      className={ACTION_CLS}
      onClick={(ev) => {
        ev.stopPropagation()
        onRun(UNSTAGE, [f.path])
      }}
    />
  )

  const stageDir = (files: WtFile[]) => (
    <IconButton
      label="Indexer le dossier"
      icon={PlusSignIcon}
      size="icon-xs"
      className={DIR_ACTION_CLS}
      onClick={(ev) => {
        ev.stopPropagation()
        onRun(STAGE, files.map((f) => f.path))
      }}
    />
  )
  const unstageDir = (files: WtFile[]) => (
    <IconButton
      label="Désindexer le dossier"
      icon={MinusSignIcon}
      size="icon-xs"
      className={DIR_ACTION_CLS}
      onClick={(ev) => {
        ev.stopPropagation()
        onRun(UNSTAGE, files.map((f) => f.path))
      }}
    />
  )

  const verb = amend ? "Amender" : "Commit"
  const caption = staged ? `${verb} · ${staged} fichier${staged > 1 ? "s" : ""}` : verb

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm leading-snug font-semibold tracking-tight">Modifications non validées</h2>
        <FileViewToggle view={view} onChange={setView} />
      </div>

      {/* deux blocs à parts égales, chacun avec son propre défilement, toujours visibles */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
        <WtBlock
          title="Non indexés"
          files={unindexed}
          view={view}
          api={api}
          activePath={activePath}
          onOpen={openDiff}
          action={stageBtn}
          dirAction={stageDir}
          bulk={
            unindexed.length ? { label: "Tout indexer", onClick: () => onRun(STAGE, unindexed.map((f) => f.path)) } : undefined
          }
          empty="Aucun changement à indexer."
          className="pb-3"
        />
        <WtBlock
          title="Indexés"
          files={indexed}
          view={view}
          api={api}
          activePath={activePath}
          onOpen={openDiff}
          action={unstageBtn}
          dirAction={unstageDir}
          bulk={
            indexed.length ? { label: "Tout désindexer", onClick: () => onRun(UNSTAGE, indexed.map((f) => f.path)) } : undefined
          }
          empty="Aucun fichier indexé."
          className="border-t pt-3"
        />
      </div>

      <FieldGroup className="mt-4 shrink-0 border-t pt-3">
        <Field data-invalid={hasConflicts || undefined}>
          {hasConflicts && <FieldError>Résous les conflits avant de committer.</FieldError>}
          <Input
            name="subject"
            aria-label="Message de commit"
            placeholder="Message de commit"
            value={subject}
            onChange={(e) => onSubjectChange(e.target.value)}
          />
          <Textarea
            name="description"
            aria-label="Description"
            placeholder="Description"
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            className="min-h-16 resize-y text-xs"
          />
          <div className="flex items-center gap-3">
            <Button
              className="flex-1"
              disabled={!ready || committing}
              onClick={async () => {
                setCommitting(true)
                await onCommit()
                setCommitting(false)
              }}
            >
              {caption}
            </Button>
            <Tip text="Reprendre le dernier commit — son message et les fichiers indexés">
              <div
                className={cn(
                  "flex shrink-0 items-center gap-1.5",
                  !canAmend && "pointer-events-none opacity-50"
                )}
              >
                <Checkbox id={amendId} checked={amend} disabled={!canAmend} onCheckedChange={(v) => onAmendChange(v)} />
                <label htmlFor={amendId} className="cursor-pointer text-xs text-muted-foreground select-none">
                  Amender
                </label>
              </div>
            </Tip>
          </div>
        </Field>
      </FieldGroup>
    </>
  )
}
