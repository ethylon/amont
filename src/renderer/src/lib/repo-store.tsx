/* Store client par dépôt (AUDIT.md §5, chantier « état renderer ») : un store vanilla zustand
   par onglet ouvert, créé dans un `<RepoProvider>` et consommé par sélecteur — l'antidote au
   god-component `repo-view.tsx` (22 `useState`, 14 `useEffect`, 10 props vers RefsSidebar, 14
   vers WorktreePanel). Quatre slices :
   - `selection` : clavée par HASH de commit (pas par index de ligne) — l'invariant
     additif/soustractif du ctrl-clic vit dans `toggleAdditive`, un seul endroit pour les
     commits (`selectRow`) et les refs (`focusRef`). Après un reset du graphe, `resetAndLoad`
     re-résout les lignes via `graph.rowsOf(hashes)` : la sélection survit à pull/checkout/stash
     tant que les commits existent encore, plutôt que d'être vidée d'office.
   - `commitDraft` : sujet/description/amend du brouillon de commit.
   - `ui` : panneau latéral, vue courante, diff ouvert.
   - `ops` : opération réseau en cours, pastille de statut (auto-nettoyée par timer).
   `graphRef` vit dans le store comme ref non réactive (même forme que le `RefObject` que
   `CommitGraph` attend) : sa mutation ne notifie aucun abonné, seul un effet mince
   (composant du graphe) synchronise `selection.rows` → `graphRef.current.setSelection`.

   Le quatuor « op git → refresh → resetAndLoad → showOp », recopié quatre fois dans l'ancien
   repo-view.tsx (checkout, stash, branche — le commit a sa propre forme, l'échec n'y recharge
   rien), devient `runGitAction`. */

import { createContext, useContext, useEffect, useRef, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { createStore, useStore, type StoreApi } from "zustand"

import { describeError, describePayload } from "@/lib/errors"
import { onChanged, onOp, type BranchAct, type FileChange, type GitRef, type OpName, type RepoApi, type Stash, type StashAct } from "@/lib/git"
import { invalidateRepo, queryKeys } from "@/lib/queries"
import { queryClient } from "@/lib/query-client"
import type { DiffCtx, DiffView as DiffViewMode } from "@/components/diff-view"
import type { GraphHandle, Stats } from "@/components/graph-canvas"
import type { OpState } from "@/components/status-bar"
import type { WtAct } from "@/components/worktree-panel"

export type SelMode = "multi" | "branch"

export interface RepoStoreState {
  readonly repoId: number
  readonly api: RepoApi
  /** ref non réactive, même forme qu'un `RefObject<GraphHandle | null>` — passée telle quelle
      à `<CommitGraph graphRef={...}>` */
  readonly graphRef: { current: GraphHandle | null }

  selection: {
    hashes: string[]
    /** lignes résolues, triées croissant — ce que le canvas et DetailPanel consomment */
    rows: number[]
    mode: SelMode
    focusedKeys: Set<string>
  }
  commitDraft: {
    subject: string
    description: string
    amend: boolean
  }
  ui: {
    sidebarOpen: boolean
    view: "commits" | "wt"
    diff: { ctx: DiffCtx; file: FileChange } | null
    diffMode: DiffViewMode
  }
  ops: {
    busyOp: OpName | null
    opState: OpState | null
  }
  graph: {
    stats: Stats | null
  }

  selectRow(row: number, additive: boolean): void
  selectBranch(row: number): Promise<void>
  focusRef(r: GitRef, additive: boolean): Promise<void>
  focusStash(s: Stash): Promise<void>
  clearFocus(): void
  /** re-résout `selection.hashes` en lignes après un reset du graphe (pull/checkout/stash) ;
      un hash devenu introuvable (amend, rebase) est silencieusement abandonné. */
  reresolveSelection(): Promise<void>

  setSubject(v: string): void
  setDescription(v: string): void
  /** coche : emprunte sujet/corps du dernier commit, en gardant le brouillon de côté ;
      décoche : rend le brouillon mis de côté */
  toggleAmend(on: boolean): Promise<void>

  toggleSidebar(): void
  showWorktree(): void
  showCommits(): void
  openDiff(ctx: DiffCtx, file: FileChange): void
  closeDiff(): void
  setDiffMode(v: DiffViewMode): void

  setBusyOp(op: OpName | null): void
  showOp(text: string, color: OpState["color"], action?: OpState["action"]): void
  clearOp(): void
  setStats(stats: Stats): void

  /** referme le diff, revient à la vue commits, relance le graphe et re-résout la sélection */
  resetAndLoad(): Promise<void>
  /** op git → invalidation du statut → resetAndLoad → pastille d'erreur, en un seul endroit */
  runGitAction(action: () => Promise<void>, opts?: { onSuccess?(): void }): Promise<void>
  doCommit(): Promise<void>
  runStash(action: StashAct, name?: string): Promise<void>
  runBranch(action: BranchAct, name: string): Promise<void>
  checkout(name: string): Promise<void>
  runWt(act: WtAct, paths: string[]): Promise<void>
}

/** Ctrl-clic : bascule un ensemble d'éléments d'un coup — retire si le premier y est déjà,
    ajoute sinon. Même invariant pour les lignes de commit (`selectRow`) et les segments de
    branche (`focusRef`) : un seul endroit décide de « retirer » vs « ajouter ». */
function toggleAdditive<T>(set: Set<T>, items: T[]): boolean {
  const removing = items.length > 0 && set.has(items[0])
  for (const it of items) removing ? set.delete(it) : set.add(it)
  return removing
}

const keyOfRow = (g: GraphHandle, row: number): string | null => {
  const b = g.branchesOf(row)[0]
  return b ? `${b.kind}:${b.name}` : null
}

export function createRepoStore(repoId: number, api: RepoApi): StoreApi<RepoStoreState> {
  let okTimer = 0
  /* brouillon de message mis de côté le temps qu'un amend emprunte celui du dernier commit */
  let draftBackup: { subject: string; description: string } | null = null

  return createStore<RepoStoreState>((set, get) => ({
    repoId,
    api,
    graphRef: { current: null },

    selection: { hashes: [], rows: [], mode: "multi", focusedKeys: new Set() },
    commitDraft: { subject: "", description: "", amend: false },
    ui: {
      sidebarOpen: true,
      view: "commits",
      diff: null,
      diffMode: (localStorage.getItem("gg.diffview") as DiffViewMode) || "unified",
    },
    ops: { busyOp: null, opState: null },
    graph: { stats: null },

    selectRow(row, additive) {
      const g = get().graphRef.current
      if (!g) return
      const c = g.commit(row)
      if (!c) return
      const key = keyOfRow(g, row)
      set((s) => {
        if (!additive) {
          return {
            selection: { hashes: [c.h], rows: [row], mode: "multi", focusedKeys: new Set(key ? [key] : []) },
            ui: { ...s.ui, view: "commits", diff: null },
          }
        }
        const hashes = new Set(s.selection.hashes)
        const rows = new Set(s.selection.rows)
        const removing = toggleAdditive(rows, [row])
        removing ? hashes.delete(c.h) : hashes.add(c.h)
        const focusedKeys = new Set(s.selection.focusedKeys)
        if (key) removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        return {
          selection: { hashes: [...hashes], rows: [...rows].sort((a, b) => a - b), mode: "multi", focusedKeys },
          ui: { ...s.ui, view: "commits", diff: null },
        }
      })
      g.setSelection(get().selection.rows)
    },

    async selectBranch(row) {
      const g = get().graphRef.current
      if (!g) return
      const rows = g.branchSegment(row).sort((a, b) => a - b)
      await g.pin(rows) // le détail lit `commit(row)` en synchrone sur toute la sélection
      const key = keyOfRow(g, row)
      const hashes = rows.map((r) => g.commit(r)!.h)
      set((s) => ({
        selection: { hashes, rows, mode: "branch", focusedKeys: new Set(key ? [key] : []) },
        ui: { ...s.ui, view: "commits", diff: null },
      }))
      g.setSelection(rows)
    },

    async focusRef(r, additive) {
      const g = get().graphRef.current
      if (!g) return
      const key = `${r.kind}:${r.name}`
      const removing = additive && get().selection.focusedKeys.has(key)
      if (!removing) await g.jumpTo(r.tip)
      const row = (await g.rowsOf([r.tip]))[0]
      if (row === undefined) return
      const seg = r.kind === "tag" ? [row] : g.branchSegment(row)
      await g.pin(seg) // le détail lit `commit(row)` en synchrone sur toute la sélection

      if (!additive) {
        const sorted = [...seg].sort((a, b) => a - b)
        const hashes = sorted.map((x) => g.commit(x)!.h)
        set((s) => ({
          selection: { hashes, rows: sorted, mode: r.kind === "tag" ? "multi" : "branch", focusedKeys: new Set([key]) },
          ui: { ...s.ui, view: "commits", diff: null },
        }))
        g.setSelection(get().selection.rows)
        return
      }

      set((s) => {
        const focusedKeys = new Set(s.selection.focusedKeys)
        const rows = new Set(s.selection.rows)
        for (const x of seg) removing ? rows.delete(x) : rows.add(x)
        removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        const sortedRows = [...rows].sort((a, b) => a - b)
        const hashes = sortedRows.map((x) => g.commit(x)!.h)
        return {
          selection: { hashes, rows: sortedRows, mode: "multi", focusedKeys },
          ui: { ...s.ui, view: "commits", diff: null },
        }
      })
      g.setSelection(get().selection.rows)
    },

    async focusStash(s) {
      await get().graphRef.current?.jumpTo(s.h)
    },

    clearFocus() {
      set((s) => ({
        selection: { hashes: [], rows: [], mode: s.selection.mode, focusedKeys: new Set() },
        ui: { ...s.ui, diff: null },
      }))
      get().graphRef.current?.setSelection([])
    },

    async reresolveSelection() {
      const g = get().graphRef.current
      const { hashes } = get().selection
      if (!g || !hashes.length) {
        set((s) => ({ selection: { ...s.selection, rows: [] } }))
        return
      }
      const rows = [...(await g.rowsOf(hashes))].sort((a, b) => a - b)
      await g.pin(rows)
      const resolvedHashes = rows.map((r) => g.commit(r)!.h)
      set((s) => ({ selection: { ...s.selection, rows, hashes: resolvedHashes } }))
      g.setSelection(rows)
    },

    setSubject(v) {
      set((s) => ({ commitDraft: { ...s.commitDraft, subject: v } }))
    },
    setDescription(v) {
      set((s) => ({ commitDraft: { ...s.commitDraft, description: v } }))
    },
    async toggleAmend(on) {
      if (!on) {
        const draft = draftBackup
        draftBackup = null
        set(() => ({ commitDraft: { subject: draft?.subject ?? "", description: draft?.description ?? "", amend: false } }))
        return
      }
      const msg = await api.headMessage().catch(() => null)
      if (!msg) return
      draftBackup = { subject: get().commitDraft.subject, description: get().commitDraft.description }
      set(() => ({ commitDraft: { subject: msg.subject, description: msg.body, amend: true } }))
    },

    toggleSidebar() {
      set((s) => ({ ui: { ...s.ui, sidebarOpen: !s.ui.sidebarOpen } }))
    },
    showWorktree() {
      set((s) => ({ selection: { ...s.selection, rows: [], hashes: [] }, ui: { ...s.ui, diff: null, view: "wt" } }))
      get().graphRef.current?.setSelection([])
    },
    showCommits() {
      set((s) => ({ ui: { ...s.ui, view: "commits" } }))
    },
    openDiff(ctx, file) {
      set((s) => ({ ui: { ...s.ui, diff: { ctx, file } } }))
    },
    closeDiff() {
      set((s) => ({ ui: { ...s.ui, diff: null } }))
    },
    setDiffMode(v) {
      localStorage.setItem("gg.diffview", v)
      set((s) => ({ ui: { ...s.ui, diffMode: v } }))
    },

    setBusyOp(op) {
      set((s) => ({ ops: { ...s.ops, busyOp: op } }))
    },
    /* la pastille s'efface d'elle-même ; seule une action (« Recharger ») la garde en place */
    showOp(text, color, action) {
      clearTimeout(okTimer)
      set((s) => ({ ops: { ...s.ops, opState: { text, color, action } } }))
      if (!action) okTimer = window.setTimeout(() => set((s) => ({ ops: { ...s.ops, opState: null } })), 6000)
    },
    clearOp() {
      clearTimeout(okTimer)
      set((s) => ({ ops: { ...s.ops, opState: null } }))
    },
    setStats(stats) {
      set((s) => ({ graph: { ...s.graph, stats } }))
    },

    async resetAndLoad() {
      set((s) => ({ ui: { ...s.ui, diff: null, view: "commits" } }))
      await get().graphRef.current?.reset()
      await get().reresolveSelection()
      queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    },

    async runGitAction(action, opts) {
      const err = await action().then(() => null, describeError)
      if (!err) opts?.onSuccess?.()
      invalidateRepo(queryClient, repoId)
      await get().resetAndLoad()
      if (err) get().showOp(err, "danger")
    },

    async doCommit() {
      const { subject, description, amend } = get().commitDraft
      const subj = subject.trim()
      const body = description.trim()
      try {
        await api.commit(body ? `${subj}\n\n${body}` : subj, amend)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      set(() => ({ commitDraft: { subject: "", description: "", amend: false } }))
      draftBackup = null
      invalidateRepo(queryClient, repoId)
      await get().resetAndLoad()
    },

    runStash(action, name) {
      return get().runGitAction(() => api.stash(action, name), {
        onSuccess: () => {
          if (action === "push") set((s) => ({ commitDraft: { ...s.commitDraft, subject: "" } }))
        },
      })
    },

    runBranch(action, name) {
      return get().runGitAction(() => api.branch(action, name))
    },

    checkout(name) {
      return get().runGitAction(() => api.checkout(name))
    },

    async runWt(act, paths) {
      try {
        await act(api, paths)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    },
  }))
}

const RepoStoreContext = createContext<StoreApi<RepoStoreState> | null>(null)

export function RepoProvider({ repoId, api, children }: { repoId: number; api: RepoApi; children: ReactNode }) {
  /* créé une fois par onglet monté : App garde les onglets visités montés (keep-mounted), le
     store suit la même durée de vie que RepoView pour ce dépôt. */
  const store = useRef<StoreApi<RepoStoreState> | null>(null)
  store.current ??= createRepoStore(repoId, api)
  return <RepoStoreContext.Provider value={store.current}>{children}</RepoStoreContext.Provider>
}

/** Accès à l'instance de store (pour `.getState()`/`.setState()` impératifs — abonnements aux
    événements git, callbacks du graphe). Préférer `useRepoStore(selector)` dans le rendu. */
export function useRepoStoreApi(): StoreApi<RepoStoreState> {
  const store = useContext(RepoStoreContext)
  if (!store) throw new Error("useRepoStoreApi doit être utilisé sous <RepoProvider>")
  return store
}

export function useRepoStore<T>(selector: (s: RepoStoreState) => T): T {
  return useStore(useRepoStoreApi(), selector)
}

/** Abonnements aux événements git du dépôt (`git:changed`, `git:op`) — un seul endroit qui
    traduit le pousser du main en invalidations de requêtes et en actions du store, plutôt que
    de vivre en ligne dans le layout de RepoView. */
export function useRepoEvents(): void {
  const store = useRepoStoreApi()
  const repoId = useRepoStore((s) => s.repoId)
  const queryClient = useQueryClient()

  /* Les refs ont bougé hors de l'application : commit, rebase ou checkout depuis un terminal.
     Main ne prévient qu'au premier plan et se tait après nos propres commandes. */
  useEffect(
    () =>
      onChanged((p) => {
        if (p.id !== repoId) return
        invalidateRepo(queryClient, repoId)
        void store.getState().resetAndLoad()
      }),
    [repoId, queryClient, store]
  )

  /* --- Opérations git : le clic lance, mais tout le retour passe par onOp (l'auto-fetch du
     process main émet sans avoir d'appelant côté renderer). --- */
  useEffect(
    () =>
      onOp(async (p) => {
        if (p.id !== repoId) return
        const s = store.getState()
        s.setBusyOp(p.state === "start" ? p.op : null)
        if (p.state === "start") return
        if (p.state === "error") {
          queryClient.invalidateQueries({ queryKey: queryKeys.status(repoId) })
          return s.showOp(describePayload(p), "danger")
        }
        invalidateRepo(queryClient, repoId)
        if (p.op === "pull") {
          await s.resetAndLoad()
        } else if (p.added > 0) {
          const suffix = p.added > 1 ? "s" : ""
          /* le graphe n'est pas rechargé d'office : ça perdrait le scroll et la sélection */
          s.showOp(`${p.added} nouveau${suffix} commit${suffix}`, "primary", {
            label: "Recharger",
            run: () => {
              s.clearOp()
              void s.resetAndLoad()
            },
          })
        }
      }),
    [repoId, queryClient, store]
  )
}
