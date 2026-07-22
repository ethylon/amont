import { HugeiconsIcon } from "@hugeicons/react"

import type { RepoCommand } from "@/features/repo/repo-commands"
import { useMenuRepo } from "@/app/menu/use-menu-repo"
import {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
} from "@/components/ui/menubar"
import { MENUS } from "@/app/menu"
import type { MenuContext, MenuNode } from "@/app/menu/types"

/** Renders one node — recursive for submenus. `key` comes from the caller (list index +
    the node's own id, which every non-separator node carries). */
function MenuItemNode({ node }: { node: MenuNode }) {
  switch (node.kind) {
    case "separator":
      return <MenubarSeparator />

    case "action":
      return (
        <MenubarItem data-menu-item={node.id} disabled={node.disabled} variant={node.variant} onClick={node.run}>
          {node.icon && <HugeiconsIcon icon={node.icon} strokeWidth={2} className={node.iconClass} />}
          {node.label}
          {node.shortcut && <MenubarShortcut>{node.shortcut}</MenubarShortcut>}
        </MenubarItem>
      )

    case "checkbox":
      return (
        <MenubarCheckboxItem data-menu-item={node.id} checked={node.checked} onCheckedChange={node.onCheckedChange}>
          {node.icon && <HugeiconsIcon icon={node.icon} strokeWidth={2} />}
          {node.label}
        </MenubarCheckboxItem>
      )

    case "submenu":
      return (
        <MenubarSub>
          <MenubarSubTrigger data-menu-item={node.id}>
            {node.icon && <HugeiconsIcon icon={node.icon} strokeWidth={2} className={node.iconClass} />}
            {node.label}
          </MenubarSubTrigger>
          <MenubarSubContent>
            {node.items.map((child, i) => (
              <MenuItemNode key={child.kind === "separator" ? `sep-${i}` : child.id} node={child} />
            ))}
          </MenubarSubContent>
        </MenubarSub>
      )
  }
}

/** App's share of the menu context: everything but `activeRepo`, which this component
    derives itself (see below). */
export type AppMenuContext = Omit<MenuContext, "activeRepo">

/** The application menu bar. Fully data-driven: it maps `MENUS` (see app/menu/index.ts),
    building each menu's items from the live `ctx` on every render.

    The foreground repo's flow/status subscriptions (useMenuRepo) live here, not in App
    (perf audit, finding 4d): they refetch on every git change, and hoisted to App they
    re-rendered the whole tree — every mounted tab included — for a menu-only concern.
    Here the query updates re-render just the menu bar. */
export function AppMenu({
  ctx,
  activeRepoId,
  sendRepoCommand,
}: {
  ctx: AppMenuContext
  activeRepoId: number | null
  sendRepoCommand: (repoId: number, command: RepoCommand) => void
}) {
  const activeRepo = useMenuRepo(activeRepoId, sendRepoCommand)
  const full: MenuContext = { ...ctx, activeRepo }
  return (
    <Menubar>
      {MENUS.map((menu) => (
        <MenubarMenu key={menu.id}>
          <MenubarTrigger
            data-menu={menu.id}
            disabled={menu.disabled?.(full)}
            className="data-disabled:pointer-events-none data-disabled:opacity-40"
          >
            {menu.label}
          </MenubarTrigger>
          <MenubarContent>
            {menu.build(full).map((node, i) => (
              <MenuItemNode key={node.kind === "separator" ? `sep-${i}` : node.id} node={node} />
            ))}
          </MenubarContent>
        </MenubarMenu>
      ))}
    </Menubar>
  )
}
