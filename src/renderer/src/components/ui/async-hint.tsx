import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/** Spinner + muted text trio, for waiting on a first response (AUDIT.md §7, phase 5 —
    copied identically in detail-panel/home-screen/refs-sidebar/diff-view). `className`
    carries the padding specific to each location, `cn` merges it without conflict. */
export function AsyncHint({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Spinner className="size-3" /> {children}
    </p>
  )
}
