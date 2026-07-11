import { useCallback, useEffect, useState } from "react"
import { flushSync } from "react-dom"

import { host, type BootState, type Repo } from "@/lib/git"
import { afterClose, HOME, navKeyEquals, repoKey, transitionKind, type NavKey } from "@/app/navigation"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import { cn } from "@/lib/utils"
import { ErrorBoundary } from "@/app/error-boundary"
import { HomeScreen } from "@/features/home/home-screen"
import { RepoView } from "@/features/repo/repo-view"
import { HOME as TAB_STRIP_HOME, panelId, tabId, TabStrip } from "@/app/tab-strip"

const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** Le contenu de l'onglet glisse ; le reste du châssis bascule net (cf. `.gg-tabview`). */
function transition(type: "next" | "prev" | "open", update: () => void) {
  if (reduced.matches) return update()
  document.startViewTransition({ types: [type], update: () => flushSync(update) })
}

/** TabStrip garde son API numérique (0 = accueil, cf. tab-strip.tsx) — la frontière du composant
    n'a pas bougé, seul l'état interne d'App adopte l'union discriminée `NavKey` (AUDIT.md §5,
    item 6 : le sentinel `HOME = 0` partageait l'espace des ids de dépôt par pure convention). */
const toTabKey = (k: NavKey): number => (k.kind === "home" ? TAB_STRIP_HOME : k.id)
const fromTabKey = (n: number): NavKey => (n === TAB_STRIP_HOME ? HOME : repoKey(n))

type Props = {
  /** promesse posée une fois par main.tsx (cf. boot() dans lib/git.ts) */
  boot: Promise<BootState>
}

export default function App({ boot }: Props) {
  /* l'accueil n'est pas dans `tabs` : il est épinglé, toujours là, jamais fermé */
  const [tabs, setTabs] = useState<Repo[]>([])
  const [active, setActive] = useState<NavKey>(HOME)
  /* un onglet visité reste monté : y revenir ne recharge pas son graphe, ne perd pas son scroll */
  const [mounted, setMounted] = useState<number[]>([])
  const [booted, setBooted] = useState(false)
  /* bump = démonte et remonte tout l'onglet (store compris) : le levier « recharger l'onglet »
     de l'ErrorBoundary qui l'entoure (AUDIT.md §5, item 8). */
  const [resetNonce, setResetNonce] = useState<Record<number, number>>({})
  const bumpReset = useCallback((id: number) => setResetNonce((n) => ({ ...n, [id]: (n[id] ?? 0) + 1 })), [])

  /* Le sens du glissement suit la barre d'onglets, l'accueil en position 0. Un dépôt qui n'y
     figure pas encore vient d'être ouvert : il arrive de face plutôt que par le côté.
     (`::view-transition-new` est un rendu vivant, pas une photo : un graphe encore en cours
     de pose finit de s'afficher pendant l'animation.) Transition pure et testée (cf.
     navigation.test.ts) : `select` ne fait plus que l'exécuter. */
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

  /* Le titre appartient à l'onglet actif — un seul effet ici, plutôt qu'un par RepoView
     qui ne le réinitialisait jamais en revenant sur l'accueil. */
  useEffect(() => {
    const name = active.kind === "repo" ? tabs.find((r) => r.id === active.id)?.name : null
    document.title = name ? `Amont — ${name}` : "Amont"
  }, [active, tabs])

  /* F5 : rechargement complet de la fenêtre — l'issue de secours quand l'UI se coince.
     Un renderer mort ne reçoit plus de clavier : ce cas est couvert par le reload
     automatique du main (render-process-gone). Toujours actif, quel que soit l'onglet. */
  useShortcut(true, PRIORITY.GLOBAL, (ev) => {
    if (ev.key !== "F5") return false
    window.location.reload()
    return true
  })

  /* restauration : pas d'animation, il n'y a pas d'état précédent à quitter */
  useEffect(() => {
    boot.then((s) => {
      if (s.tabs.length) {
        const key = s.active ?? s.tabs[0].id
        setTabs(s.tabs)
        setActive(repoKey(key))
        setMounted([key])
      }
      setBooted(true)
    })
  }, [boot])

  /* pas avant le boot : on écraserait les onglets persistés avec l'état initial vide */
  useEffect(() => {
    if (!booted) return
    host.setTabs(tabs.map((r) => r.path), tabs.find((r) => active.kind === "repo" && r.id === active.id)?.path ?? null)
  }, [booted, tabs, active])

  /* déjà ouvert : on s'y rend au lieu d'en faire un doublon (main renvoie le même id) */
  const openTab = useCallback(
    (repo: Repo) => {
      setTabs((prev) => (prev.some((r) => r.id === repo.id) ? prev : [...prev, repo]))
      select(repoKey(repo.id))
    },
    [select]
  )

  const closeTab = useCallback(
    (key: number) => {
      const i = tabs.findIndex((r) => r.id === key)
      if (i < 0) return
      host.close(key)
      const wasActive = active.kind === "repo" && active.id === key
      const next = afterClose(tabs, active, key)
      setTabs((prev) => prev.filter((r) => r.id !== key))
      setMounted((m) => m.filter((k) => k !== key))
      if (wasActive) select(next)
    },
    [active, select, tabs]
  )

  const homeActive = active.kind === "home"

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs.map((r) => ({ key: r.id, name: r.name, path: r.path }))}
        active={toTabKey(active)}
        onSelect={(key) => select(fromTabKey(key))}
        onClose={closeTab}
      />

      {/* `data-tab-active` porte les noms de view-transition sur le seul onglet visible (cf. app.css) */}
      <div className="relative min-h-0 flex-1">
        {/* invisible plutôt que hidden : la boîte reste posée, donc le canvas garde sa taille
            mesurée et son scroll. */}
        <div
          role="tabpanel"
          id={panelId(TAB_STRIP_HOME)}
          aria-labelledby={tabId(TAB_STRIP_HOME)}
          data-tab-active={homeActive || undefined}
          className={cn("gg-tabbody absolute inset-0 flex flex-col", !homeActive && "invisible")}
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
                  label="Recharger l'onglet"
                  onReset={() => bumpReset(r.id)}
                >
                  <RepoView repo={r} active={tabActive} />
                </ErrorBoundary>
              </div>
            )
          })}
      </div>
    </div>
  )
}
