import { cn } from "@/lib/utils"

/* Essai UI : la commande git qu'un contrôle déclenche, en sous-texte muted mono. */
export function GitCmd({ cmd, className }: { cmd: string; className?: string }) {
  return (
    <span className={cn("block max-w-full truncate font-mono text-[0.625rem] leading-tight font-normal text-muted-foreground", className)}>
      {cmd}
    </span>
  )
}

/** Item de menu contextuel à deux lignes : le libellé, puis la commande git qu'il déclenche en
    sous-texte (AUDIT.md §7, phase 5 — `item(label, cmd)` était redéfini à l'identique dans
    refs-menu.tsx et stash-section.tsx). */
export function MenuItemWithCmd({ label, cmd }: { label: React.ReactNode; cmd: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span>{label}</span>
      <GitCmd cmd={cmd} />
    </span>
  )
}
