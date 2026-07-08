import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  api, worktreeCount,
  type FileChange, type LogMode, type OpEvent, type OpName, type Repo, type Status, type Worktree,
} from "@/lib/git"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CommandPalette } from "@/components/command-palette"
import { CommitGraph } from "@/components/commit-graph"
import { DetailPanel, type SelMode } from "@/components/detail-panel"
import { DiffView, type DiffCtx, type DiffView as DiffMode } from "@/components/diff-view"
import { EmptyState } from "@/components/empty-state"
import type { GraphHandle, Stats } from "@/components/graph-canvas"
import { RefsSidebar } from "@/components/refs-sidebar"
import { StatusBar, type OpState } from "@/components/status-bar"
import { Titlebar } from "@/components/titlebar"
import { Toolbar } from "@/components/toolbar"
import { WorktreePanel } from "@/components/worktree-panel"

/* Le preload n'expose pas de désabonnement : un seul écouteur est posé au chargement du
   module, et React n'en remplace que la cible. Sans ça, StrictMode doublerait les événements. */
let opHandler: ((p: OpEvent) => void) | null = null
api.onOp((p) => opHandler?.(p))

const OP_LABEL: Record<OpName, string> = { fetch: "Fetch…", pull: "Pull…", push: "Push…" }

const WT_COUNTERS = [
  { key: "conflicts", color: "danger", label: "conflits" },
  { key: "staged", color: "success", label: "indexés" },
  { key: "unstaged", color: "warning", label: "modifiés" },
  { key: "untracked", color: "neutral", label: "non suivis" },
] as const

export default function App() {
  const [repo, setRepo] = useState<Repo | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [worktree, setWorktree] = useState<Worktree | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [mode, setMode] = useState<LogMode>("all")
  const [selection, setSelection] = useState<number[]>([])
  const [selMode, setSelMode] = useState<SelMode>("multi")
  const [view, setView] = useState<"commits" | "wt">("commits")
  const [hoverInfo, setHoverInfo] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [opState, setOpState] = useState<OpState | null>(null)
  const [busyOp, setBusyOp] = useState<OpName | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [diff, setDiff] = useState<{ ctx: DiffCtx; file: FileChange } | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>(
    () => (localStorage.getItem("gg.diffview") as DiffMode) || "unified"
  )
  const [commitMsg, setCommitMsg] = useState("")
  const [graphW, setGraphW] = useState(0)

  const graphRef = useRef<GraphHandle | null>(null)
  const okTimer = useRef<number>(0)

  const showOp = useCallback((text: string, color: OpState["color"], action?: OpState["action"]) => {
    clearTimeout(okTimer.current)
    setOpState({ text, color, action })
    if (color === "success") okTimer.current = window.setTimeout(() => setOpState(null), 3000)
  }, [])

  const refreshStatus = useCallback(async () => {
    const st = await api.status().catch(() => null)
    if (st) setStatus(st)
  }, [])

  const refreshWorktree = useCallback(async () => {
    const wt = await api.worktree().catch(() => null)
    const next = wt && worktreeCount(wt) ? wt : null
    setWorktree(next)
    /* l'arbre s'est vidé pendant qu'on le regardait : la vue n'a plus de sujet */
    if (!next) setView((v) => (v === "wt" ? "commits" : v))
  }, [])

  const resetAndLoad = useCallback(
    async (m: LogMode) => {
      setSelection([])
      setDiff(null)
      setHoverInfo(null)
      setView("commits")
      await graphRef.current?.reset(m)
      await refreshWorktree() // après le layout : le point de la ligne a besoin de la lane de HEAD
    },
    [refreshWorktree]
  )

  /* --- Cycle de vie du repo --- */
  const openRepo = useCallback(async () => {
    const res = await api.openRepo()
    if (!res) return
    if ("error" in res) return showOp(res.error, "danger")
    setRepo(res)
  }, [showOp])

  useEffect(() => {
    api.current().then((r) => r && setRepo(r))
  }, [])

  useEffect(() => {
    if (!repo) return
    document.title = `git-graph — ${repo.name}`
    refreshStatus()
  }, [repo, refreshStatus])

  /* git ne notifie rien : l'arbre a pu bouger dans l'éditeur pendant qu'on regardait ailleurs */
  useEffect(() => {
    if (!repo) return
    const onFocus = () => refreshWorktree()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [repo, refreshWorktree])

  /* --- Opérations git : le clic lance, mais tout le retour passe par onOp
     (l'auto-fetch du process main émet sans avoir d'appelant côté renderer). --- */
  useEffect(() => {
    opHandler = async (p) => {
      setBusyOp(p.state === "start" ? p.op : null)
      if (p.state === "start") return showOp(OP_LABEL[p.op], "neutral")
      if (p.state === "error") {
        refreshStatus()
        return showOp(p.message, "danger")
      }
      await refreshStatus()
      if (p.op === "pull") {
        await resetAndLoad(mode)
        showOp("Branche à jour", "success")
      } else if (p.op === "push") {
        showOp("Poussé", "success")
      } else if (p.added > 0) {
        const s = p.added > 1 ? "s" : ""
        /* le graphe n'est pas rechargé d'office : ça perdrait le scroll et la sélection */
        showOp(`${p.added} nouveau${s} commit${s}`, "primary", {
          label: "Recharger",
          run: () => {
            setOpState(null)
            resetAndLoad(mode)
          },
        })
      } else if (!p.auto) {
        showOp("Déjà à jour", "success")
      }
    }
    return () => {
      opHandler = null
    }
  }, [mode, refreshStatus, resetAndLoad, showOp])

  /* --- Sélection : la source de vérité est ici, le canvas ne fait qu'appliquer les classes --- */
  useEffect(() => {
    graphRef.current?.setSelection(selection)
  }, [selection])

  const selectRow = useCallback((row: number, additive: boolean) => {
    setSelMode("multi")
    setView("commits")
    setDiff(null)
    setSelection((prev) => {
      if (!additive) return [row]
      const s = new Set(prev)
      s.has(row) ? s.delete(row) : s.add(row)
      return [...s].sort((a, b) => a - b)
    })
  }, [])

  const selectBranch = useCallback((row: number) => {
    const rows = graphRef.current!.branchSegment(row).sort((a, b) => a - b)
    setSelMode("branch")
    setView("commits")
    setDiff(null)
    setSelection(rows)
  }, [])

  const openDiff = useCallback((ctx: DiffCtx, file: FileChange) => setDiff({ ctx, file }), [])
  const closeDiff = useCallback(() => setDiff(null), [])

  const changeDiffMode = useCallback((m: DiffMode) => {
    setDiffMode(m)
    localStorage.setItem("gg.diffview", m)
  }, [])

  const showWorktree = useCallback(() => {
    setSelection([])
    setDiff(null)
    setView("wt")
  }, [])

  const runWt = useCallback(
    async (act: (paths: string[]) => Promise<void>, paths: string[]) => {
      try {
        await act(paths)
      } catch (e) {
        return showOp((e as Error).message, "danger")
      }
      await refreshWorktree()
    },
    [refreshWorktree, showOp]
  )

  const doCommit = useCallback(async () => {
    try {
      await api.commit(commitMsg)
    } catch (e) {
      return showOp((e as Error).message, "danger")
    }
    setCommitMsg("")
    await refreshWorktree()
    refreshStatus()
    await resetAndLoad(mode)
  }, [commitMsg, mode, refreshStatus, refreshWorktree, resetAndLoad, showOp])

  const changeMode = useCallback(
    (m: LogMode) => {
      setMode(m)
      resetAndLoad(m)
    },
    [resetAndLoad]
  )

  /* --- Raccourcis --- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey
      const k = ev.key.toLowerCase()
      if (mod && k === "k") {
        ev.preventDefault()
        setPaletteOpen(true)
      } else if (mod && k === "b" && repo) {
        ev.preventDefault()
        setSidebarOpen((v) => !v)
      } else if (ev.key === "Escape" && !paletteOpen) {
        closeDiff()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [closeDiff, paletteOpen, repo])

  /* le point s'aligne sur la lane de HEAD ; tant qu'elle n'est pas posée, pas de point */
  const headDot = useMemo(
    () => (stats ? (graphRef.current?.headDot(status?.head ?? null) ?? null) : null),
    [stats, status?.head]
  )

  const panelOpen = view === "wt" || selection.length > 0

  return (
    <div className="flex h-full flex-col">
      <Titlebar
        repoName={repo?.name ?? null}
        status={status}
        busyOp={busyOp}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onOpenRepo={openRepo}
        onOpenPalette={() => setPaletteOpen(true)}
        onRunOp={(op) => api.op(op)}
      />

      <div className="flex min-h-0 flex-1">
        {repo && sidebarOpen && <RefsSidebar />}

        <main className="flex min-w-0 flex-1 flex-col">
          {!repo ? (
            <EmptyState onOpenRepo={openRepo} />
          ) : (
            <>
              <Toolbar mode={mode} onModeChange={changeMode} onLoadAll={() => graphRef.current?.loadAll()} />

              <div
                style={{ "--graphw": `${graphW}px` } as React.CSSProperties}
                className={cn(
                  "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none",
                  !diff && "grid-cols-[1fr_320px]",
                  diff && diffMode === "unified" && "grid-cols-[1fr_minmax(470px,44%)]",
                  diff && diffMode === "sbs" && "grid-cols-[1fr_minmax(730px,62%)]"
                )}
              >
                <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
                  {worktree && (
                    <div
                      onClick={showWorktree}
                      title="Modifications non validées"
                      className={cn(
                        "gg-wtrow relative flex h-8.5 cursor-pointer items-center gap-2.5 border-b border-l-2 border-dashed border-l-transparent pr-4.5 text-xs text-muted-foreground hover:bg-muted/60",
                        view === "wt" && "border-l-primary bg-primary/10 text-foreground"
                      )}
                    >
                      {headDot && (
                        /* -2px : l'absolu se cale sur la padding-box, le SVG sur la border-box */
                        <span
                          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed bg-background"
                          style={{ left: headDot.left - 2, color: headDot.color }}
                        />
                      )}
                      <span className="font-medium">Modifications non validées</span>
                      <span className="ms-auto flex gap-1">
                        {WT_COUNTERS.map(({ key, color, label }) =>
                          worktree[key].length ? (
                            <Badge key={key} color={color} shape="squared" title={label} className="font-mono tabular-nums">
                              {worktree[key].length}
                            </Badge>
                          ) : null
                        )}
                      </span>
                    </div>
                  )}

                  <CommitGraph
                    graphRef={graphRef}
                    onReady={() => resetAndLoad(mode)}
                    callbacks={{
                      onSelect: selectRow,
                      onBranchSelect: selectBranch,
                      onHover: setHoverInfo,
                      onStats: setStats,
                      onGraphWidth: setGraphW,
                    }}
                  />
                </div>

                <aside className="overflow-auto border-l px-4.5 py-4">
                  {view === "wt" && worktree ? (
                    <WorktreePanel
                      worktree={worktree}
                      activePath={diff?.file.path}
                      message={commitMsg}
                      onMessageChange={setCommitMsg}
                      onOpenDiff={openDiff}
                      onRun={runWt}
                      onCommit={doCommit}
                    >
                      {diff && (
                        <DiffView ctx={diff.ctx} file={diff.file} view={diffMode} onViewChange={changeDiffMode} onClose={closeDiff} />
                      )}
                    </WorktreePanel>
                  ) : panelOpen && graphRef.current ? (
                    <DetailPanel
                      graph={graphRef.current}
                      selection={selection}
                      selMode={selMode}
                      activePath={diff?.file.path}
                      onOpenDiff={openDiff}
                      onJump={(hash) => graphRef.current?.jumpTo(hash)}
                    >
                      {diff && (
                        <DiffView ctx={diff.ctx} file={diff.file} view={diffMode} onViewChange={changeDiffMode} onClose={closeDiff} />
                      )}
                    </DetailPanel>
                  ) : (
                    <p className="text-xs text-muted-foreground">Clique un commit pour le détail.</p>
                  )}
                </aside>
              </div>
            </>
          )}
        </main>
      </div>

      <StatusBar branch={status?.branch ?? null} opState={opState} hoverInfo={hoverInfo} stats={repo ? stats : null} />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        hasRepo={!!repo}
        onOpenRepo={openRepo}
        onRunOp={(op) => api.op(op)}
        onToggleMainline={() => changeMode(mode === "all" ? "mainline" : "all")}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />
    </div>
  )
}
