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

import { useEffect, useRef } from "react"

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

/** kept sorted by descending priority at registration time (see `register`) — keydown is the
    hot path, it must not re-sort per event */
const entries: Entry[] = []

/** Inserts after the existing entries of equal priority: the same order the old stable
    per-dispatch sort produced (registration order within a priority level). */
function register(entry: Entry): () => void {
  let i = entries.length
  while (i > 0 && entries[i - 1].priority < entry.priority) i--
  entries.splice(i, 0, entry)
  return () => {
    const j = entries.indexOf(entry)
    if (j >= 0) entries.splice(j, 1)
  }
}

function dispatch(ev: KeyboardEvent): void {
  /* iterate a snapshot: a handler may unregister entries mid-dispatch (closing a popover) */
  for (const { handler } of [...entries]) {
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
    High priority = tested first; `handler` returns `true` to stop the descent.
    The handler goes through a ref: callers pass inline closures (a new identity every
    render), and re-running the splice/insert dance per render is churn for nothing — the
    subscription only follows `active`/`priority`, the ref always calls the latest closure. */
export function useShortcut(active: boolean, priority: number, handler: ShortcutHandler): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })
  useEffect(() => {
    if (!active) return
    return register({ priority, handler: (ev) => handlerRef.current(ev) })
  }, [active, priority])
}
