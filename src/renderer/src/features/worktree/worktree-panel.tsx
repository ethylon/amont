import { useId, useState } from "react"
import type { IconSvgElement } from "@hugeicons/react"
import { ArchiveArrowDownIcon, MinusSignIcon, PlusSignIcon } from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi, Worktree, WtSource } from "@/lib/git"
import { messages } from "@/lib/messages"
import { useMergeStateQuery } from "@/features/conflict/conflict-queries"
import { useStatusQuery } from "@/features/repo/repo-queries"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { useRepoStore } from "@/features/repo/repo-store"
import { cn } from "@/lib/utils"
import { FileEntries, FileListHeader, FileViewToggle, useFileView, type FileView } from "@/features/repo/file-list"
import { GitCmd } from "@/components/ui/git-cmd"
import { IconButton } from "@/components/ui/icon-button"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

/** A tree file carries its source: that's what picks the diff command. */
type WtFile = FileChange & { source: WtSource }

export type WtAct = (api: RepoApi, paths: string[]) => Promise<void>

const STAGE: WtAct = (a, p) => a.stage(p)
const UNSTAGE: WtAct = (a, p) => a.unstage(p)

/* The per-row button only appears on hover, but stays reachable from the keyboard.
   after: click target widened horizontally only — vertically it would bite into the
   invisible button of the neighboring row. */
const HIT_CLS = "relative after:absolute after:-inset-x-1 after:-inset-y-px"
const ACTION_CLS = `ms-auto shrink-0 self-center opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 ${HIT_CLS}`
const DIR_ACTION_CLS = `shrink-0 self-center opacity-0 group-hover/dirrow:opacity-100 focus-visible:opacity-100 ${HIT_CLS}`

function WtBlock({
  title,
  files,
  view,
  api,
  activePath,
  onOpen,
  action,
  dirAction,
  bulk,
  empty,
  className,
}: {
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
            <Button
              variant="ghost"
              size="sm"
              className="h-auto py-0.5 normal-case tracking-normal"
              onClick={bulk.onClick}
            >
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

      <div data-file-nav="" className="min-h-0 flex-1 overflow-y-auto">
        {files.length ? (
          <FileEntries
            files={files}
            view={view}
            api={api}
            activePath={activePath}
            onOpen={onOpen}
            action={action}
            dirAction={dirAction}
          />
        ) : (
          <p className="px-1.5 py-0.5 text-xs text-muted-foreground">{empty}</p>
        )}
      </div>
    </div>
  )
}

/** Rendered by the slot layout when `worktree` has changes and the view is "wt" —
    this safeguard stays on RepoView's side, which already owns the query. */
const EMPTY_WT: Worktree = { staged: [], unstaged: [], untracked: [], conflicts: [] }

export function WorktreePanel() {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const { data: worktree = EMPTY_WT } = useWorktreeQuery(api, repoId)
  const { data: status } = useStatusQuery(api, repoId)
  const { data: mergeSt } = useMergeStateQuery(api, repoId)
  const activePath = useRepoStore((s) => s.ui.diff?.file.path ?? s.ui.conflict?.path)
  const subject = useRepoStore((s) => s.commitDraft.subject)
  const description = useRepoStore((s) => s.commitDraft.description)
  const amend = useRepoStore((s) => s.commitDraft.amend)
  const onSubjectChange = useRepoStore((s) => s.setSubject)
  const onDescriptionChange = useRepoStore((s) => s.setDescription)
  const onAmendChange = useRepoStore((s) => s.toggleAmend)
  const onOpenDiff = useRepoStore((s) => s.openDiff)
  const onOpenConflict = useRepoStore((s) => s.openConflict)
  const onAbortMerge = useRepoStore((s) => s.abortMerge)
  const onRun = useRepoStore((s) => s.runWt)
  const onCommit = useRepoStore((s) => s.doCommit)
  const runStash = useRepoStore((s) => s.runStash)
  const onStash = () => runStash("push", subject.trim() || undefined)

  /* a repo with no commits has nothing to amend */
  const canAmend = !!status?.head

  const [committing, setCommitting] = useState(false)
  const [view, setView] = useFileView()
  const amendId = useId()

  const staged = worktree.staged.length
  const hasConflicts = worktree.conflicts.length > 0
  const ready = subject.trim().length > 0 && !hasConflicts && (amend ? canAmend : staged > 0)

  /* Conflicts get their own block: a click opens the resolution view (not a diff), and
     they carry no stage button — staging a file still full of markers is exactly the
     mistake the dedicated flow (conflict-view.tsx) exists to prevent. */
  const conflicts: WtFile[] = worktree.conflicts.map((f) => ({ ...f, source: "unstaged" as const }))

  /* A single "unindexed" block: modifications and untracked files. Each keeps
     its source so the diff opens with the right command. */
  const unindexed: WtFile[] = [
    ...worktree.unstaged.map((f) => ({ ...f, source: "unstaged" as const })),
    ...worktree.untracked.map((f) => ({ ...f, source: "untracked" as const })),
  ]
  const indexed: WtFile[] = worktree.staged.map((f) => ({ ...f, source: "staged" as const }))

  const openDiff = (f: WtFile) => onOpenDiff({ wt: f.source }, f)

  /* The 4 stage/unstage × file/folder buttons only differed by label, icon,
     class (single vs per-folder) and target paths — a single factory (AUDIT.md §7, phase 5). */
  const wtButton = (label: string, icon: IconSvgElement, act: WtAct, dirScoped: boolean, paths: string[]) => (
    <IconButton
      label={label}
      icon={icon}
      size="icon-xs"
      className={dirScoped ? DIR_ACTION_CLS : ACTION_CLS}
      onClick={(ev) => {
        ev.stopPropagation()
        void onRun(act, paths)
      }}
    />
  )
  const stageBtn = (f: WtFile) => wtButton(messages.worktree.stage, PlusSignIcon, STAGE, false, [f.path])
  const unstageBtn = (f: WtFile) => wtButton(messages.worktree.unstage, MinusSignIcon, UNSTAGE, false, [f.path])
  const stageDir = (files: WtFile[]) =>
    wtButton(
      messages.worktree.stageFolder,
      PlusSignIcon,
      STAGE,
      true,
      files.map((f) => f.path)
    )
  const unstageDir = (files: WtFile[]) =>
    wtButton(
      messages.worktree.unstageFolder,
      MinusSignIcon,
      UNSTAGE,
      true,
      files.map((f) => f.path)
    )

  const verb = amend ? messages.worktree.amend : messages.worktree.commit
  const caption = messages.worktree.commitCaption(verb, staged)

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm leading-snug font-semibold tracking-tight text-balance">
          {messages.worktree.uncommittedChanges}
        </h2>
        <div className="flex items-center gap-1">
          <IconButton
            label={messages.worktree.stashChanges}
            title={messages.worktree.stashChanges}
            icon={ArchiveArrowDownIcon}
            size="icon-sm"
            onClick={onStash}
          />
          <FileViewToggle view={view} onChange={setView} />
        </div>
      </div>

      {/* Merge in progress: names both sides once for the whole panel — the same A/B
          vocabulary the conflict view uses — and offers the way out. */}
      {mergeSt?.merging && (
        <div className="mt-3 flex shrink-0 items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1">
          <span className="text-xs text-balance">
            {messages.conflict.mergeBanner(mergeSt.theirs ?? "MERGE_HEAD", mergeSt.ours ?? "HEAD")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-auto shrink-0 py-0.5 normal-case tracking-normal text-destructive"
            onClick={onAbortMerge}
          >
            <span className="flex flex-col items-start">
              <span>{messages.conflict.abortMerge}</span>
              <GitCmd cmd="git merge --abort" />
            </span>
          </Button>
        </div>
      )}

      {/* equal-share blocks, each with its own scroll, always visible */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col border-t pt-3">
        {hasConflicts && (
          <WtBlock
            title={messages.conflict.conflicts}
            files={conflicts}
            view={view}
            api={api}
            activePath={activePath}
            onOpen={(f) => onOpenConflict(f)}
            action={() => null}
            dirAction={() => null}
            empty=""
            className="pb-3"
          />
        )}
        <WtBlock
          title={messages.worktree.unstaged}
          files={unindexed}
          view={view}
          api={api}
          activePath={activePath}
          onOpen={openDiff}
          action={stageBtn}
          dirAction={stageDir}
          bulk={
            unindexed.length
              ? {
                  label: messages.worktree.stageAll,
                  cmd: "git add -- …",
                  onClick: () =>
                    onRun(
                      STAGE,
                      unindexed.map((f) => f.path)
                    ),
                }
              : undefined
          }
          empty={messages.worktree.noChangesToStage}
          className={cn("pb-3", hasConflicts && "border-t pt-3")}
        />
        <WtBlock
          title={messages.worktree.staged}
          files={indexed}
          view={view}
          api={api}
          activePath={activePath}
          onOpen={openDiff}
          action={unstageBtn}
          dirAction={unstageDir}
          bulk={
            indexed.length
              ? {
                  label: messages.worktree.unstageAll,
                  cmd: "git restore --staged -- …",
                  onClick: () =>
                    onRun(
                      UNSTAGE,
                      indexed.map((f) => f.path)
                    ),
                }
              : undefined
          }
          empty={messages.worktree.noStagedFiles}
          className="border-t pt-3"
        />
      </div>

      <FieldGroup className="mt-4 shrink-0 border-t pt-3">
        <Field data-invalid={hasConflicts || undefined}>
          {hasConflicts && <FieldError>{messages.worktree.resolveConflictsFirst}</FieldError>}
          <Input
            name="subject"
            aria-label={messages.worktree.commitMessage}
            placeholder={messages.worktree.commitMessage}
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
              aria-busy={committing}
              onClick={async () => {
                setCommitting(true)
                /* the "onCommit never rejects" contract isn't written down anywhere: without finally,
                   a rejection would leave the button disabled forever */
                try {
                  await onCommit()
                } finally {
                  setCommitting(false)
                }
              }}
            >
              {caption}
              <GitCmd
                cmd={amend ? 'git commit --amend -m "…"' : 'git commit -m "…"'}
                className="text-primary-foreground/70"
              />
            </Button>
            <div className={cn("flex shrink-0 items-center gap-1.5", !canAmend && "pointer-events-none opacity-50")}>
              <Checkbox id={amendId} checked={amend} disabled={!canAmend} onCheckedChange={(v) => onAmendChange(v)} />
              <label htmlFor={amendId} className="cursor-pointer text-xs text-muted-foreground select-none">
                {messages.worktree.amend}
              </label>
            </div>
          </div>
        </Field>
      </FieldGroup>
    </>
  )
}
