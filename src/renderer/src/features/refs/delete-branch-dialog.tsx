/* Confirmation before deleting a branch. The destructive click earns a modal, and since the user
   has confirmed, the delete is forced (`-D`) — no dead end on an unmerged branch — with the option
   to take the remote branch down with it. The remote checkbox only appears when the branch tracks
   one (`upstream`); it's disabled once that remote counterpart is gone (`gone`), there being nothing
   left to delete. */

import { useState } from "react"

import type { GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
import { CheckRow } from "@/components/ui/check-row"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

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

  return (
    <ConfirmDialog
      title={messages.refs.deleteBranchTitle}
      description={messages.refs.deleteBranchBody(branch.name)}
      cancelLabel={messages.refs.deleteBranchCancel}
      confirmLabel={messages.refs.deleteBranchConfirm}
      onConfirm={() => onConfirm(deleteRemote && canDeleteRemote)}
      onClose={onClose}
    >
      {hasRemote && (
        <CheckRow
          checked={deleteRemote}
          onChange={setDeleteRemote}
          disabled={!canDeleteRemote}
          label={messages.refs.deleteBranchRemote(branch.upstream)}
          hint={canDeleteRemote ? undefined : messages.refs.deleteBranchRemoteGone}
        />
      )}
    </ConfirmDialog>
  )
}
