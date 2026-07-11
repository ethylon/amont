import { cn } from "@/lib/utils"

/* UI experiment: the git command a control triggers, shown as muted mono subtext. */
export function GitCmd({ cmd, className }: { cmd: string; className?: string }) {
  return (
    <span className={cn("block max-w-full truncate font-mono text-[0.625rem] leading-tight font-normal text-muted-foreground", className)}>
      {cmd}
    </span>
  )
}

/** Two-line context menu item: the label, then the git command it triggers as
    subtext (AUDIT.md §7, phase 5 — `item(label, cmd)` used to be redefined identically in
    refs-menu.tsx and stash-section.tsx). */
export function MenuItemWithCmd({ label, cmd }: { label: React.ReactNode; cmd: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start">
      <span>{label}</span>
      <GitCmd cmd={cmd} />
    </span>
  )
}
