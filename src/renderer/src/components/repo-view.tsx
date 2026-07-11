import { useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { branchFlow } from "@/lib/commit-message"
import { repoApi, worktreeCount, type Repo } from "@/lib/git"
import { queryKeys, useFlowInfoQuery, useFlowQuery, useStatusQuery, useWorktreeQuery } from "@/lib/queries"
import { RepoProvider, useRepoEvents, useRepoStore, useRepoStoreApi } from "@/lib/repo-store"
import { PRIORITY, useShortcut } from "@/lib/shortcuts"
import { cn } from "@/lib/utils"
import { BootSkeleton } from "@/components/boot-skeleton"
import { CommitSearch } from "@/components/commit-search"
import { DetailPanel } from "@/components/detail-panel"
import { ErrorBoundary } from "@/components/error-boundary"
import { FlowBanner, FlowCard } from "@/components/flow-context"
import { GitConsole } from "@/components/git-console"
import { GraphColumn } from "@/components/graph-column"
import { RefsSidebar } from "@/components/refs-sidebar"
import { StatusBar } from "@/components/status-bar"
import { Toolbar } from "@/components/toolbar"
import { WorktreePanel } from "@/components/worktree-panel"

/** Révélation du boot : le squelette survit à son fondu de sortie avant d'être démonté, et
    `settled` attend la frame suivante pour ne pas rejouer les entrées animées du contenu déjà
    présent au boot (`gg-drop`/`gg-fadein`, cf. app.css). */
function useBootReveal(booted: boolean) {
  const [skeleton, setSkeleton] = useState(true)
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!booted) return
    const raf = requestAnimationFrame(() => setSettled(true))
    const t = window.setTimeout(() => setSkeleton(false), 240)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [booted])
  return { skeleton, settled }
}

type Props = {
  repo: Repo
  /** un onglet en arrière-plan reste monté : il ne prend ni le clavier, ni le titre de fenêtre */
  active: boolean
}

/** Layout de slots (AUDIT.md §5) : bannière / sidebar / centre / panneau / statusbar. Chaque
    panneau s'abonne à sa propre tranche du store ou de la couche requêtes — le prop drilling
    (10 props vers RefsSidebar, 14 vers WorktreePanel) disparaît avec lui. */
export function RepoView({ repo, active }: Props) {
  const api = useMemo(() => repoApi(repo.id), [repo.id])
  return (
    <RepoProvider repoId={repo.id} api={api}>
      <RepoViewContent repo={repo} active={active} />
    </RepoProvider>
  )
}

function RepoViewContent({ repo, active }: Props) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const storeApi = useRepoStoreApi()
  const queryClient = useQueryClient()

  const statusQuery = useStatusQuery(api, repoId)
  const flowQuery = useFlowQuery(api, repoId)
  const worktreeQuery = useWorktreeQuery(api, repoId)
  const status = statusQuery.data ?? null
  const flow = flowQuery.data ?? null
  const workFlow = status?.branch ? branchFlow(status.branch, flow) : null
  const flowInfoQuery = useFlowInfoQuery(api, repoId, status?.branch ?? null, workFlow)
  const flowInfo = flowInfoQuery.data ?? null

  /* l'arbre s'est vidé pendant qu'on le regardait : la vue n'a plus de sujet, et un amend en
     cours n'a plus de bloc où s'afficher */
  const worktree = worktreeQuery.data && worktreeCount(worktreeQuery.data) ? worktreeQuery.data : null
  useEffect(() => {
    if (!worktreeQuery.data || worktreeCount(worktreeQuery.data) > 0) return
    const s = storeApi.getState()
    if (s.ui.view === "wt") s.showCommits()
    if (s.commitDraft.amend) void s.toggleAmend(false)
  }, [worktreeQuery.data, storeApi])

  const sidebarOpen = useRepoStore((s) => s.ui.sidebarOpen)
  const view = useRepoStore((s) => s.ui.view)
  const diff = useRepoStore((s) => s.ui.diff)
  const selection = useRepoStore((s) => s.selection.rows)
  const selMode = useRepoStore((s) => s.selection.mode)
  const opState = useRepoStore((s) => s.ops.opState)
  const busyOp = useRepoStore((s) => s.ops.busyOp)
  const stats = useRepoStore((s) => s.graph.stats)
  const graphRef = useRepoStore((s) => s.graphRef)
  const toggleSidebar = useRepoStore((s) => s.toggleSidebar)
  const closeDiff = useRepoStore((s) => s.closeDiff)
  const openDiff = useRepoStore((s) => s.openDiff)
  const clearFocus = useRepoStore((s) => s.clearFocus)
  /* clé de secours de l'ErrorBoundary du détail : la sélection change déjà la clé, ceci
     couvre le cas d'une erreur qui persisterait sur la même sélection */
  const [detailNonce, setDetailNonce] = useState(0)

  /* Boot de l'onglet : status, flow, flowInfo, worktree et graphe arrivent en ordre dispersé —
     l'union du `isLoading` des requêtes remplace le bitmask `B_STATUS…B_ALL` : une requête
     désactivée (flowInfo hors flow) ne bloque jamais, `isLoading` y reste `false`. */
  const booted = !!stats && ![statusQuery, flowQuery, worktreeQuery, flowInfoQuery].some((q) => q.isLoading)
  const { skeleton, settled } = useBootReveal(booted)

  /* onChanged/onOp -> invalidations + resetAndLoad/showOp (cf. lib/repo-store.tsx) */
  useRepoEvents()

  /* git ne notifie rien : l'arbre a pu bouger dans l'éditeur pendant qu'on regardait ailleurs */
  useEffect(() => {
    if (!active) return
    const onFocus = () => queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, queryClient, repoId])

  /* --- Raccourcis --- */
  useShortcut(active, PRIORITY.DEFAULT, (ev) => {
    const mod = ev.ctrlKey || ev.metaKey
    if (mod && ev.key.toLowerCase() === "b") {
      ev.preventDefault()
      toggleSidebar()
      return true
    }
    if (ev.key === "Escape" && diff) {
      closeDiff()
      return true
    }
    return false
  })

  /* Un clic hors du sidebar, des panneaux détail/diff et des commits du graphe lève le focus.
     Les commits sont gérés par leur propre clic ; ici on ne traite que le « clic dans le vide ». */
  useEffect(() => {
    if (!active || !selection.length) return
    const onDown = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest("[data-gg-keep-focus], .gg-row, .gg-wtrow")) return
      clearFocus()
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [active, clearFocus, selection.length])

  const panelOpen = view === "wt" || selection.length > 0

  return (
    <>
      <Toolbar
        repo={repo}
        status={status}
        busyOp={busyOp}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onRunOp={(op) => api.op(op)}
      >
        <CommitSearch api={api} repoId={repoId} graph={graphRef} active={active} />
      </Toolbar>

      {/* Boot : le contenu reste invisible tant que toutes les premières lectures ne sont pas
          arrivées, puis tout se révèle dans la même frame — un fondu au lieu de quatre poussées.
          `data-settled` arme ensuite les entrées animées des insertions tardives (cf. app.css). */}
      <div data-settled={settled || undefined} className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-out motion-reduce:transition-none",
            !booted && "opacity-0"
          )}
        >
          {workFlow && flowInfo && status?.branch && <FlowBanner kind={workFlow} branch={status.branch} info={flowInfo} />}

          {/* gg-tabbody : le bloc qui glisse au changement d'onglet, toolbar et statut restant fixes */}
          <div className="gg-tabbody flex min-h-0 flex-1">
            <RefsSidebar />

            <main className="flex min-w-0 flex-1 flex-col">
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,1fr)_minmax(240px,320px)] grid-rows-[minmax(0,1fr)]">
                <GraphColumn />

                {/* colonne : l'en-tête du détail est figé, la liste et le diff scrollent chacun chez eux.
                    Les panneaux rendent des fragments — leurs enfants sont donc les items flex. */}
                {/* fond opaque : si le graphe déborde de sa colonne, il passe dessous sans transparaître */}
                <aside data-gg-keep-focus className="flex min-h-0 flex-col overflow-hidden border-l bg-background px-4.5 py-4">
                  {view === "wt" && worktree ? (
                    <WorktreePanel />
                  ) : panelOpen && graphRef.current ? (
                    <ErrorBoundary key={`${selection.join(",")}:${detailNonce}`} onReset={() => setDetailNonce((n) => n + 1)}>
                      <DetailPanel
                        api={api}
                        repoId={repoId}
                        graph={graphRef.current}
                        selection={selection}
                        selMode={selMode}
                        activePath={diff?.file.path}
                        onOpenDiff={openDiff}
                        onJump={(hash) => graphRef.current?.jumpTo(hash)}
                      />
                    </ErrorBoundary>
                  ) : workFlow && flowInfo && status?.branch ? (
                    <>
                      <FlowCard kind={workFlow} branch={status.branch} info={flowInfo} />
                      <p className="mt-3 shrink-0 text-xs text-muted-foreground">Clique un commit pour le détail.</p>
                    </>
                  ) : (
                    <p className="shrink-0 text-xs text-muted-foreground">Clique un commit pour le détail.</p>
                  )}
                </aside>
              </div>
            </main>
          </div>
        </div>

        {skeleton && <BootSkeleton out={booted} sidebar={sidebarOpen} />}
      </div>

      <StatusBar
        branch={status?.branch ?? null}
        flow={workFlow}
        opState={opState}
        stats={stats}
        console={<GitConsole repoId={repo.id} />}
      />
    </>
  )
}
