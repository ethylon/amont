/* Confirmations for the remote-side deletions of the refs sidebar: a remote-tracking branch
   (`git push <remote> --delete <branch>`) and a tag (`git tag -d`, with the option to take the
   remote tag down too). Same pattern as DeleteBranchDialog: the destructive click earns a modal,
   and the confirmed intent runs without further safeguards. */

import { useState } from "react"

import type { GitRef } from "@/lib/git"
import { messages } from "@/lib/messages"
import { CheckRow } from "@/components/ui/check-row"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

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
    <ConfirmDialog
      title={messages.refs.deleteRemoteBranchTitle}
      description={messages.refs.deleteRemoteBranchBody(branch.name)}
      cancelLabel={messages.refs.deleteBranchCancel}
      confirmLabel={messages.refs.deleteBranchConfirm}
      onConfirm={onConfirm}
      onClose={onClose}
    />
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

  return (
    <ConfirmDialog
      title={messages.refs.deleteTagTitle}
      description={messages.refs.deleteTagBody(tag.name)}
      cancelLabel={messages.refs.deleteBranchCancel}
      confirmLabel={messages.refs.deleteBranchConfirm}
      onConfirm={() => onConfirm(deleteRemote && !!remote)}
      onClose={onClose}
    >
      {remote && (
        <CheckRow checked={deleteRemote} onChange={setDeleteRemote} label={messages.refs.deleteTagRemote(remote)} />
      )}
    </ConfirmDialog>
  )
}
