import { memo, useCallback, useId, useMemo, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArchiveArrowDownIcon,
  ArrowTurnBackwardIcon,
  MinusSignIcon,
  MoreVerticalIcon,
  PlusSignIcon,
} from "@hugeicons/core-free-icons"

import type { FileChange, RepoApi, Worktree, WtSource } from "@/lib/git"
import { useLocale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { useMergeStateQuery } from "@/features/conflict/conflict-queries"
import { useStatusQuery } from "@/features/repo/repo-queries"
import { DiscardDialog, type DiscardRequest } from "@/features/worktree/discard-dialog"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { useRepoStore, useRepoStoreApi } from "@/features/repo/repo-store"
import { cn } from "@/lib/utils"
import { FileEntries, FileListHeader, FileViewToggle, useFileView, type FileView } from "@/features/repo/file-list"
import { GitCmd, MenuItemWithCmd } from "@/components/ui/git-cmd"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
   invisible button of the neighboring row. Rows with two actions (discard + stage) put
   `ms-auto` on the first button alone: two auto margins would split the free space. */
const HIT_CLS = "relative after:absolute after:-inset-x-1 after:-inset-y-px"
const ROW_ACTION_CLS = `shrink-0 self-center opacity-0 group-hover/file:opacity-100 focus-visible:opacity-100 ${HIT_CLS}`
const ACTION_CLS = `ms-auto ${ROW_ACTION_CLS}`
const DIR_ACTION_CLS = `shrink-0 self-center opacity-0 group-hover/dirrow:opacity-100 focus-visible:opacity-100 ${HIT_CLS}`

/** Bulk action of a block, an entry of its kebab menu. Destructive entries land
    after a separator, at the bottom, whatever order the caller passes. */
type WtMenuItem = { label: string; cmd: string; icon: IconSvgElement; onClick(): void; destructive?: boolean }

function WtBlockMenu({ items }: { items: WtMenuItem[] }) {
  const entry = (i: WtMenuItem) => (
    <DropdownMenuItem key={i.label} variant={i.destructive ? "destructive" : "default"} onClick={i.onClick}>
      <HugeiconsIcon icon={i.icon} strokeWidth={2} />
      <MenuItemWithCmd label={i.label} cmd={i.cmd} />
    </DropdownMenuItem>
  )
  const safe = items.filter((i) => !i.destructive)
  const destructive = items.filter((i) => i.destructive)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<IconButton label={messages.worktree.moreActions} icon={MoreVerticalIcon} size="icon-xs" />}
      />
      <DropdownMenuContent align="end" className="w-max min-w-44">
        {safe.map(entry)}
        {destructive.length > 0 && <DropdownMenuSeparator />}
        {destructive.map(entry)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* memo: the panel re-renders on any worktree/status/mergeState refetch; a block whose
   files array (memoized upstream) and callbacks (all stable) haven't moved skips its
   whole subtree — with hundreds of dirty files that's the bulk of the panel's tree. */
const WtBlock = memo(function WtBlock({
  title,
  files,
  view,
  api,
  activePath,
  onOpen,
  action,
  dirAction,
  menu,
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
  menu?: WtMenuItem[]
  empty: string
  className?: string
}) {
  /* memo'd component: a runtime language switch must re-render it even when no prop moved
     (`useLocale` subscribes this component directly, bypassing the memo) */
  useLocale()
  return (
    <div className={cn("flex min-h-0 flex-1 basis-0 flex-col", className)}>
      <FileListHeader actions={files.length > 0 && menu && <WtBlockMenu items={menu} />}>
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
})

/** conflict rows carry no stage/discard buttons — a stable no-op keeps WtBlock's memo intact */
const NO_ACTION = () => null

/** Rendered by the slot layout when `worktree` has changes and the view is "wt" —
    this safeguard stays on RepoView's side, which already owns the query. */
const EMPTY_WT: Worktree = { staged: [], unstaged: [], untracked: [], conflicts: [] }

/* The commit form is the only part of the panel that reads `commitDraft`: isolating it
   keeps each keystroke's re-render confined to these few fields instead of rebuilding the
   three file blocks above (per-keystroke jank with a large dirty tree). memo: the parent
   still re-renders on worktree refetches, but the form's two props are primitives. */
const CommitForm = memo(function CommitForm({ staged, hasConflicts }: { staged: number; hasConflicts: boolean }) {
  /* memo'd component: re-render on a runtime language switch even when no prop moved */
  useLocale()
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const { data: status } = useStatusQuery(api, repoId)
  const subject = useRepoStore((s) => s.commitDraft.subject)
  const description = useRepoStore((s) => s.commitDraft.description)
  const amend = useRepoStore((s) => s.commitDraft.amend)
  const onSubjectChange = useRepoStore((s) => s.setSubject)
  const onDescriptionChange = useRepoStore((s) => s.setDescription)
  const onAmendChange = useRepoStore((s) => s.toggleAmend)
  const onCommit = useRepoStore((s) => s.doCommit)

  /* a repo with no commits has nothing to amend */
  const canAmend = !!status?.head

  const [committing, setCommitting] = useState(false)
  const amendId = useId()

  const ready = subject.trim().length > 0 && !hasConflicts && (amend ? canAmend : staged > 0)
  const verb = amend ? messages.worktree.amend : messages.worktree.commit
  const caption = messages.worktree.commitCaption(verb, staged)

  return (
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
  )
})

export function WorktreePanel() {
  /* the memoized menu entries below capture localized strings: `locale` in their deps
     rebuilds them on a runtime language switch */
  const locale = useLocale()
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const storeApi = useRepoStoreApi()
  const { data: worktree = EMPTY_WT } = useWorktreeQuery(api, repoId)
  const { data: mergeSt } = useMergeStateQuery(api, repoId)
  const activePath = useRepoStore((s) => s.ui.diff?.file.path ?? s.ui.conflict?.path)
  const onOpenDiff = useRepoStore((s) => s.openDiff)
  const onOpenConflict = useRepoStore((s) => s.openConflict)
  const onAbortMerge = useRepoStore((s) => s.abortMerge)
  const onRun = useRepoStore((s) => s.runWt)
  const onDiscard = useRepoStore((s) => s.runDiscard)
  const runStash = useRepoStore((s) => s.runStash)

  /* pending discard, held until the confirmation dialog resolves it */
  const [discardReq, setDiscardReq] = useState<DiscardRequest | null>(null)

  const [view, setView] = useFileView()

  const staged = worktree.staged.length
  const hasConflicts = worktree.conflicts.length > 0

  /* Conflicts get their own block: a click opens the resolution view (not a diff), and
     they carry no stage button — staging a file still full of markers is exactly the
     mistake the dedicated flow (conflict-view.tsx) exists to prevent. */
  const conflicts = useMemo<WtFile[]>(
    () => worktree.conflicts.map((f) => ({ ...f, source: "unstaged" as const })),
    [worktree]
  )

  /* A single "unindexed" block: modifications and untracked files. Each keeps
     its source so the diff opens with the right command. Memoized on the query data:
     stable arrays let the memoized blocks (and FileEntries' tree build) skip entirely
     when something else — activePath, the merge banner — re-renders the panel. */
  const unindexed = useMemo<WtFile[]>(
    () => [
      ...worktree.unstaged.map((f) => ({ ...f, source: "unstaged" as const })),
      ...worktree.untracked.map((f) => ({ ...f, source: "untracked" as const })),
    ],
    [worktree]
  )
  const indexed = useMemo<WtFile[]>(() => worktree.staged.map((f) => ({ ...f, source: "staged" as const })), [worktree])

  const openDiff = useCallback((f: WtFile) => onOpenDiff({ wt: f.source }, f), [onOpenDiff])

  /* The 4 stage/unstage × file/folder buttons only differed by label, icon,
     class (single vs per-folder) and target paths — a single factory (AUDIT.md §7, phase 5). */
  const wtButton = useCallback(
    (label: string, icon: IconSvgElement, act: WtAct, dirScoped: boolean, paths: string[], cls?: string) => (
      <IconButton
        label={label}
        icon={icon}
        size="icon-xs"
        className={cls ?? (dirScoped ? DIR_ACTION_CLS : ACTION_CLS)}
        onClick={(ev) => {
          ev.stopPropagation()
          void onRun(act, paths)
        }}
      />
    ),
    [onRun]
  )
  const unstageBtn = useCallback(
    (f: WtFile) => wtButton(messages.worktree.unstage, MinusSignIcon, UNSTAGE, false, [f.path]),
    [wtButton]
  )

  /* Splits a file set by source: tracked go through `git restore`, untracked through
     `git clean`. Nothing runs here — the request waits for the confirmation dialog. */
  const askDiscard = useCallback(
    (files: WtFile[]) =>
      setDiscardReq({
        paths: files.filter((f) => f.source !== "untracked").map((f) => f.path),
        untracked: files.filter((f) => f.source === "untracked").map((f) => f.path),
      }),
    []
  )
  /* discard first, stage second: only the leading button carries `ms-auto` (ACTION_CLS) */
  const unindexedActions = useCallback(
    (f: WtFile) => (
      <>
        <IconButton
          label={messages.worktree.discard}
          icon={ArrowTurnBackwardIcon}
          size="icon-xs"
          className={cn(ACTION_CLS, "text-destructive hover:text-destructive")}
          onClick={(ev) => {
            ev.stopPropagation()
            askDiscard([f])
          }}
        />
        {wtButton(messages.worktree.stage, PlusSignIcon, STAGE, false, [f.path], ROW_ACTION_CLS)}
      </>
    ),
    [askDiscard, wtButton]
  )
  /* Folder row of the unindexed block mirrors the per-file actions: discard first, stage
     second, both scoped to the subtree's files. The trigger's `flex-1` pushes the pair right,
     so neither carries `ms-auto` (unlike ACTION_CLS on the file row). */
  const unindexedDirActions = useCallback(
    (files: WtFile[]) => (
      <>
        <IconButton
          label={messages.worktree.discardFolder}
          icon={ArrowTurnBackwardIcon}
          size="icon-xs"
          className={cn(DIR_ACTION_CLS, "text-destructive hover:text-destructive")}
          onClick={(ev) => {
            ev.stopPropagation()
            askDiscard(files)
          }}
        />
        {wtButton(
          messages.worktree.stageFolder,
          PlusSignIcon,
          STAGE,
          true,
          files.map((f) => f.path)
        )}
      </>
    ),
    [askDiscard, wtButton]
  )
  const unstageDir = useCallback(
    (files: WtFile[]) =>
      wtButton(
        messages.worktree.unstageFolder,
        MinusSignIcon,
        UNSTAGE,
        true,
        files.map((f) => f.path)
      ),
    [wtButton]
  )

  /* stash covers the whole worktree (staged included): the entry sits in both block menus
     so it stays reachable when only one side has files. The subject is read from the store
     at click time — subscribing to it here would re-render the file blocks per keystroke,
     exactly what extracting CommitForm avoids. */
  const stashItem = useMemo<WtMenuItem>(
    () => ({
      label: messages.worktree.stash,
      cmd: "git stash push -u",
      icon: ArchiveArrowDownIcon,
      onClick: () => void runStash("push", storeApi.getState().commitDraft.subject.trim() || undefined),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale rebuilds the captured labels
    [locale, runStash, storeApi]
  )
  const unindexedMenu = useMemo<WtMenuItem[]>(
    () => [
      {
        label: messages.worktree.stageAll,
        cmd: "git add -- …",
        icon: PlusSignIcon,
        onClick: () =>
          void onRun(
            STAGE,
            unindexed.map((f) => f.path)
          ),
      },
      stashItem,
      {
        label: messages.worktree.discardAll,
        cmd: "git restore/clean -- …",
        icon: ArrowTurnBackwardIcon,
        destructive: true,
        onClick: () => askDiscard(unindexed),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale rebuilds the captured labels
    [askDiscard, locale, onRun, stashItem, unindexed]
  )
  const indexedMenu = useMemo<WtMenuItem[]>(
    () => [
      {
        label: messages.worktree.unstageAll,
        cmd: "git restore --staged -- …",
        icon: MinusSignIcon,
        onClick: () =>
          void onRun(
            UNSTAGE,
            indexed.map((f) => f.path)
          ),
      },
      stashItem,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale rebuilds the captured labels
    [indexed, locale, onRun, stashItem]
  )

  return (
    <>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm leading-snug font-semibold tracking-tight text-balance">
          {messages.worktree.uncommittedChanges}
        </h2>
        <FileViewToggle view={view} onChange={setView} />
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
            onOpen={onOpenConflict}
            action={NO_ACTION}
            dirAction={NO_ACTION}
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
          action={unindexedActions}
          dirAction={unindexedDirActions}
          menu={unindexedMenu}
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
          menu={indexedMenu}
          empty={messages.worktree.noStagedFiles}
          className="border-t pt-3"
        />
      </div>

      <CommitForm staged={staged} hasConflicts={hasConflicts} />

      {discardReq && (
        <DiscardDialog
          request={discardReq}
          onConfirm={(req) => void onDiscard(req.paths, req.untracked)}
          onClose={() => setDiscardReq(null)}
        />
      )}
    </>
  )
}
