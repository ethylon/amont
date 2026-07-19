/* Confirmation before a discard (file or bulk): the only irreversible action of the staging
   panel — stage/unstage/stash all have a way back, a discarded change doesn't. One file names
   its path; a bulk shows the count, with the untracked deletions called out separately (a
   deleted untracked file isn't "restored", it's gone). */

import { messages } from "@/lib/messages"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type DiscardRequest = {
  /** tracked paths, restored from the index (`git restore`) */
  paths: string[]
  /** untracked paths, deleted (`git clean -f`) */
  untracked: string[]
}

export function DiscardDialog({
  request,
  onConfirm,
  onClose,
}: {
  request: DiscardRequest
  onConfirm(req: DiscardRequest): void
  onClose(): void
}) {
  const total = request.paths.length + request.untracked.length
  const single = total === 1 ? (request.paths[0] ?? request.untracked[0]) : null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.worktree.discardTitle}</DialogTitle>
          <DialogDescription>
            {single ? messages.worktree.discardOne(single) : messages.worktree.discardMany(total)}
            {!single && request.untracked.length > 0 && (
              <> {messages.worktree.discardUntracked(request.untracked.length)}</>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.worktree.discardCancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm(request)
              onClose()
            }}
          >
            {messages.worktree.discardConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
