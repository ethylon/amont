import { cn } from "@/lib/utils"

/** Muted text swept by shadcn's `shimmer`, for an operation in flight (clone/create, cf.
    create-dialog). First-load data waits show a shaped Skeleton instead (components/ui/skeleton).
    `className` carries the padding specific to each location, `cn` merges it without conflict. */
export function AsyncHint({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("shimmer text-xs text-muted-foreground", className)}>{children}</p>
}
