/* Confirmations for the remote-side deletions of the refs sidebar: a remote-tracking branch
   (`git push <remote> --delete <branch>`) and a tag (`git tag -d`, with the option to take the
   remote tag down too). Same pattern as DeleteBranchDialog: the destructive click earns a modal,
   and the confirmed intent runs without further safeguards. */

import { useId, useState } from "react"

import type { GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function DeleteRemoteBranchDialog({
  branch,
  onConfirm,
  onClose,
}: {
  /** the remote-tracking ref, name "origin/topic" */
  branch: GitRef
  onConfirm(): void
  onClose(): void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.refs.deleteRemoteBranchTitle}</DialogTitle>
          <DialogDescription>{messages.refs.deleteRemoteBranchBody(branch.name)}</DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.refs.deleteBranchCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {messages.refs.deleteBranchConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteTagDialog({
  tag,
  remote,
  onConfirm,
  onClose,
}: {
  tag: GitRef
  /** preferred remote for the optional remote-side delete; `null` hides the option */
  remote: string | null
  onConfirm(deleteRemote: boolean): void
  onClose(): void
}) {
  const [deleteRemote, setDeleteRemote] = useState(false)
  const remoteId = useId()

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.refs.deleteTagTitle}</DialogTitle>
          <DialogDescription>{messages.refs.deleteTagBody(tag.name)}</DialogDescription>
        </DialogHeader>

        {remote && (
          <div className="flex items-start gap-2">
            <Checkbox
              id={remoteId}
              checked={deleteRemote}
              onCheckedChange={(v) => setDeleteRemote(v)}
              className="mt-0.5"
            />
            <label htmlFor={remoteId} className="flex cursor-pointer flex-col text-xs select-none">
              {messages.refs.deleteTagRemote(remote)}
            </label>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.refs.deleteBranchCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(deleteRemote && !!remote)
              onClose()
            }}
          >
            {messages.refs.deleteBranchConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
