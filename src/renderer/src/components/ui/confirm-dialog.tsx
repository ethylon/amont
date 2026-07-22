import type { ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

/* Confirmation destructive factorisée (delete branch/tag/remote, discard) : même squelette
   titre/description/footer partout. AlertDialog plutôt que Dialog : un clic hors du modal ne
   vaut pas réponse — seule Échap ou un des deux boutons ferme. */
export function ConfirmDialog({
  title,
  description,
  cancelLabel,
  confirmLabel,
  onConfirm,
  onClose,
  children,
}: {
  title: ReactNode
  description: ReactNode
  cancelLabel: string
  confirmLabel: string
  onConfirm(): void
  onClose(): void
  /** contenu optionnel entre description et footer (cases à cocher…) */
  children?: ReactNode
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <Button variant="outline" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
