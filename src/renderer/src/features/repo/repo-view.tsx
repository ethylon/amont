import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"

import { branchFlow } from "@/lib/gitflow"
import { host, repoApi, worktreeCount, type OpName, type Repo } from "@/lib/git"
import { useLocale, type Locale } from "@/lib/i18n"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { useFlowInfoQuery, useFlowQuery } from "@/features/flow/flow-queries"
import { useStatusQuery } from "@/features/repo/repo-queries"
import { useWorktreeQuery } from "@/features/worktree/worktree-queries"
import { RepoProvider, useRepoEvents, useRepoStore, useRepoStoreApi } from "@/features/repo/repo-store"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import { cn } from "@/lib/utils"
import { BootSkeleton } from "@/features/repo/boot-skeleton"
import { CommitSearch } from "@/features/search/commit-search"
import { DetailPanel } from "@/features/repo/detail-panel"
import { ErrorBoundary } from "@/app/error-boundary"
import { FlowBanner, FlowCard } from "@/features/flow/flow-context"
import { FlowStartBanner } from "@/features/flow/flow-start-banner"
import { repoHealth } from "@/features/maintenance/health"
import { useRepoMenuTools } from "@/features/repo/use-repo-menu-tools"
import type { RepoCommandEnvelope } from "@/features/repo/repo-commands"
import { GraphColumn } from "@/features/graph/react/graph-column"
import { RefsSidebar } from "@/features/refs/refs-sidebar"
import { StatusBar } from "@/features/repo/status-bar"
import { Toolbar } from "@/features/repo/toolbar"
import { WorktreePanel } from "@/features/worktree/worktree-panel"

/* Menu-driven modals, code-split behind their open state (perf audit, finding 6): neither
   exists until "Initialize Git Flow…" / "Database statistics…" is picked, so their form and
   report UI stay out of the entry chunk. Both already unmount on close (no exit animation to
   preserve), and both open as a dimmed overlay — a null Suspense fallback for the frame the
   chunk takes to load is invisible. */
const FlowInitDialog = lazy(() =>
  import("@/features/flow/flow-init-dialog").then((m) => ({ default: m.FlowInitDialog }))
)
const MaintenanceDialog = lazy(() =>
  import("@/features/maintenance/maintenance-dialog").then((m) => ({ default: m.MaintenanceDialog }))
)

/* GraphColumn belongs to features/graph — memoized here, at the import site (perf audit,
   finding 4b). It takes no props and subscribes to the store itself, so the memo cuts every
   re-render coming from this tab shell (boot reveal, status refetches, selection clicks…).
   `locale` is the one render input that arrives by cascade rather than by subscription:
   carrying it as the wrapper's sole prop lets a runtime language switch through the memo
   without remounting the canvas. */
const GraphColumnMemo = memo(function GraphColumnMemo({ locale: _locale }: { locale: Locale }) {
  return <GraphColumn />
})

/** Boot reveal: the skeleton survives its exit fade before being unmounted, and
    `settled` waits for the next frame so it doesn't replay the animated entrances of content already
    present at boot (`amont-drop`/`amont-fadein`, see app.css). */
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
  /** a background tab stays mounted: it takes neither the keyboard nor the window title */
  active: boolean
  /** the latest app-menu command; each RepoView acts only on the one addressed to its repo */
  command: RepoCommandEnvelope | null
  /** surfaces a repo opened from inside this tab (a linked worktree) as a new tab */
  onOpenRepo: (repo: Repo) => void
}

/** Slot layout (AUDIT.md §5): banner / sidebar / center / panel / statusbar. Each
    panel subscribes to its own slice of the store or the query layer — the prop drilling
    (10 props to RefsSidebar, 14 to WorktreePanel) disappears with it.

    memo (perf audit, finding 4d): App re-renders on any app-level change (theme, dialogs,
    tab moves) and keeps background tabs mounted — with stable props (App passes a
    ref-stable `onOpenRepo`; `command` only changes identity when a menu command actually
    fires) every mounted tab skips instead of re-rendering. */
export const RepoView = memo(function RepoView({ repo, active, command, onOpenRepo }: Props) {
  const api = useMemo(() => repoApi(repo.id), [repo.id])
  return (
    <RepoProvider repoId={repo.id} api={api} onOpenRepo={onOpenRepo}>
      <RepoViewContent repo={repo} active={active} command={command} />
    </RepoProvider>
  )
})

function RepoViewContent({ repo, active, command }: Omit<Props, "onOpenRepo">) {
  /* the memo above cuts App's render cascade, which runtime language switches ride on:
     subscribe directly so the tab (and its non-memoized descendants) still re-renders */
  const locale = useLocale()
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

  /* Repository-menu surfaces (Git Flow init/start, database maintenance), driven by the app menu
     through the command channel (see repo-commands.ts). */
  const tools = useRepoMenuTools(api, repoId, command)

  /* Object-DB healthcheck for the status bar: cheap `count-objects`, kept fresh but not chatty
     (5-min stale window; a gc invalidates it). `null` until the first read arrives. */
  const counts = useQuery({
    queryKey: queryKeys.countObjects(repoId),
    queryFn: () => api.countObjects(),
    staleTime: 5 * 60_000,
  }).data
  /* memoized: `health` feeds the memoized StatusBar — a fresh object per render would
     defeat its memo */
  const health = useMemo(() => (counts ? repoHealth(counts) : null), [counts])

  /* the tree emptied out while we were looking at it: the view no longer has a subject, and an
     in-progress amend no longer has a block to display in */
  const worktree = worktreeQuery.data && worktreeCount(worktreeQuery.data) ? worktreeQuery.data : null
  useEffect(() => {
    if (!worktreeQuery.data || worktreeCount(worktreeQuery.data) > 0) return
    const s = storeApi.getState()
    if (s.ui.view === "wt") s.showCommits()
    if (s.commitDraft.amend) void s.toggleAmend(false)
  }, [worktreeQuery.data, storeApi])

  const sidebarOpen = useRepoStore((s) => s.ui.sidebarOpen)
  const flowStartKind = useRepoStore((s) => s.ui.flowStartKind)
  const closeFlowStart = useRepoStore((s) => s.closeFlowStart)
  const view = useRepoStore((s) => s.ui.view)
  const diff = useRepoStore((s) => s.ui.diff)
  const selection = useRepoStore((s) => s.selection.rows)
  const selMode = useRepoStore((s) => s.selection.mode)
  const conflict = useRepoStore((s) => s.ui.conflict)
  const closeConflict = useRepoStore((s) => s.closeConflict)
  const opState = useRepoStore((s) => s.ops.opState)
  const busyOp = useRepoStore((s) => s.ops.busyOp)
  const opProgress = useRepoStore((s) => s.ops.opProgress)
  const stats = useRepoStore((s) => s.graph.stats)
  const graphRef = useRepoStore((s) => s.graphRef)
  const toggleSidebar = useRepoStore((s) => s.toggleSidebar)
  const closeDiff = useRepoStore((s) => s.closeDiff)
  const openDiff = useRepoStore((s) => s.openDiff)
  const clearFocus = useRepoStore((s) => s.clearFocus)
  /* key for the detail's ErrorBoundary — bumped by its "reload" button, so recovery still
     gets a fresh subtree. The selection is deliberately NOT part of the key (perf audit,
     finding 4b): the panel updates in place on selection change instead of remounting
     (and rebuilding a huge join string) per click; per-selection resets live on an inner
     key in detail-panel.tsx. */
  const [detailNonce, setDetailNonce] = useState(0)

  /* the same shared settings query the settings modal writes (queries.ts): the toolbar's
     fetch-command label reflects the live `--prune` choice. Undefined before load → default (on). */
  const prune =
    useQuery({ queryKey: queryKeys.settings(), queryFn: () => host.getSettings(), staleTime: Infinity }).data?.prune ??
    true

  /* stable callbacks/elements for the memoized children below — an inline closure or JSX
     literal would change identity every render and void their memos */
  const onRunOp = useCallback((op: OpName) => void api.op(op), [api])
  const onJump = useCallback((hash: string) => void graphRef.current?.jumpTo(hash), [graphRef])
  const runMaint = tools.runMaint
  const onCompact = useCallback(() => runMaint("gc"), [runMaint])
  const commitSearch = useMemo(
    () => <CommitSearch api={api} repoId={repoId} graph={graphRef} active={active} />,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- locale: the element must be recreated for a language switch to reach it through the memoized Toolbar
    [api, repoId, graphRef, active, locale]
  )

  /* Tab boot: status, flow, flowInfo, worktree and graph arrive in scattered order —
     the union of the queries' `isLoading` replaces the `B_STATUS…B_ALL` bitmask: a disabled
     query (flowInfo outside a flow) never blocks, `isLoading` stays `false` there. */
  const booted = !!stats && ![statusQuery, flowQuery, worktreeQuery, flowInfoQuery].some((q) => q.isLoading)
  const { skeleton, settled } = useBootReveal(booted)

  /* onChanged/onOp -> invalidations + resetAndLoad/showOp (see repo-store.tsx);
     `active` defers a background tab's reload until it's shown */
  useRepoEvents(active)

  /* git doesn't notify anything: the tree may have moved in the editor while we were looking
     elsewhere. `cancelRefetch: false` — the focus flush of a dirty repo (main/window.ts) lands
     at the same instant and already refetches this key; don't cancel-and-restart its read. */
  useEffect(() => {
    if (!active) return
    const onFocus = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) }, { cancelRefetch: false })
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, queryClient, repoId])

  /* --- Shortcuts --- */
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
    if (ev.key === "Escape" && conflict) {
      closeConflict()
      return true
    }
    return false
  })

  /* A click outside the sidebar, the detail/diff panels and the graph's commits clears the focus.
     Commits are handled by their own click; here we only handle the "click in empty space". */
  useEffect(() => {
    if (!active || !selection.length) return
    const onDown = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest("[data-amont-keep-focus], .amont-row, .amont-wtrow")) return
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
        onRunOp={onRunOp}
        prune={prune}
      >
        {commitSearch}
      </Toolbar>

      {/* Boot: the content stays invisible until all the initial reads have
          arrived, then everything reveals in the same frame — one fade instead of four pop-ins.
          `data-settled` then arms the animated entrances of late insertions (see app.css). */}
      <div data-settled={settled || undefined} className="relative flex min-h-0 flex-1 flex-col">
        <div
          className={cn(
            "flex min-h-0 flex-1 flex-col transition-opacity duration-200 ease-out motion-reduce:transition-none",
            !booted && "opacity-0"
          )}
        >
          {flowStartKind && (
            <FlowStartBanner
              key={flowStartKind}
              kind={flowStartKind}
              prefix={flow?.[flowStartKind] ?? `${flowStartKind}/`}
              onDone={closeFlowStart}
            />
          )}

          {workFlow && flowInfo && status?.branch && (
            <FlowBanner kind={workFlow} branch={status.branch} info={flowInfo} />
          )}

          {/* amont-tabbody: the block that slides on tab change, toolbar and status bar staying fixed */}
          <div className="amont-tabbody flex min-h-0 flex-1">
            <RefsSidebar />

            <main className="flex min-w-0 flex-1 flex-col">
              <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,1fr)_minmax(240px,320px)] grid-rows-[minmax(0,1fr)]">
                <GraphColumnMemo locale={locale} />

                {/* column: the detail header is fixed, the list and diff each scroll on their own.
                    The panels render fragments — so their children are the flex items. */}
                {/* opaque background: if the graph overflows its column, it passes underneath without showing through */}
                <aside
                  data-amont-keep-focus
                  className="flex min-h-0 flex-col overflow-hidden border-l bg-background px-4.5 py-4"
                >
                  {view === "wt" && worktree ? (
                    <WorktreePanel />
                  ) : panelOpen && graphRef.current ? (
                    /* resetKey: an error card caught on one commit must not survive a click on
                       another (the old per-selection key remounted its way out of this; the
                       boundary now recovers in place — `selection` is reference-stable) */
                    <ErrorBoundary key={detailNonce} resetKey={selection} onReset={() => setDetailNonce((n) => n + 1)}>
                      <DetailPanel
                        api={api}
                        repoId={repoId}
                        graph={graphRef.current}
                        selection={selection}
                        selMode={selMode}
                        activePath={diff?.file.path}
                        onOpenDiff={openDiff}
                        onJump={onJump}
                      />
                    </ErrorBoundary>
                  ) : workFlow && flowInfo && status?.branch ? (
                    <>
                      <FlowCard kind={workFlow} branch={status.branch} info={flowInfo} />
                      <p className="mt-3 shrink-0 text-xs text-muted-foreground">
                        {messages.repo.clickCommitForDetail}
                      </p>
                    </>
                  ) : (
                    <p className="shrink-0 text-xs text-muted-foreground">{messages.repo.clickCommitForDetail}</p>
                  )}
                </aside>
              </div>
            </main>
          </div>
        </div>

        {skeleton && <BootSkeleton out={booted} sidebar={sidebarOpen} />}
      </div>

      <StatusBar
        repoId={repo.id}
        branch={status?.branch ?? null}
        flow={workFlow}
        opState={opState}
        opProgress={opProgress}
        stats={stats}
        maint={tools.maint}
        health={health}
        onCompact={onCompact}
      />

      {/* Portaled dialogs: only for the foreground tab, so a background tab's open modal can't
          escape its hidden panel and overlay the active one. */}
      {active && tools.initOpen && (
        <Suspense fallback={null}>
          <FlowInitDialog onClose={tools.closeInit} />
        </Suspense>
      )}
      {active && tools.statsOpen && (
        <Suspense fallback={null}>
          <MaintenanceDialog
            api={api}
            repoId={repoId}
            maint={tools.maint}
            onRunMaint={tools.runMaint}
            onClose={() => tools.setStatsOpen(false)}
          />
        </Suspense>
      )}
    </>
  )
}
