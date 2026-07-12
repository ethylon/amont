/* Declarative application-menu model. A menu is data — a `MenuDescriptor` built fresh from a
   `MenuContext` on every render — not JSX. The renderer (app-menu.tsx) walks these nodes; the
   registry (index.ts) lists them in bar order. Adding a menu is: write a descriptor under
   ./menus, register it. No component to touch, no App wiring beyond the context. */

import type { IconSvgElement } from "@hugeicons/react"

/** An item that performs an action when chosen. */
export type MenuAction = {
  kind: "action"
  /** Stable key — React lists, and `data-menu-item` for tests. */
  id: string
  label: string
  /** Display-only shortcut hint (e.g. "F5"). The actual binding lives in app/shortcuts.ts. */
  shortcut?: string
  icon?: IconSvgElement
  disabled?: boolean
  variant?: "default" | "destructive"
  run: () => void
}

/** A toggle bound to a boolean. */
export type MenuCheckbox = {
  kind: "checkbox"
  id: string
  label: string
  icon?: IconSvgElement
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A divider between groups of items. */
export type MenuSeparator = { kind: "separator" }

/** A nested submenu. */
export type MenuSubmenu = {
  kind: "submenu"
  id: string
  label: string
  icon?: IconSvgElement
  items: MenuNode[]
}

export type MenuNode = MenuAction | MenuCheckbox | MenuSeparator | MenuSubmenu

/** A top-level menu in the bar (File, View, Help…). */
export type MenuDescriptor = {
  /** Stable key. */
  id: string
  label: string
  /** Rebuilt on each render, so labels/disabled/checked always reflect live app state. */
  build: (ctx: MenuContext) => MenuNode[]
}

/** The single seam between the declarative descriptors and App's stateful callbacks:
    a menu item calls these, it never reaches into App directly. Extend this — and the
    value assembled in App — when a new menu needs a new capability. */
export type MenuContext = {
  /** Open the repository-creation page (the "+" tab). */
  newRepo(): void
  /** Open a repository through the OS folder picker. */
  openRepo(): void
  /** Close the active repository tab; a no-op when home/create is in front. */
  closeActiveTab(): void
  /** True when a repository tab is in the foreground (drives "Close tab" enablement). */
  hasActiveRepo: boolean
  /** Bring the home screen to the front. */
  goHome(): void
  /** Whether the dark theme is active. */
  isDark: boolean
  /** Flip the theme. */
  toggleTheme(): void
  /** Full window reload (same lever as F5). */
  reload(): void
  /** The running app version, e.g. "0.13.0". */
  version: string
  /** Open a URL in the system browser (never in-app; cf. main/window.ts). */
  openExternal(url: string): void
}
