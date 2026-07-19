/* Context menu of a graph commit row, and the two surfaces it opens in place (the create-tag
   dialog and the reset-mode modal). The create-branch / create-worktree entries open the inline
   banners instead (cf. features/repo/repo-view.tsx) — quick single-field actions live in the
   banner strip, mode choices and destructive confirmations earn a modal.

   The menu itself is mounted by GraphColumn: the graph rows are imperative DOM (render/rows.ts),
   so the ContextMenuTrigger wraps the whole board and GraphColumn resolves the clicked row
   before opening (cf. graph-column.tsx). */

import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowTurnBackwardIcon,
  FolderAddIcon,
  GitBranchIcon,
  PlusSignIcon,
  RefreshIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons"

import type { ResetMode } from "@/lib/git"
import { messages } from "@/lib/messages"
import { shortHash } from "@/features/graph/ids"
import { useRepoStore } from "@/features/repo/repo-store"
import { Button } from "@/components/ui/button"
import { MenuItemWithCmd } from "@/components/ui/git-cmd"
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** The right-clicked commit, resolved by GraphColumn before the menu opens. */
export type CommitMenuTarget = { hash: string }

export function CommitMenu({
  target,
  currentBranch,
  onCreateBranch,
  onCreateWorktree,
  onCreateTag,
  onReset,
}: {
  target: CommitMenuTarget
  /** current branch, `null` on detached HEAD — reset needs a branch to move */
  currentBranch: string | null
  onCreateBranch(hash: string): void
  onCreateWorktree(hash: string): void
  onCreateTag(hash: string): void
  onReset(hash: string): void
}) {
  const checkout = useRepoStore((s) => s.checkout)
  const revertCommit = useRepoStore((s) => s.revertCommit)
  const short = shortHash(target.hash)

  return (
    <ContextMenuContent className="max-w-80">
      <ContextMenuItem onClick={() => void checkout(target.hash)}>
        <HugeiconsIcon icon={GitBranchIcon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.commit.checkout(short)} cmd={`git checkout ${short}`} />
      </ContextMenuItem>

      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onCreateBranch(target.hash)}>
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.commit.createBranchFrom(short)} cmd={`git branch <name> ${short}`} />
      </ContextMenuItem>
      <ContextMenuItem onClick={() => onCreateWorktree(target.hash)}>
        <HugeiconsIcon icon={FolderAddIcon} strokeWidth={2} />
        <MenuItemWithCmd
          label={messages.commit.createWorktreeFrom(short)}
          cmd={`git worktree add -b <name> <dir> ${short}`}
        />
      </ContextMenuItem>

      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => onCreateTag(target.hash)}>
        <HugeiconsIcon icon={Tag01Icon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.commit.createTagHere} cmd={`git tag <name> ${short}`} />
      </ContextMenuItem>

      <ContextMenuSeparator />
      {/* reset moves the current branch: detached HEAD has nothing to move */}
      <ContextMenuItem disabled={!currentBranch} onClick={() => onReset(target.hash)}>
        <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
        <MenuItemWithCmd
          label={messages.commit.resetBranchTo(currentBranch ?? "HEAD", short)}
          cmd={`git reset --<mode> ${short}`}
        />
      </ContextMenuItem>
      <ContextMenuItem onClick={() => void revertCommit(target.hash)}>
        <HugeiconsIcon icon={ArrowTurnBackwardIcon} strokeWidth={2} />
        <MenuItemWithCmd label={messages.commit.revert(short)} cmd={`git revert ${short}`} />
      </ContextMenuItem>
    </ContextMenuContent>
  )
}

/* --- Create tag --- */

export function CreateTagDialog({ at, onClose }: { at: string; onClose(): void }) {
  const createTag = useRepoStore((s) => s.createTag)
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])
  const short = shortHash(at)

  /* a failure (existing tag, bad name) stays inline and keeps the dialog open for a fix */
  async function submit() {
    const tag = name.trim()
    if (!tag || busy) return
    setBusy(true)
    setError(null)
    const err = await createTag(tag, at)
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.commit.tagTitle}</DialogTitle>
          <DialogDescription>{messages.commit.tagBody(short)}</DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              void submit()
            }
          }}
          disabled={busy}
          placeholder={messages.commit.tagPlaceholder}
          aria-label={messages.commit.tagTitle}
          className="h-7 w-full rounded-sm border border-border bg-background px-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
        />
        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.commit.cancel}
          </Button>
          <Button disabled={!name.trim() || busy} onClick={() => void submit()}>
            {busy ? messages.commit.creating : messages.commit.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* --- Reset --- */

const RESET_CHOICES: { mode: ResetMode; label: () => string; hint: () => string }[] = [
  { mode: "soft", label: () => messages.commit.resetSoft, hint: () => messages.commit.resetSoftHint },
  { mode: "mixed", label: () => messages.commit.resetMixed, hint: () => messages.commit.resetMixedHint },
  { mode: "hard", label: () => messages.commit.resetHard, hint: () => messages.commit.resetHardHint },
]

/** The mode-picking modal of "reset branch to commit": choosing a mode runs the reset —
    the choice itself is the confirmation. Only `hard` is destructive (discards the tree). */
export function ResetDialog({ branch, to, onClose }: { branch: string; to: string; onClose(): void }) {
  const resetTo = useRepoStore((s) => s.resetTo)
  const short = shortHash(to)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.commit.resetTitle}</DialogTitle>
          <DialogDescription>{messages.commit.resetBody(branch, short)}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {RESET_CHOICES.map(({ mode, label, hint }) => (
            <Button
              key={mode}
              variant={mode === "hard" ? "destructive" : "outline"}
              className="justify-start gap-2"
              onClick={() => {
                void resetTo(mode, to)
                onClose()
              }}
            >
              {label()}
              <span
                className={
                  mode === "hard" ? "text-xs font-normal opacity-80" : "text-xs font-normal text-muted-foreground"
                }
              >
                {hint()}
              </span>
            </Button>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.commit.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
