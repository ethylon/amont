import { cn } from "@/lib/utils"
import { useShowGitCommands } from "@/lib/customization"

/* UI experiment: the git command a control triggers, shown as muted mono subtext.
   The subtext tracks the action's colour: muted by default, but a destructive menu item
   tints it (destructive/70) to match its red caption — the same muted-red hierarchy the
   destructive buttons/modals get via `className="text-destructive/70"`.

   Hidden entirely when the user turns off "show git commands" (Settings ▸ Customization): the
   host control keeps its label, only this subtext drops.

   `running`: the command is executing right now — the `shimmer` utility (app.css) sweeps the text
   as the textual counterpart of the host's spinner. */
export function GitCmd({ cmd, running, className }: { cmd: string; running?: boolean; className?: string }) {
  if (!useShowGitCommands()) return null
  return (
    <span
      className={cn(
        "block max-w-full truncate font-mono text-[0.625rem] leading-tight font-normal text-muted-foreground [[data-slot=context-menu-item][data-variant=destructive]_&]:text-destructive/70! [[data-slot=dropdown-menu-item][data-variant=destructive]_&]:text-destructive/70!",
        running && "shimmer",
        className
      )}
    >
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
