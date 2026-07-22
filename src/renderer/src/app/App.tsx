import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"

import { host, type BootState, type Repo } from "@/lib/git"
import { afterClose, HOME, navKeyEquals, repoKey, transitionKind, type NavKey } from "@/app/navigation"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import { messages } from "@/lib/messages"
import { setTheme, useThemeMode } from "@/lib/theme"
import { setLocale, useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "@/app/error-boundary"
import { AppMenu, type AppMenuContext } from "@/app/menu"
import type { RepoCommand, RepoCommandEnvelope } from "@/features/repo/repo-commands"
import { HomeScreen } from "@/features/home/home-screen"
import { UpdateCard } from "@/features/updater/update-card"
import { RepoView } from "@/features/repo/repo-view"
import { HOME as TAB_STRIP_HOME, panelId, tabId, TabStrip } from "@/app/tab-strip"

/* Code-split behind `createOpen` (perf audit, finding 6): the creation modal is pure
   user-action UI, so its form + inputs stay out of the entry chunk. Mounted on first open
   (see `createMounted`) and kept mounted after, so closing still plays the dialog's exit
   animation; a null fallback for the one frame the chunk takes is invisible under the
   opening overlay. */
const CreateDialog = lazy(() => import("@/features/create/create-dialog").then((m) => ({ default: m.CreateDialog })))

/* App-wide settings (customization, colors, diff): opened from File ▸ Settings, so it lives here
   rather than per-tab. Code-split behind its open state — pure user-action UI. */
const SettingsDialog = lazy(() =>
  import("@/features/settings/settings-dialog").then((m) => ({ default: m.SettingsDialog }))
)

/* About (Help ▸ About Amont): same lazy treatment as the settings — pure user-action UI. */
const AboutDialog = lazy(() => import("@/features/about/about-dialog").then((m) => ({ default: m.AboutDialog })))

const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** The tab content slides; the rest of the chrome switches instantly (see `.amont-tabview`). */
function transition(type: "next" | "prev" | "open", update: () => void) {
  if (reduced.matches) return update()
  document.startViewTransition({ types: [type], update: () => flushSync(update) })
}

/** TabStrip keeps its numeric API (0 = home, see tab-strip.tsx) — the component boundary
    hasn't moved, only App's internal state adopts the discriminated union `NavKey` (AUDIT.md §5,
    item 6: the `HOME = 0` sentinel shared the repo id space by pure convention). */
const toTabKey = (k: NavKey): number => (k.kind === "home" ? TAB_STRIP_HOME : k.id)
const fromTabKey = (n: number): NavKey => (n === TAB_STRIP_HOME ? HOME : repoKey(n))

type Props = {
  /** promise set once by main.tsx (see boot() in lib/git.ts) */
  boot: Promise<BootState>
}

export default function App({ boot }: Props) {
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

  /* The title belongs to the active tab — a single effect here, rather than one per RepoView
     which never reset it when returning to home. */
  useEffect(() => {
    const name = active.kind === "repo" ? tabs.find((r) => r.id === active.id)?.name : null
    document.title = name ? `Amont — ${name}` : "Amont"
  }, [active, tabs])

  /* F5: full window reload — the fallback when the UI gets stuck.
     A dead renderer no longer receives keyboard input: that case is covered by the
     automatic reload from main (render-process-gone). Always active, regardless of the tab. */
  useShortcut(true, PRIORITY.GLOBAL, (ev) => {
    if (ev.key !== "F5") return false
    window.location.reload()
    return true
  })

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

  /* the folder-picker path shared with the home screen: open the dialog, and if a repo
     comes back, surface it as a tab. A cancelled dialog resolves to null and is a no-op. */
  const openDialog = useCallback(() => {
    void host.openDialog().then((res) => res && openTab(res))
  }, [openTab])

  const homeActive = active.kind === "home"

  /* Repository creation is a modal now (was a pinned tab): the "+" and File ▸ New repository
     open it; a created/cloned repo opens as a tab through `openTab`, which closes the dialog.
     The lazy dialog mounts on first open and stays mounted, so re-opens are instant and
     closing keeps its exit animation. */
  const [createOpen, setCreateOpen] = useState(false)
  const [createMounted, setCreateMounted] = useState(false)
  const openCreate = useCallback(() => {
    setCreateMounted(true)
    setCreateOpen(true)
  }, [])
  const openCreated = useCallback(
    (repo: Repo) => {
      setCreateOpen(false)
      openTab(repo)
    },
    [openTab]
  )

  const [settingsOpen, setSettingsOpen] = useState(false)
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  const [aboutOpen, setAboutOpen] = useState(false)
  const openAbout = useCallback(() => setAboutOpen(true), [])

  /* Menu → active repo: a menu item can't reach into a RepoView (different subtree), so it
     dispatches a nonce-stamped command that the foreground RepoView executes through its store. */
  const cmdSeq = useRef(0)
  const [repoCommand, setRepoCommand] = useState<RepoCommandEnvelope | null>(null)
  const sendRepoCommand = useCallback(
    (repoId: number, command: RepoCommand) => setRepoCommand({ repoId, command, nonce: ++cmdSeq.current }),
    []
  )
  const activeRepoId = active.kind === "repo" ? active.id : null

  /* The declarative menu bar's single seam into App state (see app/menu/types.ts). Subscribed
     to the theme mode and locale so the View menu's checkmarks stay live and a language switch
     re-renders the whole tree (the `messages` getters re-read the active locale on the next
     render — the memoized RepoViews subscribe to the locale themselves). The foreground repo's
     flow/status queries live in AppMenu, not here: subscribing App to them re-rendered every
     mounted tab on each git change (perf audit, finding 4d). */
  const themeMode = useThemeMode()
  const locale = useLocale()
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const menuCtx = useMemo<AppMenuContext>(
    () => ({
      newRepo: openCreate,
      openRepo: openDialog,
      closeActiveTab: () => active.kind === "repo" && closeTab(active.id),
      openSettings,
      openAbout,
      hasActiveRepo: active.kind === "repo",
      goHome: () => select(HOME),
      locale,
      setLocale,
      themeMode,
      setTheme,
      reload: () => window.location.reload(),
      openExternal: (url) => void window.open(url, "_blank", "noopener,noreferrer"),
      checkForUpdates: () => void host.checkForUpdates(),
    }),
    [active, closeTab, locale, openAbout, openCreate, openDialog, openSettings, select, themeMode]
  )

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs.map((r) => ({ key: r.id, name: r.name, path: r.path }))}
        active={toTabKey(active)}
        onSelect={(key) => select(fromTabKey(key))}
        onClose={closeTab}
        onNew={openCreate}
        menu={<AppMenu ctx={menuCtx} activeRepoId={activeRepoId} sendRepoCommand={sendRepoCommand} />}
      />

      {createMounted && (
        <Suspense fallback={null}>
          <CreateDialog open={createOpen} onOpenChange={setCreateOpen} onOpened={openCreated} />
        </Suspense>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {aboutOpen && (
        <Suspense fallback={null}>
          <AboutDialog onClose={() => setAboutOpen(false)} />
        </Suspense>
      )}

      {/* `data-tab-active` carries the view-transition names on the only visible tab (see app.css) */}
      <div className="relative min-h-0 flex-1">
        {/* invisible rather than hidden: the box stays laid out, so the canvas keeps its
            measured size and its scroll. */}
        <div
          role="tabpanel"
          id={panelId(TAB_STRIP_HOME)}
          aria-labelledby={tabId(TAB_STRIP_HOME)}
          data-tab-active={homeActive || undefined}
          className={cn("amont-tabbody absolute inset-0 flex flex-col", !homeActive && "invisible")}
        >
          <HomeScreen active={homeActive} onOpened={openTab} />
        </div>

        {tabs
          .filter((r) => mounted.includes(r.id))
          .map((r) => {
            const tabActive = active.kind === "repo" && active.id === r.id
            return (
              <div
                key={r.id}
                role="tabpanel"
                id={panelId(r.id)}
                aria-labelledby={tabId(r.id)}
                data-tab-active={tabActive || undefined}
                className={cn("absolute inset-0 flex flex-col", !tabActive && "invisible")}
              >
                <ErrorBoundary
                  key={resetNonce[r.id] ?? 0}
                  label={messages.app.reloadTab}
                  onReset={() => bumpReset(r.id)}
                >
                  <RepoView repo={r} active={tabActive} command={repoCommand} onOpenRepo={openTabStable} />
                </ErrorBoundary>
              </div>
            )
          })}

        <UpdateCard />
      </div>
    </div>
  )
}
