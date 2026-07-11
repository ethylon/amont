/* Keyboard shortcut registry (AUDIT.md §5, item 9): a single choke point replaces the
   independent `document.addEventListener("keydown", …)` listeners that used to coexist (App
   F5, RepoView Ctrl+B/Escape, CommitSearch Ctrl+F/F3, GitConsole Escape) and only coordinated
   with each other through mount order — two independent listeners on `document` for the
   same key would both fire, with neither explicitly deciding it should.

   Each consumer stays scope-aware: its handler decides for itself whether it applies (active
   tab, popover open…) and returns `true` if it handled the event — which stops the descent
   to lower priorities. Escape has two competing claimants: the git console (floating overlay,
   high priority) and closing the diff (default priority). The search field and the sidebar
   filter keep their own local Escape handling, as close to the input as possible
   (stopPropagation before it even reaches this registry): that's already the narrowest scope
   there could be, routing through this module wouldn't add anything. */

import { useEffect } from "react"

export const PRIORITY = {
  /** floating popovers/dialogs above the content (git console) */
  OVERLAY: 100,
  /** ordinary tab shortcuts (Ctrl+B, Ctrl+F, F3, Escape closes the diff) */
  DEFAULT: 50,
  /** application-wide global shortcuts (F5) */
  GLOBAL: 10,
} as const

type ShortcutHandler = (ev: KeyboardEvent) => boolean | void

interface Entry {
  priority: number
  handler: ShortcutHandler
}

const entries: Entry[] = []

function dispatch(ev: KeyboardEvent): void {
  for (const { handler } of [...entries].sort((a, b) => b.priority - a.priority)) {
    if (handler(ev) === true) return
  }
}

let installed = false

/** Call once at startup (main.tsx): a single `document` listener, regardless of the
    number of tabs/components that register shortcuts afterward. */
export function installShortcuts(): void {
  if (installed) return
  installed = true
  document.addEventListener("keydown", dispatch)
}

/** Registers `handler` as long as `active` is true (tab in the foreground, popover open…).
    High priority = tested first; `handler` returns `true` to stop the descent. */
export function useShortcut(active: boolean, priority: number, handler: ShortcutHandler): void {
  useEffect(() => {
    if (!active) return
    const entry: Entry = { priority, handler }
    entries.push(entry)
    return () => {
      const i = entries.indexOf(entry)
      if (i >= 0) entries.splice(i, 1)
    }
  }, [active, priority, handler])
}
