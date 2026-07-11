import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon } from "@hugeicons/core-free-icons"

import { cn } from "@/lib/utils"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { LABEL_CLS } from "@/components/ui/typography"

/** Collapsible group header for the refs sidebar: title + count, chevron that rotates on
    open. Copied identically between the ref groups (Branches/Remotes/Tags) and the
    Stash group before this refactor (AUDIT.md §7, phase 5). */
export function RefGroup({ title, count, open, onOpenChange, children }: {
  title: string
  count: number
  open: boolean
  onOpenChange(open: boolean): void
  children: React.ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleTrigger
        className={cn(
          "group/trigger flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 select-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none",
          LABEL_CLS
        )}
      >
        <HugeiconsIcon
          icon={ArrowRight01Icon}
          strokeWidth={2}
          className="size-3 transition-transform group-data-[panel-open]/trigger:rotate-90 motion-reduce:transition-none"
        />
        {title}
        <span className="ms-auto tabular-nums">{count}</span>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
