/* Tab navigation (AUDIT.md §5, item 6): a discriminated union replaces the `HOME = 0`
   sentinel that TabStrip shared with the repo id space (`Repo.id` starts at 1 on the main
   side, which never collides with 0 — but nothing says so in the types, it's an implicit
   convention between the two processes). Transitions stay pure and tested here; App.tsx
   consumes them from its own React state (`document.startViewTransition` + `flushSync` are
   a rendering concern, not a state one — a separate store wouldn't add anything here). */

import type { Repo } from "@/lib/git"

export type NavKey = { kind: "home" } | { kind: "repo"; id: number }

export const HOME: NavKey = { kind: "home" }

export const repoKey = (id: number): NavKey => ({ kind: "repo", id })

export const navKeyEquals = (a: NavKey, b: NavKey): boolean =>
  a.kind === "home" ? b.kind === "home" : b.kind === "repo" && b.id === a.id

/** The slide direction follows the position in the tab strip, home at position 0.
    A key not yet in it was just opened: it arrives head-on ("open")
    rather than from the side. */
export function transitionKind(tabs: Repo[], active: NavKey, target: NavKey): "open" | "next" | "prev" {
  const order: NavKey[] = [HOME, ...tabs.map((r) => repoKey(r.id))]
  const pos = (k: NavKey) => order.findIndex((x) => navKeyEquals(x, k))
  const known = pos(target) >= 0
  if (!known) return "open"
  return pos(target) > pos(active) ? "next" : "prev"
}

/** Active tab after closing `closedId`: if the closed tab wasn't active, nothing
    moves; otherwise we fall back to its neighbor (same index, clamped), or home if it was
    the last tab. */
export function afterClose(tabs: Repo[], active: NavKey, closedId: number): NavKey {
  const i = tabs.findIndex((r) => r.id === closedId)
  if (i < 0) return active
  if (active.kind !== "repo" || active.id !== closedId) return active
  const next = tabs.filter((r) => r.id !== closedId)
  const fallback = next[Math.min(i, next.length - 1)]
  return fallback ? repoKey(fallback.id) : HOME
}
