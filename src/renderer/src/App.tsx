import { useCallback, useEffect, useState } from "react"
import { flushSync } from "react-dom"

import { bootState, host, type Repo } from "@/lib/git"
import { cn } from "@/lib/utils"
import { HomeScreen } from "@/components/home-screen"
import { RepoView } from "@/components/repo-view"
import { HOME, panelId, tabId, TabStrip } from "@/components/tab-strip"

const reduced = matchMedia("(prefers-reduced-motion: reduce)")

/** Le contenu de l'onglet glisse ; le reste du châssis bascule net (cf. `.gg-tabview`). */
function transition(type: "next" | "prev" | "open", update: () => void) {
  if (reduced.matches) return update()
  document.startViewTransition({ types: [type], update: () => flushSync(update) })
}

export default function App() {
  /* l'accueil n'est pas dans `tabs` : il est épinglé, toujours là, jamais fermé */
  const [tabs, setTabs] = useState<Repo[]>([])
  const [active, setActive] = useState(HOME)
  /* un onglet visité reste monté : y revenir ne recharge pas son graphe, ne perd pas son scroll */
  const [mounted, setMounted] = useState<number[]>([])
  const [booted, setBooted] = useState(false)

  /* Le sens du glissement suit la barre d'onglets, l'accueil en position 0. Un dépôt qui n'y
     figure pas encore vient d'être ouvert : il arrive de face plutôt que par le côté.
     (`::view-transition-new` est un rendu vivant, pas une photo : un graphe encore en cours
     de pose finit de s'afficher pendant l'animation.) */
  const select = useCallback(
    (key: number) => {
      if (key === active) return
      const pos = (k: number) => (k === HOME ? 0 : tabs.findIndex((r) => r.id === k) + 1)
      const known = key === HOME || tabs.some((r) => r.id === key)
      transition(!known ? "open" : pos(key) > pos(active) ? "next" : "prev", () => {
        setActive(key)
        if (key !== HOME) setMounted((m) => (m.includes(key) ? m : [...m, key]))
      })
    },
    [active, tabs]
  )

  /* Le titre appartient à l'onglet actif — un seul effet ici, plutôt qu'un par RepoView
     qui ne le réinitialisait jamais en revenant sur l'accueil. */
  useEffect(() => {
    const name = active === HOME ? null : tabs.find((r) => r.id === active)?.name
    document.title = name ? `Amont — ${name}` : "Amont"
  }, [active, tabs])

  /* F5 : rechargement complet de la fenêtre — l'issue de secours quand l'UI se coince.
     Un renderer mort ne reçoit plus de clavier : ce cas est couvert par le reload
     automatique du main (render-process-gone). */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "F5") window.location.reload()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  /* restauration : pas d'animation, il n'y a pas d'état précédent à quitter */
  useEffect(() => {
    bootState.then((s) => {
      if (s.tabs.length) {
        const key = s.active ?? s.tabs[0].id
        setTabs(s.tabs)
        setActive(key)
        setMounted([key])
      }
      setBooted(true)
    })
  }, [])

  /* pas avant le boot : on écraserait les onglets persistés avec l'état initial vide */
  useEffect(() => {
    if (!booted) return
    host.setTabs(tabs.map((r) => r.path), tabs.find((r) => r.id === active)?.path ?? null)
  }, [booted, tabs, active])

  /* déjà ouvert : on s'y rend au lieu d'en faire un doublon (main renvoie le même id) */
  const openTab = useCallback(
    (repo: Repo) => {
      setTabs((prev) => (prev.some((r) => r.id === repo.id) ? prev : [...prev, repo]))
      select(repo.id)
    },
    [select]
  )

  const closeTab = useCallback(
    (key: number) => {
      const i = tabs.findIndex((r) => r.id === key)
      if (i < 0) return
      host.close(key)
      const next = tabs.filter((r) => r.id !== key)
      setTabs(next)
      setMounted((m) => m.filter((k) => k !== key))
      if (active === key) select(next[Math.min(i, next.length - 1)]?.id ?? HOME)
    },
    [active, select, tabs]
  )

  return (
    <div className="flex h-full flex-col">
      <TabStrip
        tabs={tabs.map((r) => ({ key: r.id, name: r.name, path: r.path }))}
        active={active}
        onSelect={select}
        onClose={closeTab}
      />

      {/* `data-tab-active` porte les noms de view-transition sur le seul onglet visible (cf. app.css) */}
      <div className="relative min-h-0 flex-1">
        {/* invisible plutôt que hidden : la boîte reste posée, donc le canvas garde sa taille
            mesurée et son scroll. */}
        <div
          role="tabpanel"
          id={panelId(HOME)}
          aria-labelledby={tabId(HOME)}
          data-tab-active={active === HOME || undefined}
          className={cn("gg-tabbody absolute inset-0 flex flex-col", active !== HOME && "invisible")}
        >
          <HomeScreen active={active === HOME} onOpened={openTab} />
        </div>

        {tabs
          .filter((r) => mounted.includes(r.id))
          .map((r) => (
            <div
              key={r.id}
              role="tabpanel"
              id={panelId(r.id)}
              aria-labelledby={tabId(r.id)}
              data-tab-active={r.id === active || undefined}
              className={cn("absolute inset-0 flex flex-col", r.id !== active && "invisible")}
            >
              <RepoView repo={r} active={r.id === active} />
            </div>
          ))}
      </div>
    </div>
  )
}
