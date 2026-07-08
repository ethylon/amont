import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowDown02Icon, ArrowUp02Icon, Folder01Icon, GitBranchIcon,
  GitCommitIcon, PanelLeftIcon, Refresh01Icon,
} from "@hugeicons/core-free-icons"

import type { OpName } from "@/lib/git"
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandShortcut,
} from "@/components/ui/primitives/command"

type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  hasRepo: boolean
  onOpenRepo(): void
  onRunOp(op: OpName): void
  onToggleMainline(): void
  onToggleSidebar(): void
}

function Entry({ icon, children, shortcut, onSelect }: {
  icon: IconSvgElement
  children: React.ReactNode
  shortcut?: string
  onSelect(): void
}) {
  return (
    <CommandItem onSelect={onSelect}>
      <HugeiconsIcon icon={icon} strokeWidth={2} />
      {children}
      {shortcut && <CommandShortcut>{shortcut}</CommandShortcut>}
    </CommandItem>
  )
}

export function CommandPalette({
  open, onOpenChange, hasRepo, onOpenRepo, onRunOp, onToggleMainline, onToggleSidebar,
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

          <CommandGroup heading="Repo">
            <Entry icon={Folder01Icon} shortcut="Ctrl O" onSelect={run(onOpenRepo)}>
              Ouvrir un repo…
            </Entry>
            {hasRepo && (
              <>
                <Entry icon={Refresh01Icon} onSelect={run(() => onRunOp("fetch"))}>Fetch</Entry>
                <Entry icon={ArrowDown02Icon} onSelect={run(() => onRunOp("pull"))}>Pull (fast-forward)</Entry>
                <Entry icon={ArrowUp02Icon} onSelect={run(() => onRunOp("push"))}>Push</Entry>
              </>
            )}
          </CommandGroup>

          {hasRepo && (
            <CommandGroup heading="Vue">
              <Entry icon={GitBranchIcon} onSelect={run(onToggleMainline)}>Basculer Mainline</Entry>
              <Entry icon={PanelLeftIcon} shortcut="Ctrl B" onSelect={run(onToggleSidebar)}>
                Afficher / masquer les refs
              </Entry>
            </CommandGroup>
          )}

          {/* ponytail: navigation par hash — pas de champ de saisie dédié tant que le filtre du toolbar est inerte */}
          {hasRepo && (
            <CommandGroup heading="Navigation">
              <Entry icon={GitCommitIcon} shortcut="Ctrl G" onSelect={run(() => {})}>Aller au commit…</Entry>
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
