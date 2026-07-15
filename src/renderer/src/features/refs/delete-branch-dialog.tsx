/* Confirmation before deleting a branch. Git's `-d` still guards unmerged commits, but the
   destructive click earns a modal — and the option to take the remote branch down with it.
   The remote checkbox only appears when the branch tracks one (`upstream`); it's disabled once
   that remote counterpart is gone (`gone`), there being nothing left to delete. */

import { useId, useState } from "react"

import type { GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { GitCmd } from "@/components/ui/git-cmd"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function DeleteBranchDialog({
  branch,
  onConfirm,
  onClose,
}: {
  branch: GitRef
  onConfirm(deleteRemote: boolean): void
  onClose(): void
}) {
  const hasRemote = !!branch.upstream
  const canDeleteRemote = hasRemote && !branch.gone
  const [deleteRemote, setDeleteRemote] = useState(false)
  const remoteId = useId()

  const [remote, ...rest] = branch.upstream.split("/")
  const cmd =
    deleteRemote && canDeleteRemote
      ? `git branch -d ${branch.name} && git push ${remote} --delete ${rest.join("/")}`
      : `git branch -d ${branch.name}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.refs.deleteBranchTitle}</DialogTitle>
          <DialogDescription>{messages.refs.deleteBranchBody(branch.name)}</DialogDescription>
        </DialogHeader>

        {hasRemote && (
          <div className="flex items-start gap-2">
            <Checkbox
              id={remoteId}
              checked={deleteRemote}
              disabled={!canDeleteRemote}
              onCheckedChange={(v) => setDeleteRemote(v)}
              className="mt-0.5"
            />
            <label
              htmlFor={remoteId}
              className={cn(
                "flex cursor-pointer flex-col text-xs select-none",
                !canDeleteRemote && "cursor-not-allowed opacity-50"
              )}
            >
              {messages.refs.deleteBranchRemote(branch.upstream)}
              {!canDeleteRemote && (
                <span className="text-muted-foreground">{messages.refs.deleteBranchRemoteGone}</span>
              )}
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.refs.deleteBranchCancel}
          </Button>
          <Button
            variant="destructive"
            className="h-auto flex-col gap-0 py-1"
            onClick={() => {
              onConfirm(deleteRemote && canDeleteRemote)
              onClose()
            }}
          >
            {messages.refs.deleteBranchConfirm}
            <GitCmd cmd={cmd} className="text-destructive/70" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
