/* The app-global tab state: the open-repo list, the active tab, mount tracking, boot
   restoration and persistence. App-global by design — per-repo state lives in the repo
   store; this is the layer above it, one instance for the whole window. */

import { useCallback, useEffect, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { host, type BootState, type Repo } from "@/lib/git"
import { afterClose, HOME, navKeyEquals, repoKey, transitionKind, type NavKey } from "@/app/navigation"
import { HOME as TAB_STRIP_HOME } from "@/app/tab-strip"

const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** The tab content slides; the rest of the chrome switches instantly (see `.amont-tabview`). */
function transition(type: "next" | "prev" | "open", update: () => void) {
  if (reduced.matches) return update()
  document.startViewTransition({ types: [type], update: () => flushSync(update) })
}

/** TabStrip keeps its numeric API (0 = home, see tab-strip.tsx) — the component boundary
    hasn't moved, only App's internal state adopts the discriminated union `NavKey` (AUDIT.md §5,
    item 6: the `HOME = 0` sentinel shared the repo id space by pure convention). */
export const toTabKey = (k: NavKey): number => (k.kind === "home" ? TAB_STRIP_HOME : k.id)
export const fromTabKey = (n: number): NavKey => (n === TAB_STRIP_HOME ? HOME : repoKey(n))

export function useTabs(boot: Promise<BootState>) {
  /* home isn't in `tabs`: it's pinned, always there, never closed */
  const [tabs, setTabs] = useState<Repo[]>([])
  const [active, setActive] = useState<NavKey>(HOME)
  /* a visited tab stays mounted: returning to it doesn't reload its graph, doesn't lose its scroll */
  const [mounted, setMounted] = useState<number[]>([])
  const [booted, setBooted] = useState(false)
  /* bump = unmounts and remounts the whole tab (store included): the "reload tab" lever
     of the ErrorBoundary wrapping it (AUDIT.md §5, item 8). */
  const [resetNonce, setResetNonce] = useState<Record<number, number>>({})
  const bumpReset = useCallback((id: number) => setResetNonce((n) => ({ ...n, [id]: (n[id] ?? 0) + 1 })), [])

  /* The slide direction follows the tab strip, home at position 0. A repo not yet in it
     was just opened: it arrives head-on rather than from the side.
     (`::view-transition-new` is a live render, not a snapshot: a graph still being laid out
     finishes rendering during the animation.) Pure, tested transition (see
     navigation.test.ts): `select` now only executes it. */
  const select = useCallback(
    (key: NavKey) => {
      if (navKeyEquals(key, active)) return
      transition(transitionKind(tabs, active, key), () => {
        setActive(key)
        if (key.kind === "repo") setMounted((m) => (m.includes(key.id) ? m : [...m, key.id]))
      })
    },
    [active, tabs]
  )

  /* restoration: no animation, there's no previous state to leave */
  useEffect(() => {
    void boot.then((s) => {
      if (s.tabs.length) {
        const key = s.active ?? s.tabs[0].id
        setTabs(s.tabs)
        setActive(repoKey(key))
        setMounted([key])
      }
      setBooted(true)
    })
  }, [boot])

  /* not before boot: we'd overwrite the persisted tabs with the empty initial state */
  useEffect(() => {
    if (!booted) return
    void host.setTabs(
      tabs.map((r) => r.path),
      tabs.find((r) => active.kind === "repo" && r.id === active.id)?.path ?? null
    )
  }, [booted, tabs, active])

  /* already open: we navigate to it instead of duplicating it (main returns the same id) */
  const openTab = useCallback(
    (repo: Repo) => {
      setTabs((prev) => (prev.some((r) => r.id === repo.id) ? prev : [...prev, repo]))
      select(repoKey(repo.id))
    },
    [select]
  )
  /* `openTab` is rebuilt on every tab/active change (it closes over `select`); the memoized
     RepoViews get this ref-routed wrapper instead, so their `onOpenRepo` prop never churns
     (perf audit, finding 4d). */
  const openTabRef = useRef(openTab)
  openTabRef.current = openTab
  const openTabStable = useCallback((repo: Repo) => openTabRef.current(repo), [])

  const closeTab = useCallback(
    (key: number) => {
      const i = tabs.findIndex((r) => r.id === key)
      if (i < 0) return
      void host.close(key)
      const wasActive = active.kind === "repo" && active.id === key
      const next = afterClose(tabs, active, key)
      setTabs((prev) => prev.filter((r) => r.id !== key))
      setMounted((m) => m.filter((k) => k !== key))
      if (wasActive) select(next)
    },
    [active, select, tabs]
  )

  return { tabs, active, mounted, resetNonce, bumpReset, select, openTab, openTabStable, closeTab }
}
