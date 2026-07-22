import { useEffect, useState } from "react"

import { Skeleton as SkeletonPrimitive } from "@/components/ui/primitives/skeleton"
import { cn } from "@/lib/utils"

/** One ghost block standing in for a piece of loading content. The call site gives it the
    shape of what it replaces (`h-2.5 w-24 rounded-full` text bar, `size-3.5 rounded` icon…),
    so the layout doesn't jump when the real thing lands. */
export function Skeleton({ className, ...props }: React.ComponentProps<typeof SkeletonPrimitive>) {
  return <SkeletonPrimitive className={cn("motion-reduce:animate-none", className)} {...props} />
}

/** Wrapper for the skeletons of one loading area: announces the wait to assistive tech
    (`label` replaces the visible text the old AsyncHint carried) and reveals only after
    150 ms — a fast local answer goes from bare background to content without a flash of
    ghosts (same rule as BootSkeleton). */
export function SkeletonGroup({
  label,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { label: string }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 150)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "transition-opacity duration-200 ease-out motion-reduce:transition-none",
        show ? "opacity-100" : "opacity-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
