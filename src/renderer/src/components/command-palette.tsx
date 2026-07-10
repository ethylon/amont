import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowDown02Icon, ArrowUp02Icon, Folder01Icon,
  GitCommitIcon, PanelLeftIcon, Refresh01Icon,
} from "@hugeicons/core-free-icons"

import type { OpName } from "@/lib/git"
import { GitCmd } from "@/components/ui/git-cmd"
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandShortcut,
} from "@/components/ui/command"

/* Rendue par la vue du repo actif : la palette n'existe donc jamais sans repo. */
type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  /** l'ouverture passe par l'écran d'accueil d'un nouvel onglet, pas par un dialogue direct */
  onNewTab(): void
  onRunOp(op: OpName): void
  onToggleSidebar(): void
}

function Entry({ icon, children, cmd, shortcut, disabled, onSelect }: {
  icon: IconSvgElement
  children: React.ReactNode
  cmd?: string
  shortcut?: string
  disabled?: boolean
  onSelect(): void
}) {
  return (
    <CommandItem disabled={disabled} onSelect={onSelect}>
      <HugeiconsIcon icon={icon} strokeWidth={2} />
      {cmd ? (
        <span className="flex min-w-0 flex-col items-start">
          <span>{children}</span>
          <GitCmd cmd={cmd} />
        </span>
      ) : (
        children
      )}
      {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
    </CommandItem>
  )
}

export function CommandPalette({
  open, onOpenChange, onNewTab, onRunOp, onToggleSidebar,
}: Props) {
  const run = (fn: () => void) => () => {
    onOpenChange(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Palette de commandes" description="Commande, branche, hash…">
      <Command>
        <CommandInput placeholder="Commande, branche, hash…" />
        <CommandList>
          <CommandEmpty>Aucun résultat.</CommandEmpty>

          <CommandGroup heading="Dépôt">
            <Entry icon={Folder01Icon} onSelect={run(onNewTab)}>
              Ouvrir un dépôt…
            </Entry>
            <Entry icon={Refresh01Icon} cmd="git fetch --all --prune" onSelect={run(() => onRunOp("fetch"))}>Fetch</Entry>
            <Entry icon={ArrowDown02Icon} cmd="git pull --ff-only" onSelect={run(() => onRunOp("pull"))}>Pull (fast-forward)</Entry>
            <Entry icon={ArrowUp02Icon} cmd="git push" onSelect={run(() => onRunOp("push"))}>Push</Entry>
          </CommandGroup>

          <CommandGroup heading="Vue">
            <Entry icon={PanelLeftIcon} shortcut="Ctrl B" onSelect={run(onToggleSidebar)}>
              Afficher / masquer les branches
            </Entry>
          </CommandGroup>

          {/* ponytail: navigation par hash à venir — désactivée tant qu'inerte */}
          <CommandGroup heading="Navigation">
            <Entry icon={GitCommitIcon} shortcut="Ctrl G" disabled onSelect={() => {}}>Aller au commit…</Entry>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
