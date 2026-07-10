import { cn } from "@/lib/utils"

/* Essai UI : la commande git qu'un contrôle déclenche, en sous-texte muted mono. */
export function GitCmd({ cmd, className }: { cmd: string; className?: string }) {
  return (
    <span className={cn("block max-w-full truncate font-mono text-[0.625rem] leading-tight font-normal text-muted-foreground", className)}>
      {cmd}
    </span>
  )
}
