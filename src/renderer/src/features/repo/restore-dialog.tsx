import { messages } from "@/lib/messages"
import { shortHash } from "@/features/graph/ids"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/* Confirmation before a restore (the file rows' "Restore from this commit…" entry): it
   overwrites the working copy — same policy as the staging panel's discard. The index stays
   put (repo:restore is worktree-only), which the body says explicitly. */
export function RestoreDialog({
  req,
  onConfirm,
  onClose,
}: {
  req: { hash: string; path: string }
  onConfirm(): void
  onClose(): void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{messages.detail.restoreTitle}</DialogTitle>
          <DialogDescription>{messages.detail.restoreBody(req.path, shortHash(req.hash))}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {messages.detail.cancel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {messages.detail.restoreConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
