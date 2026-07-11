import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/primitives/spinner"

/** Trio spinner + texte muted, pour l'attente d'une première réponse (AUDIT.md §7, phase 5 —
    recopié à l'identique dans detail-panel/home-screen/refs-sidebar/diff-view). `className`
    porte le padding propre à chaque emplacement, `cn` le fusionne sans conflit. */
export function AsyncHint({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Spinner className="size-3" /> {children}
    </p>
  )
}
