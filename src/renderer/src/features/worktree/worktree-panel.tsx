import { useId, useState } from "react"
import { ArchiveArrowDownIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi, Worktree, WtSource } from "@/lib/git"
import { useStatusQuery } from "@/features/repo/repo-queries"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { useRepoStore } from "@/features/repo/repo-store"
import { cn } from "@/lib/utils"
import { FileEntries, FileListHeader, FileViewToggle, useFileView, type FileView } from "@/features/repo/file-list"
import { GitCmd } from "@/components/ui/git-cmd"
import { IconButton } from "@/components/ui/icon-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/primitives/checkbox"
import { Field, FieldError, FieldGroup } from "@/components/ui/primitives/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/primitives/textarea"

/** Un fichier de l'arbre porte sa source : c'est elle qui choisit la commande de diff. */
type WtFile = FileChange & { source: WtSource }

export type WtAct = (api: RepoApi, paths: string[]) => Promise<void>

const STAGE: WtAct = (a, p) => a.stage(p)
const UNSTAGE: WtAct = (a, p) => a.unstage(p)

/* Le bouton par ligne n'apparaît qu'au survol, mais reste atteignable au clavier.
   after : cible de clic élargie en largeur seulement — en hauteur elle mordrait sur le bouton
   invisible de la ligne voisine. */
const HIT_CLS = "relative after:absolute after:-inset-x-1 after:-inset-y-px"
const ACTION_CLS = `ms-auto shrink-0 self-center opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 ${HIT_CLS}`
const DIR_ACTION_CLS = `shrink-0 self-center opacity-0 group-hover/dirrow:opacity-100 focus-visible:opacity-100 ${HIT_CLS}`

function WtBlock({ title, files, view, api, activePath, onOpen, action, dirAction, bulk, empty, className }: {
  title: string
  files: WtFile[]
  view: FileView
  api: RepoApi
  activePath?: string
  onOpen(f: WtFile): void
  action(f: WtFile): React.ReactNode
  dirAction(files: WtFile[]): React.ReactNode
  bulk?: { label: string; cmd: string; onClick(): void }
  empty: string
  className?: string
}) {
  return (
    <div className={cn("flex min-h-0 flex-1 basis-0 flex-col", className)}>
      <FileListHeader
        actions={
          files.length > 0 &&
          bulk && (
            <Button variant="ghost" size="sm" className="h-auto py-0.5 normal-case tracking-normal" onClick={bulk.onClick}>
              <span className="flex flex-col items-start">
                <span>{bulk.label}</span>
                <GitCmd cmd={bulk.cmd} />
              </span>
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

/** Rendu par le layout de slots quand `worktree` a des changements et que la vue est "wt" —
    ce garde-fou reste côté RepoView, qui possède déjà la requête. */
const EMPTY_WT: Worktree = { staged: [], unstaged: [], untracked: [], conflicts: [] }

export function WorktreePanel() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const { data: worktree = EMPTY_WT } = useWorktreeQuery(api, repoId)
  const { data: status } = useStatusQuery(api, repoId)
  const activePath = useRepoStore((s) => s.ui.diff?.file.path)
  const subject = useRepoStore((s) => s.commitDraft.subject)
  const description = useRepoStore((s) => s.commitDraft.description)
  const amend = useRepoStore((s) => s.commitDraft.amend)
  const onSubjectChange = useRepoStore((s) => s.setSubject)
  const onDescriptionChange = useRepoStore((s) => s.setDescription)
  const onAmendChange = useRepoStore((s) => s.toggleAmend)
  const onOpenDiff = useRepoStore((s) => s.openDiff)
  const onRun = useRepoStore((s) => s.runWt)
  const onCommit = useRepoStore((s) => s.doCommit)
  const runStash = useRepoStore((s) => s.runStash)
  const onStash = () => runStash("push", subject.trim() || undefined)

  /* un dépôt sans commit n'a rien à amender */
  const canAmend = !!status?.head

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
        <h2 className="text-sm leading-snug font-semibold tracking-tight text-balance">Modifications non validées</h2>
        <div className="flex items-center gap-1">
          <IconButton
            label="Stasher les modifications (git stash push -u)"
            title="Stasher les modifications (git stash push -u)"
            icon={ArchiveArrowDownIcon}
            size="icon-sm"
            onClick={onStash}
          />
          <FileViewToggle view={view} onChange={setView} />
        </div>
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
            unindexed.length ? { label: "Tout indexer", cmd: "git add -- …", onClick: () => onRun(STAGE, unindexed.map((f) => f.path)) } : undefined
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
            indexed.length ? { label: "Tout désindexer", cmd: "git restore --staged -- …", onClick: () => onRun(UNSTAGE, indexed.map((f) => f.path)) } : undefined
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
              className="h-auto flex-1 flex-col gap-0 py-1"
              disabled={!ready || committing}
              onClick={async () => {
                setCommitting(true)
                /* le contrat « onCommit ne rejette pas » n'est écrit nulle part : sans finally,
                   un rejet laisserait le bouton désactivé pour toujours */
                try {
                  await onCommit()
                } finally {
                  setCommitting(false)
                }
              }}
            >
              {caption}
              <GitCmd cmd={amend ? 'git commit --amend -m "…"' : 'git commit -m "…"'} className="text-primary-foreground/70" />
            </Button>
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
          </div>
        </Field>
      </FieldGroup>
    </>
  )
}
