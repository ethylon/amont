import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  onChanged, onOp, repoApi, worktreeCount,
  type BranchAct, type FileChange, type OpName, type Repo, type Status, type Worktree,
} from "@/lib/git"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Tip } from "@/components/ui/tip"
import { CommandPalette } from "@/components/command-palette"
import { CommitGraph } from "@/components/commit-graph"
import { CommitSearch } from "@/components/commit-search"
import { DetailPanel, type SelMode } from "@/components/detail-panel"
import { DiffView, type DiffCtx, type DiffView as DiffMode } from "@/components/diff-view"
import { GitConsole } from "@/components/git-console"
import type { GraphHandle, Stats } from "@/components/graph-canvas"
import { RefsSidebar } from "@/components/refs-sidebar"
import { StatusBar, type OpState } from "@/components/status-bar"
import { Toolbar } from "@/components/toolbar"
import { WorktreePanel, type WtAct } from "@/components/worktree-panel"

const OP_LABEL: Record<OpName, string> = { fetch: "Fetch…", pull: "Pull…", push: "Push…" }

/** verbe en cours, puis participe : « Fusion de x… » → « x fusionnée » */
const BRANCH_LABEL: Record<BranchAct, [string, string]> = {
  merge: ["Fusion de", "fusionnée"],
  delete: ["Suppression de", "supprimée"],
  pull: ["Pull de", "à jour"],
  push: ["Push de", "poussée"],
  finish: ["Clôture de", "terminée"],
}

const WT_COUNTERS = [
  { key: "conflicts", color: "danger", label: "conflits" },
  { key: "staged", color: "success", label: "indexés" },
  { key: "unstaged", color: "warning", label: "modifiés" },
  { key: "untracked", color: "neutral", label: "non suivis" },
] as const

type Props = {
  repo: Repo
  /** un onglet en arrière-plan reste monté : il ne prend ni le clavier, ni le titre de fenêtre */
  active: boolean
  paletteOpen: boolean
  onPaletteChange(open: boolean): void
  onNewTab(): void
}

export function RepoView({ repo, active, paletteOpen, onPaletteChange, onNewTab }: Props) {
  const api = useMemo(() => repoApi(repo.id), [repo.id])

  const [status, setStatus] = useState<Status | null>(null)
  const [worktree, setWorktree] = useState<Worktree | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /* git ne notifie rien : les refs sont relues à chaque fois que le statut l'a été */
  const [refsGen, setRefsGen] = useState(0)
  const [selection, setSelection] = useState<number[]>([])
  const [selMode, setSelMode] = useState<SelMode>("multi")
  const [view, setView] = useState<"commits" | "wt">("commits")
  const [hoverInfo, setHoverInfo] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [opState, setOpState] = useState<OpState | null>(null)
  const [busyOp, setBusyOp] = useState<OpName | null>(null)
  const [diff, setDiff] = useState<{ ctx: DiffCtx; file: FileChange } | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>(
    () => (localStorage.getItem("gg.diffview") as DiffMode) || "unified"
  )
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [amend, setAmend] = useState(false)
  const [graphW, setGraphW] = useState(0)
  const [branchW, setBranchW] = useState(0)

  const graphRef = useRef<GraphHandle | null>(null)
  const okTimer = useRef<number>(0)
  /* brouillon de message mis de côté le temps qu'un amend emprunte celui du dernier commit */
  const draftRef = useRef<{ subject: string; description: string } | null>(null)

  const showOp = useCallback((text: string, color: OpState["color"], action?: OpState["action"]) => {
    clearTimeout(okTimer.current)
    setOpState({ text, color, action })
    if (color === "success") okTimer.current = window.setTimeout(() => setOpState(null), 3000)
  }, [])

  const refreshStatus = useCallback(async () => {
    const st = await api.status().catch(() => null)
    if (st) setStatus(st)
    setRefsGen((g) => g + 1)
  }, [api])

  const refreshWorktree = useCallback(async () => {
    const wt = await api.worktree().catch(() => null)
    const next = wt && worktreeCount(wt) ? wt : null
    setWorktree(next)
    /* l'arbre s'est vidé pendant qu'on le regardait : la vue n'a plus de sujet, et un amend
       en cours n'a plus de bloc où s'afficher */
    if (!next) {
      setView((v) => (v === "wt" ? "commits" : v))
      setAmend(false)
      draftRef.current = null
    }
  }, [api])

  const resetAndLoad = useCallback(async () => {
    setSelection([])
    setDiff(null)
    setHoverInfo(null)
    setView("commits")
    await graphRef.current?.reset()
    await refreshWorktree() // après le layout : le point de la ligne a besoin de la lane de HEAD
  }, [refreshWorktree])

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (active) document.title = `git-graph — ${repo.name}`
  }, [active, repo.name])

  /* git ne notifie rien : l'arbre a pu bouger dans l'éditeur pendant qu'on regardait ailleurs */
  useEffect(() => {
    if (!active) return
    const onFocus = () => refreshWorktree()
    window.addEventListener("focus", onFocus)
    return () => window.removeEventListener("focus", onFocus)
  }, [active, refreshWorktree])

  /* Les refs ont bougé hors de l'application : commit, rebase ou checkout depuis un terminal.
     Main ne prévient qu'au premier plan et se tait après nos propres commandes. */
  useEffect(
    () =>
      onChanged((p) => {
        if (p.id !== repo.id) return
        refreshStatus()
        resetAndLoad()
      }),
    [refreshStatus, repo.id, resetAndLoad]
  )

  /* --- Opérations git : le clic lance, mais tout le retour passe par onOp
     (l'auto-fetch du process main émet sans avoir d'appelant côté renderer). --- */
  useEffect(
    () =>
      onOp(async (p) => {
        if (p.id !== repo.id) return
        setBusyOp(p.state === "start" ? p.op : null)
        if (p.state === "start") return showOp(OP_LABEL[p.op], "neutral")
        if (p.state === "error") {
          refreshStatus()
          return showOp(p.message, "danger")
        }
        await refreshStatus()
        if (p.op === "pull") {
          await resetAndLoad()
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
              resetAndLoad()
            },
          })
        } else if (!p.auto) {
          showOp("Déjà à jour", "success")
        }
      }),
    [refreshStatus, repo.id, resetAndLoad, showOp]
  )

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

  /* Focus de branches dans le sidebar : leurs heads deviennent la sélection du graphe (donc le diff),
     et on scrolle vers la dernière ref touchée. Sélection vide = focus levé, le panneau se ferme. */
  const focusHeads = useCallback(async (tips: string[], scrollTo: string | null) => {
    const g = graphRef.current
    if (!g) return
    if (scrollTo) await g.jumpTo(scrollTo)
    const rows = await g.rowsOf(tips)
    setSelMode("multi")
    setView("commits")
    setDiff(null)
    setSelection([...new Set(rows)].sort((a, b) => a - b))
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
    async (act: WtAct, paths: string[]) => {
      try {
        await act(api, paths)
      } catch (e) {
        return showOp((e as Error).message, "danger")
      }
      await refreshWorktree()
    },
    [api, refreshWorktree, showOp]
  )

  /* Sujet et corps sont séparés par une ligne vide : c'est ce qui les distingue pour git. */
  const doCommit = useCallback(async () => {
    const subj = subject.trim()
    const body = description.trim()
    try {
      await api.commit(body ? `${subj}\n\n${body}` : subj, amend)
    } catch (e) {
      return showOp((e as Error).message, "danger")
    }
    setSubject("")
    setDescription("")
    setAmend(false)
    draftRef.current = null
    await refreshWorktree()
    refreshStatus()
    await resetAndLoad()
  }, [amend, api, description, refreshStatus, refreshWorktree, resetAndLoad, showOp, subject])

  /* Cocher « amender » emprunte le message du dernier commit après avoir mis le brouillon de côté ;
     le décocher rend ce brouillon. Un échec de lecture laisse la case telle quelle. */
  const toggleAmend = useCallback(
    async (on: boolean) => {
      if (!on) {
        const draft = draftRef.current
        draftRef.current = null
        setSubject(draft?.subject ?? "")
        setDescription(draft?.description ?? "")
        setAmend(false)
        return
      }
      const msg = await api.headMessage().catch(() => null)
      if (!msg) return
      draftRef.current = { subject, description }
      setSubject(msg.subject)
      setDescription(msg.body)
      setAmend(true)
    },
    [api, description, subject]
  )

  /* on recharge dans tous les cas : un `stash pop` en conflit échoue alors que HEAD a déjà bougé */
  const checkout = useCallback(
    async (name: string) => {
      showOp(`Bascule sur ${name}…`, "neutral")
      const err = await api.checkout(name).then(() => null, (e: Error) => e.message)
      await refreshStatus()
      await resetAndLoad()
      showOp(err ?? `Sur ${name}`, err ? "danger" : "success")
    },
    [api, refreshStatus, resetAndLoad, showOp]
  )

  /* Un merge en conflit, un `flow finish` interrompu : l'échec laisse l'arbre et les refs
     déplacés. On recharge dans tous les cas, comme pour le checkout. */
  const runBranch = useCallback(
    async (action: BranchAct, name: string) => {
      const [pending, done] = BRANCH_LABEL[action]
      showOp(`${pending} ${name}…`, "neutral")
      const err = await api.branch(action, name).then(() => null, (e: Error) => e.message)
      await refreshStatus()
      await resetAndLoad()
      showOp(err ?? `${name} ${done}`, err ? "danger" : "success")
    },
    [api, refreshStatus, resetAndLoad, showOp]
  )

  /* --- Raccourcis --- (Ctrl+K est géré par le shell : il traverse les onglets) */
  useEffect(() => {
    if (!active) return
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && ev.key.toLowerCase() === "b") {
        ev.preventDefault()
        toggleSidebar()
      } else if (ev.key === "Escape" && !paletteOpen) {
        closeDiff()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active, closeDiff, paletteOpen, toggleSidebar])

  /* le point s'aligne sur la lane de HEAD ; tant qu'elle n'est pas posée, pas de point */
  const headDot = useMemo(
    () => (stats ? (graphRef.current?.headDot(status?.head ?? null) ?? null) : null),
    [stats, status?.head]
  )

  /* hashes des commits sélectionnés : le sidebar y allume les branches dont le tip est sélectionné.
     Les lignes sélectionnées sont chargées, donc `commit()` les résout ; `stats` force le recalcul
     quand un relayout change l'assignation ligne → commit. */
  const selectedTips = useMemo(
    () => new Set(selection.map((r) => graphRef.current?.commit(r)?.h).filter((h): h is string => !!h)),
    [selection, stats]
  )

  /* Un clic hors du sidebar, des panneaux détail/diff et des commits du graphe lève le focus.
     Les commits sont gérés par leur propre clic ; ici on ne traite que le « clic dans le vide ». */
  useEffect(() => {
    if (!active || !selection.length) return
    const onDown = (ev: MouseEvent) => {
      if ((ev.target as HTMLElement).closest("[data-gg-keep-focus], .gg-row, .gg-wtrow")) return
      setSelection([])
      setDiff(null)
    }
    document.addEventListener("mousedown", onDown)
    return () => document.removeEventListener("mousedown", onDown)
  }, [active, selection.length])

  const panelOpen = view === "wt" || selection.length > 0
  /* rien à amender tant qu'aucun commit n'existe */
  const canAmend = !!status?.head

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
        <CommitSearch api={api} graph={graphRef} active={active} />
      </Toolbar>

      {/* gg-tabbody : le bloc qui glisse au changement d'onglet, toolbar et statut restant fixes */}
      <div className="gg-tabbody flex min-h-0 flex-1">
        <RefsSidebar
          api={api}
          open={sidebarOpen}
          refreshKey={`refs:${repo.id}:${refsGen}`}
          onCheckout={checkout}
          onBranch={runBranch}
          onFocusHeads={focusHeads}
          selectedTips={selectedTips}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div
            style={{ "--graphw": `${graphW}px`, "--gg-branch": `${branchW}px` } as React.CSSProperties}
            className="grid min-h-0 flex-1 grid-cols-[1fr_320px] grid-rows-[minmax(0,1fr)]"
          >
            <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
              {worktree && (
                <div
                  onClick={showWorktree}
                  className={cn(
                    "gg-wtrow relative flex h-8.5 cursor-pointer items-center gap-2.5 border-b border-l-2 border-dashed border-l-transparent pr-4.5 text-xs text-muted-foreground hover:bg-muted/60",
                    view === "wt" && "border-l-primary bg-primary/10 text-foreground"
                  )}
                >
                  {headDot && (
                    /* -2px : l'absolu se cale sur la padding-box, le SVG sur la border-box */
                    <span
                      className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed bg-background"
                      style={{ left: `calc(var(--gg-branch, 0px) + ${headDot.left - 2}px)`, color: headDot.color }}
                    />
                  )}
                  <span className="font-medium">Modifications non validées</span>
                  <span className="ms-auto flex gap-1">
                    {WT_COUNTERS.map(({ key, color, label }) =>
                      worktree[key].length ? (
                        <Tip key={key} text={label}>
                          <Badge color={color} shape="squared" className="tabular-nums">
                            {worktree[key].length}
                          </Badge>
                        </Tip>
                      ) : null
                    )}
                  </span>
                </div>
              )}

              {/* le diff recouvre le graphe au lieu de le démonter : scroll, sélection et
                  mise en page du canvas survivent à la fermeture */}
              <div className="relative grid min-h-0">
                <CommitGraph
                  graphRef={graphRef}
                  api={api}
                  onReady={() => resetAndLoad()}
                  callbacks={{
                    onSelect: selectRow,
                    onBranchSelect: selectBranch,
                    onHover: setHoverInfo,
                    onStats: setStats,
                    onGraphWidth: setGraphW,
                    onBranchWidth: setBranchW,
                  }}
                />
                {diff && (
                  <div data-gg-keep-focus className="absolute inset-0 z-2 flex flex-col bg-background">
                    <DiffView api={api} ctx={diff.ctx} file={diff.file} view={diffMode} onViewChange={changeDiffMode} onClose={closeDiff} />
                  </div>
                )}
              </div>
            </div>

            {/* colonne : l'en-tête du détail est figé, la liste et le diff scrollent chacun chez eux.
                Les panneaux rendent des fragments — leurs enfants sont donc les items flex. */}
            <aside data-gg-keep-focus className="flex min-h-0 flex-col overflow-hidden border-l px-4.5 py-4">
              {view === "wt" && worktree ? (
                <WorktreePanel
                  api={api}
                  worktree={worktree}
                  activePath={diff?.file.path}
                  subject={subject}
                  description={description}
                  amend={amend}
                  canAmend={canAmend}
                  onSubjectChange={setSubject}
                  onDescriptionChange={setDescription}
                  onAmendChange={toggleAmend}
                  onOpenDiff={openDiff}
                  onRun={runWt}
                  onCommit={doCommit}
                />
              ) : panelOpen && graphRef.current ? (
                <DetailPanel
                  api={api}
                  graph={graphRef.current}
                  selection={selection}
                  selMode={selMode}
                  activePath={diff?.file.path}
                  onOpenDiff={openDiff}
                  onJump={(hash) => graphRef.current?.jumpTo(hash)}
                />
              ) : (
                <p className="shrink-0 text-xs text-muted-foreground">Clique un commit pour le détail.</p>
              )}
            </aside>
          </div>
        </main>
      </div>

      <StatusBar
        branch={status?.branch ?? null}
        opState={opState}
        hoverInfo={hoverInfo}
        stats={stats}
        console={<GitConsole repoId={repo.id} />}
      />

      {active && (
        <CommandPalette
          open={paletteOpen}
          onOpenChange={onPaletteChange}
          onNewTab={onNewTab}
          onRunOp={(op) => api.op(op)}
          onToggleSidebar={toggleSidebar}
        />
      )}
    </>
  )
}
