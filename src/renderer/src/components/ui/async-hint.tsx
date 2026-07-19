import { cn } from "@/lib/utils"
import { Spinner } from "@/components/ui/spinner"

/** Spinner + muted text trio, for an operation in flight (clone/create, cf. create-dialog).
    First-load data waits show a shaped Skeleton instead (components/ui/skeleton). `className`
    carries the padding specific to each location, `cn` merges it without conflict. */
export function AsyncHint({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <p className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
      <Spinner className="size-3" /> {children}
    </p>
  )
}
