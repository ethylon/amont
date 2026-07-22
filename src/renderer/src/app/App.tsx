import { lazy, Suspense, useEffect, useMemo } from "react"

import { host, type BootState } from "@/lib/git"
import { HOME } from "@/app/navigation"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import { messages } from "@/lib/messages"
import { setTheme, useThemeMode } from "@/lib/theme"
import { setLocale, useLocale } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "@/app/error-boundary"
import { AppMenu, type AppMenuContext } from "@/app/menu"
import { fromTabKey, toTabKey, useTabs } from "@/app/use-tabs"
import { useDialogs } from "@/app/use-dialogs"
import { useRepoCommand } from "@/app/use-repo-command"
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

type Props = {
  /** promise set once by main.tsx (see boot() in lib/git.ts) */
  boot: Promise<BootState>
}

export default function App({ boot }: Props) {
  const { tabs, active, mounted, resetNonce, bumpReset, select, openTab, openTabStable, closeTab } = useTabs(boot)

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

  const homeActive = active.kind === "home"

  const {
    createOpen,
    setCreateOpen,
    createMounted,
    settingsOpen,
    setSettingsOpen,
    aboutOpen,
    setAboutOpen,
    openDialog,
    openCreate,
    openCreated,
    openSettings,
    openAbout,
  } = useDialogs(openTab)

  const { repoCommand, sendRepoCommand } = useRepoCommand()
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
