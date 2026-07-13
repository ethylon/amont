/* Declarative application-menu model. A menu is data — a `MenuDescriptor` built fresh from a
   `MenuContext` on every render — not JSX. The renderer (app-menu.tsx) walks these nodes; the
   registry (index.ts) lists them in bar order. Adding a menu is: write a descriptor under
   ./menus, register it. No component to touch, no App wiring beyond the context. */

import type { IconSvgElement } from "@hugeicons/react"

import type { FlowInfo, FlowPrefixes } from "@/lib/git"
import type { BranchFlow } from "@/lib/gitflow"
import type { Locale } from "@/lib/i18n"
import type { ThemeMode } from "@/lib/theme"

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

/** A top-level menu in the bar (File, View, Repository, Help…). */
export type MenuDescriptor = {
  /** Stable key. */
  id: string
  label: string
  /** When it returns true, the whole menu's trigger is greyed out (e.g. Repository off a repo
      tab). Recomputed on each render like everything else. */
  disabled?: (ctx: MenuContext) => boolean
  /** Rebuilt on each render, so labels/disabled/checked always reflect live app state. */
  build: (ctx: MenuContext) => MenuNode[]
}

/** The active repository, as the menus see it: its declarative flow state (read) and the
    handful of actions a menu item can trigger on it (write). Assembled in AppMenu from the same
    queries RepoView uses, and null whenever the foreground tab isn't a repo. */
export type MenuRepo = {
  id: number
  /** git-flow prefixes, or `null` when the repo never ran `git flow init`. */
  flowPrefixes: FlowPrefixes | null
  /** current HEAD branch — `null` on a detached or unborn HEAD. */
  branch: string | null
  /** work type of the current branch (feature/bugfix/release/hotfix), `null` on a trunk or other. */
  workFlow: BranchFlow | null
  /** read-only context of the current flow branch (finish targets, unpushed…), `null` off a flow branch. */
  flowInfo: FlowInfo | null

  /** Open the Git Flow initialization form (modal). */
  initFlow(): void
  /** Reveal the inline start banner for the given flow type. */
  startFlow(kind: BranchFlow): void
  /** `git flow <kind> finish` on the given full branch name. */
  finishFlow(name: string): void
  /** `git flow <kind> publish` of the given branch (suffix, prefix excluded). */
  publishFlow(kind: BranchFlow, name: string): void
  /** Open the maintenance hub (database statistics) modal. */
  openStats(): void
  /** `git fsck --full`, progress reported in the footer. */
  verifyDatabase(): void
  /** `git gc`, indeterminate spinner in the footer. */
  compactDatabase(): void
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
  /** The foreground repository's flow state and actions, or `null` off a repo tab (drives the
      whole Repository menu — see menus/repository.ts). */
  activeRepo: MenuRepo | null
  /** Bring the home screen to the front. */
  goHome(): void
  /** Active UI language (drives the Language menu checkmark). */
  locale: Locale
  /** Switch the UI language at runtime (persisted). */
  setLocale(locale: Locale): void
  /** Active theme choice (light/dark/system — drives the Theme menu checkmark). */
  themeMode: ThemeMode
  /** Set the theme choice (persisted; `system` follows the OS). */
  setTheme(mode: ThemeMode): void
  /** Full window reload (same lever as F5). */
  reload(): void
  /** The running app version, e.g. "0.13.0". */
  version: string
  /** Open a URL in the system browser (never in-app; cf. main/window.ts). */
  openExternal(url: string): void
  /** Manual update check (Help ▸ Check for updates); feedback via the update card. */
  checkForUpdates(): void
}
