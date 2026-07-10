import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  onChanged, onOp, repoApi, worktreeCount,
  type BranchAct, type FileChange, type FlowInfo, type FlowPrefixes, type GitRef, type OpName, type Repo,
  type Status, type Worktree,
} from "@/lib/git"
import { branchFlow } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { BootSkeleton } from "@/components/boot-skeleton"
import { CommitGraph } from "@/components/commit-graph"
import { CommitSearch } from "@/components/commit-search"
import { DetailPanel, type SelMode } from "@/components/detail-panel"
import { DiffView, type DiffCtx, type DiffView as DiffMode } from "@/components/diff-view"
import { FlowBanner, FlowCard } from "@/components/flow-context"
import { GitConsole } from "@/components/git-console"
import type { GraphHandle, Stats } from "@/components/graph-canvas"
import { RefsSidebar } from "@/components/refs-sidebar"
import { StatusBar, type OpState } from "@/components/status-bar"
import { Toolbar } from "@/components/toolbar"
import { WorktreePanel, type WtAct } from "@/components/worktree-panel"

/* Pièces du premier chargement, en bits ; le graphe, lui, est signalé par `stats`. */
const B_STATUS = 1, B_FLOW = 2, B_WT = 4, B_FLOWINFO = 8, B_ALL = 15

const WT_COUNTERS = [
  { key: "conflicts", color: "danger" },
  { key: "staged", color: "success" },
  { key: "unstaged", color: "warning" },
  { key: "untracked", color: "neutral" },
] as const

type Props = {
  repo: Repo
  /** un onglet en arrière-plan reste monté : il ne prend ni le clavier, ni le titre de fenêtre */
  active: boolean
}

export function RepoView({ repo, active }: Props) {
  const api = useMemo(() => repoApi(repo.id), [repo.id])

  const [status, setStatus] = useState<Status | null>(null)
  const [flow, setFlow] = useState<FlowPrefixes | null>(null)
  const [flowInfo, setFlowInfo] = useState<FlowInfo | null>(null)
  const [worktree, setWorktree] = useState<Worktree | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  /* git ne notifie rien : les refs sont relues à chaque fois que le statut l'a été */
  const [refsGen, setRefsGen] = useState(0)
  const [selection, setSelection] = useState<number[]>([])
  const [selMode, setSelMode] = useState<SelMode>("multi")
  /* Refs focalisées dans le sidebar, `kind:name`. Posées à chaque interaction plutôt que dérivées
     de la sélection : deux branches sur le même commit (master et une branche fraîche) rendraient
     la dérivation ambiguë — l'identité cliquée tranche. Ctrl accumule, comme pour les commits. */
  const [focusedKeys, setFocusedKeys] = useState<Set<string>>(() => new Set())
  const [view, setView] = useState<"commits" | "wt">("commits")
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

  /* Boot de l'onglet : status, flow, flowInfo, worktree et graphe arrivent en ordre dispersé,
     et chaque arrivée pousserait le layout. Tout reste masqué derrière BootSkeleton et se
     révèle en une seule frame quand le dernier morceau est là. */
  const [boot, setBoot] = useState(0)
  const [skeleton, setSkeleton] = useState(true)
  /* posé une frame après la révélation : les entrées animées (gg-drop, gg-fadein) ne jouent
     que pour les insertions ultérieures, pas pour les éléments présents au boot */
  const [settled, setSettled] = useState(false)
  const mark = useCallback((bit: number) => setBoot((v) => v | bit), [])
  const booted = !!stats && boot === B_ALL

  const graphRef = useRef<GraphHandle | null>(null)
  const okTimer = useRef<number>(0)
  /* brouillon de message mis de côté le temps qu'un amend emprunte celui du dernier commit */
  const draftRef = useRef<{ subject: string; description: string } | null>(null)

  /* la pastille s'efface d'elle-même ; seule une action (« Recharger ») la garde en place */
  const showOp = useCallback((text: string, color: OpState["color"], action?: OpState["action"]) => {
    clearTimeout(okTimer.current)
    setOpState({ text, color, action })
    if (!action) okTimer.current = window.setTimeout(() => setOpState(null), 6000)
  }, [])

  const refreshStatus = useCallback(async () => {
    const st = await api.status().catch(() => null)
    if (st) setStatus(st)
    mark(B_STATUS)
    setRefsGen((g) => g + 1)
  }, [api, mark])

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
    mark(B_WT)
  }, [api, mark])

  const resetAndLoad = useCallback(async () => {
    setSelection([])
    setFocusedKeys(new Set())
    setDiff(null)
    setView("commits")
    await graphRef.current?.reset()
    await refreshWorktree()
  }, [refreshWorktree])

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  /* `git flow init` peut arriver après l'ouverture de l'onglet : relu au rythme des refs,
     pas mis en cache. Un `git config` coûte moins que le `for-each-ref --merged` d'à côté. */
  useEffect(() => {
    let stale = false
    api.flow().then(
      (f) => {
        if (!stale) setFlow(f)
        mark(B_FLOW)
      },
      () => mark(B_FLOW)
    )
    return () => {
      stale = true
    }
  }, [api, mark, refsGen])

  /* type de travail de la branche courante : statusbar, cockpit et carte contexte */
  const workFlow = status?.branch ? branchFlow(status.branch, flow) : null

  /* le contexte du cockpit et de la carte suit la branche et les refs ; hors flow, rien à mesurer */
  useEffect(() => {
    if (!workFlow || !status?.branch) {
      setFlowInfo(null)
      return
    }
    let stale = false
    api.flowInfo(status.branch, workFlow).then(
      (i) => {
        if (!stale) setFlowInfo(i)
        mark(B_FLOWINFO)
      },
      () => {
        if (!stale) setFlowInfo(null)
        mark(B_FLOWINFO)
      }
    )
    return () => {
      stale = true
    }
  }, [api, mark, refsGen, status?.branch, workFlow])

  /* hors flow (tronc, HEAD détachée) : le boot n'a pas de flowInfo à attendre */
  useEffect(() => {
    if (status && !workFlow) mark(B_FLOWINFO)
  }, [mark, status, workFlow])

  /* Révélation : le squelette survit à son fondu de sortie avant d'être démonté, et
     `data-settled` attend la frame suivante pour ne pas rejouer les entrées du boot. */
  useEffect(() => {
    if (!booted) return
    const raf = requestAnimationFrame(() => setSettled(true))
    const t = window.setTimeout(() => setSkeleton(false), 240)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(t)
    }
  }, [booted])

  useEffect(() => {
    if (active) document.title = `Amont — ${repo.name}`
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
        if (p.state === "start") return
        if (p.state === "error") {
          refreshStatus()
          return showOp(p.message, "danger")
        }
        await refreshStatus()
        if (p.op === "pull") {
          await resetAndLoad()
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
        }
      }),
    [refreshStatus, repo.id, resetAndLoad, showOp]
  )

  /* --- Sélection : la source de vérité est ici, le canvas ne fait qu'appliquer les classes --- */
  useEffect(() => {
    graphRef.current?.setSelection(selection)
  }, [selection])

  /* Clé de focus d'une ligne : la branche du commit — la première de `branchesOf` (HEAD, puis
     locales, puis distantes) quand plusieurs se partagent le commit. */
  const keyOfRow = useCallback((row: number) => {
    const b = graphRef.current?.branchesOf(row)[0]
    return b ? `${b.kind}:${b.name}` : null
  }, [])

  const selectRow = useCallback(
    (row: number, additive: boolean) => {
      setSelMode("multi")
      setView("commits")
      setDiff(null)
      const key = keyOfRow(row)
      if (!additive) {
        setSelection([row])
        setFocusedKeys(new Set(key ? [key] : []))
        return
      }
      /* Ctrl : la ligne et sa branche suivent le même toggle. Si un autre commit de la même
         branche reste sélectionné, elle s'éteint quand même — dernier geste gagnant. */
      const rows = new Set(selection)
      const removing = rows.has(row)
      removing ? rows.delete(row) : rows.add(row)
      setSelection([...rows].sort((a, b) => a - b))
      if (!key) return
      const keys = new Set(focusedKeys)
      removing ? keys.delete(key) : keys.add(key)
      setFocusedKeys(keys)
    },
    [focusedKeys, keyOfRow, selection]
  )

  const selectBranch = useCallback(
    (row: number) => {
      const rows = graphRef.current!.branchSegment(row).sort((a, b) => a - b)
      setSelMode("branch")
      setView("commits")
      setDiff(null)
      const key = keyOfRow(row)
      setFocusedKeys(new Set(key ? [key] : []))
      setSelection(rows)
    },
    [keyOfRow]
  )

  /* Focus d'une ref du sidebar. Clic : scroll au tip, la branche entière (le commit seul pour un
     tag) remplace la sélection — même geste que le double-clic d'une ligne du graphe. Ctrl :
     ajoute la ref au focus, ou l'en retire si elle y est déjà ; le panneau passe en multi, deux
     segments disjoints n'ayant pas de diff de branche. Les états sont posés après le jumpTo,
     qui sélectionne et dérive au passage : l'identité réellement cliquée a le dernier mot. */
  const focusRef = useCallback(
    async (r: GitRef, additive: boolean) => {
      const g = graphRef.current
      if (!g) return
      const key = `${r.kind}:${r.name}`
      const removing = additive && focusedKeys.has(key)
      if (!removing) await g.jumpTo(r.tip)
      const row = (await g.rowsOf([r.tip]))[0]
      if (row === undefined) return
      const seg = r.kind === "tag" ? [row] : g.branchSegment(row)
      setView("commits")
      setDiff(null)
      if (!additive) {
        setSelMode(r.kind === "tag" ? "multi" : "branch")
        setSelection([...seg].sort((a, b) => a - b))
        setFocusedKeys(new Set([key]))
        return
      }
      setSelMode("multi")
      const keys = new Set(focusedKeys)
      const rows = new Set(selection)
      removing ? keys.delete(key) : keys.add(key)
      for (const x of seg) removing ? rows.delete(x) : rows.add(x)
      setFocusedKeys(keys)
      setSelection([...rows].sort((a, b) => a - b))
    },
    [focusedKeys, selection]
  )

  const clearFocus = useCallback(() => {
    setSelection([])
    setDiff(null)
    setFocusedKeys(new Set())
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
      const err = await api.checkout(name).then(() => null, (e: Error) => e.message)
      await refreshStatus()
      await resetAndLoad()
      if (err) showOp(err, "danger")
    },
    [api, refreshStatus, resetAndLoad, showOp]
  )

  /* Un merge en conflit, un `flow finish` interrompu : l'échec laisse l'arbre et les refs
     déplacés. On recharge dans tous les cas, comme pour le checkout. */
  const runBranch = useCallback(
    async (action: BranchAct, name: string) => {
      const err = await api.branch(action, name).then(() => null, (e: Error) => e.message)
      await refreshStatus()
      await resetAndLoad()
      if (err) showOp(err, "danger")
    },
    [api, refreshStatus, resetAndLoad, showOp]
  )

  /* --- Raccourcis --- */
  useEffect(() => {
    if (!active) return
    const onKey = (ev: KeyboardEvent) => {
      const mod = ev.ctrlKey || ev.metaKey
      if (mod && ev.key.toLowerCase() === "b") {
        ev.preventDefault()
        toggleSidebar()
      } else if (ev.key === "Escape") {
        closeDiff()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [active, closeDiff, toggleSidebar])

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
          {workFlow && flowInfo && status?.branch && (
            <FlowBanner kind={workFlow} branch={status.branch} info={flowInfo} />
          )}

          {/* gg-tabbody : le bloc qui glisse au changement d'onglet, toolbar et statut restant fixes */}
          <div className="gg-tabbody flex min-h-0 flex-1">
            <RefsSidebar
              api={api}
              open={sidebarOpen}
              refreshKey={`refs:${repo.id}:${refsGen}`}
              flow={flow}
              onCheckout={checkout}
              onBranch={runBranch}
              onFocusRef={focusRef}
              focusedKeys={focusedKeys}
            />

            <main className="flex min-w-0 flex-1 flex-col">
              <div
                style={{ "--graphw": `${graphW}px`, "--gg-branch": `${branchW}px` } as React.CSSProperties}
                /* fenêtre étroite : le détail cède de 320 à 240px avant que le graphe (280px plancher)
                   ne se réduise à un ruban derrière son propre scrollbar */
                className="grid min-h-0 flex-1 grid-cols-[minmax(280px,1fr)_minmax(240px,320px)] grid-rows-[minmax(0,1fr)]"
              >
                <div className="grid min-w-0 grid-rows-[auto_minmax(0,1fr)]">
                  {worktree && (
                    <div
                      onClick={showWorktree}
                      className={cn(
                        "gg-wtrow gg-drop relative flex h-8.5 cursor-pointer items-center gap-2.5 border-b border-l-2 border-dashed border-l-transparent pr-4.5 text-xs text-muted-foreground hover:bg-muted/60",
                        view === "wt" && "border-l-primary bg-primary/10 text-foreground"
                      )}
                    >
                      <span className="font-medium">Modifications non validées</span>
                      <span className="ms-auto flex gap-1">
                        {WT_COUNTERS.map(({ key, color }) =>
                          worktree[key].length ? (
                            <Badge key={key} color={color} shape="squared" className="tabular-nums">
                              {worktree[key].length}
                            </Badge>
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
