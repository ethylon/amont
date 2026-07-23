/* Selection actions. Keyed by commit HASH (not by row index) — the additive/subtractive
   ctrl-click invariant lives in `toggleAdditive`, a single place for both commits
   (`selectRow`) and refs (`focusRef`). After a graph reset, `reload` re-resolves rows via
   `reresolveSelection`: the selection survives pull/checkout/stash as long as the commits
   still exist, rather than being cleared outright. */

import type { GraphHandle } from "@/features/graph/controller"

import type { ActionCtx, RepoStoreState } from "../repo-store"

/** Ctrl-click: toggles a set of items at once — removes if the first is already in,
    adds otherwise. Same invariant for commit rows (`selectRow`) and branch
    segments (`focusRef`): a single place decides "remove" vs "add". */
function toggleAdditive<T>(set: Set<T>, items: T[]): boolean {
  const removing = items.length > 0 && set.has(items[0])
  for (const it of items) removing ? set.delete(it) : set.add(it)
  return removing
}

const keyOfRow = (g: GraphHandle, row: number): string | null => {
  const b = g.branchesOf(row)[0]
  return b ? `${b.kind}:${b.name}` : null
}

/* Selection updates are the hottest store writes (one per commit click): reuse the previous
   Set/array when the contents haven't actually changed, so selector-based subscribers
   (RefsSidebar on `focusedKeys`, RepoView on `rows`) and downstream memos see a stable
   reference instead of re-rendering on every click of an already-selected commit. */
const sameSet = (prev: Set<string>, next: Set<string>): Set<string> =>
  prev.size === next.size && [...next].every((k) => prev.has(k)) ? prev : next
const sameArr = <T>(prev: T[], next: T[]): T[] =>
  prev.length === next.length && next.every((v, i) => prev[i] === v) ? prev : next

type SelectionActions = Pick<
  RepoStoreState,
  | "selectRow"
  | "selectBranch"
  | "focusRef"
  | "focusStash"
  | "focusWorktree"
  | "clearFocus"
  | "reresolveSelection"
  | "showWorktree"
>

export function createSelectionActions({ set, get }: ActionCtx): SelectionActions {
  /* Every selection write goes through here: one `set` that also mirrors the result to the
     canvas. The mirror used to be a `g.setSelection(...)` tail call copy-pasted at the end
     of each action — one forgotten call away from a stale highlight, with no error anywhere
     (architecture audit, §I.4). `active`: the row that just acted (click, ctrl-click,
     arrow…) — the keyboard cursor (roving tabindex, AUDIT.md §8) follows it, whether or not
     it ends up sorted at the head of `rows`. Omitted, the cursor doesn't move. */
  const applySelection = (mut: (s: RepoStoreState) => Partial<RepoStoreState>, active?: number): void => {
    set(mut)
    get().graphRef.current?.setSelection(get().selection.rows, active)
  }

  return {
    selectRow(row, additive) {
      const g = get().graphRef.current
      if (!g) return
      const c = g.commit(row)
      if (!c) return
      const key = keyOfRow(g, row)
      applySelection((s) => {
        /* the click clears any open diff/conflict and returns to commits; reuse `ui`
           untouched when it's already there — a new object would wake `s.ui` subscribers */
        const ui =
          s.ui.view === "commits" && !s.ui.diff && !s.ui.conflict && !s.ui.fileHistory
            ? s.ui
            : { ...s.ui, view: "commits" as const, diff: null, conflict: null, fileHistory: null }
        if (!additive) {
          return {
            selection: {
              hashes: sameArr(s.selection.hashes, [c.h]),
              rows: sameArr(s.selection.rows, [row]),
              mode: "multi",
              focusedKeys: sameSet(s.selection.focusedKeys, new Set(key ? [key] : [])),
            },
            ui,
          }
        }
        const hashes = new Set(s.selection.hashes)
        const rows = new Set(s.selection.rows)
        const removing = toggleAdditive(rows, [row])
        removing ? hashes.delete(c.h) : hashes.add(c.h)
        const focusedKeys = new Set(s.selection.focusedKeys)
        if (key) removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        return {
          selection: {
            hashes: [...hashes],
            rows: [...rows].sort((a, b) => a - b),
            mode: "multi",
            focusedKeys: sameSet(s.selection.focusedKeys, focusedKeys),
          },
          ui,
        }
      }, row)
    },

    async selectBranch(row) {
      const g = get().graphRef.current
      if (!g) return
      const picked = await g.commitsOf(g.branchSegment(row).sort((a, b) => a - b))
      const key = keyOfRow(g, row)
      applySelection(
        (s) => ({
          selection: {
            hashes: picked.map((p) => p.commit.h),
            rows: picked.map((p) => p.row),
            mode: "branch",
            focusedKeys: sameSet(s.selection.focusedKeys, new Set(key ? [key] : [])),
          },
          ui: { ...s.ui, view: "commits", diff: null, conflict: null, fileHistory: null },
        }),
        row
      )
    },

    async focusRef(r, additive) {
      const g = get().graphRef.current
      if (!g) return
      const key = `${r.kind}:${r.name}`
      const removing = additive && get().selection.focusedKeys.has(key)
      /* `select: false` — center the tip without letting the jump select it: reveal()'s built-in
         non-additive select would wipe the current multi-selection before the additive branch
         below extends it (a Ctrl-click on a second branch dropped the first). focusRef sets the
         selection itself, right below. */
      if (!removing) await g.jumpTo(r.tip, false)
      const row = (await g.rowsOf([r.tip]))[0]
      if (row === undefined) return
      const seg = r.kind === "tag" ? [row] : g.branchSegment(row)

      if (!additive) {
        const picked = await g.commitsOf([...seg].sort((a, b) => a - b))
        applySelection(
          (s) => ({
            selection: {
              hashes: picked.map((p) => p.commit.h),
              rows: picked.map((p) => p.row),
              mode: r.kind === "tag" ? "multi" : "branch",
              focusedKeys: sameSet(s.selection.focusedKeys, new Set([key])),
            },
            ui: { ...s.ui, view: "commits", diff: null, conflict: null, fileHistory: null },
          }),
          row
        )
        return
      }

      /* additive: merge the segment into the current rows BEFORE reading the commits — the
         previous selection's pages may have left residency, `commitsOf` brings them all back */
      const rows = new Set(get().selection.rows)
      for (const x of seg) removing ? rows.delete(x) : rows.add(x)
      const picked = await g.commitsOf([...rows].sort((a, b) => a - b))
      applySelection((s) => {
        const focusedKeys = new Set(s.selection.focusedKeys)
        removing ? focusedKeys.delete(key) : focusedKeys.add(key)
        return {
          selection: {
            hashes: picked.map((p) => p.commit.h),
            rows: picked.map((p) => p.row),
            mode: "multi",
            focusedKeys,
          },
          ui: { ...s.ui, view: "commits", diff: null, conflict: null, fileHistory: null },
        }
      }, row)
    },

    async focusStash(s) {
      await get().graphRef.current?.jumpTo(s.h)
    },

    async focusWorktree(w) {
      await get().graphRef.current?.jumpTo(w.head)
    },

    clearFocus() {
      applySelection((s) => ({
        selection: {
          hashes: sameArr(s.selection.hashes, []),
          rows: sameArr(s.selection.rows, []),
          mode: s.selection.mode,
          focusedKeys: sameSet(s.selection.focusedKeys, new Set()),
        },
        ui: { ...s.ui, diff: null, conflict: null, fileHistory: null },
      }))
    },

    async reresolveSelection() {
      const g = get().graphRef.current
      const { hashes, rows: prevRows } = get().selection
      if (!g || !hashes.length) {
        set((s) => ({ selection: { ...s.selection, rows: [] } }))
        return
      }
      /* bounded re-resolution (refresh audit, §6): the selection lived around `prevRows`
         before the reset — search there (plus generous slack for commits pulled in on top),
         not the whole history. Without the cap, amending a selected commit made `rowsOf`
         page in the entire repo chasing a hash that no longer exists. rows are kept sorted
         ascending, so the last element is the max (a spread over a branch-sized selection
         would blow the argument limit). */
      const bound = (prevRows.length ? prevRows[prevRows.length - 1] : 0) + 10_000
      const picked = await g.commitsOf([...(await g.rowsOf(hashes, bound))].sort((a, b) => a - b))
      const rows = picked.map((p) => p.row)
      /* partial resolution (bound hit, page failure): keep the original hash list — the
         missing commits may still exist beyond the search bound and the next reload retries;
         only a complete resolution rewrites it (shedding duplicates the graph folded).
         `active: rows[0]` reclaims the keyboard cursor (AUDIT.md §8): without it, the
         selection restored after a pull/checkout/stash would stay displayed while the cursor
         — primed on row 0 by controller.ts `reset()` just before — would point elsewhere. */
      applySelection(
        (s) => ({
          selection: {
            ...s.selection,
            rows,
            hashes: rows.length === hashes.length ? picked.map((p) => p.commit.h) : s.selection.hashes,
          },
        }),
        rows[0]
      )
    },

    showWorktree() {
      applySelection((s) => ({
        selection: { ...s.selection, rows: [], hashes: [] },
        ui: { ...s.ui, diff: null, conflict: null, fileHistory: null, view: "wt" },
      }))
    },
  }
}
