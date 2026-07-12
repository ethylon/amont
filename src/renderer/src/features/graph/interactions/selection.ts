/* Selection and search highlighting (AUDIT.md §6/§8): React owns the truth (cf.
   features/repo/repo-store.tsx), this module only applies `data-selected`/`aria-selected`/
   `data-match` on mounted rows — one-way flow, same as before this refactor (AUDIT.md §1,
   preserve it).

   `active` (roving tabindex, AUDIT.md §8) is a notion distinct from `selection`: it's the
   last row touched, by mouse or keyboard, the one carrying `tabindex=0` — the others stay at
   `-1`. A click on empty space clears `selection` (nothing highlighted anymore) but leaves `active`
   unchanged: the keyboard cursor shouldn't disappear because of that, otherwise Tab would fail to
   catch back up to the graph as long as no row is selected. */

export function createSelection(inner: HTMLDivElement) {
  let selection = new Set<number>()
  /** hash ids (cf. ids.ts) of commits in search highlighting, `null` outside of search */
  let matches: Set<number> | null = null
  let active: number | null = null

  function applySelection() {
    inner.querySelectorAll<HTMLElement>(".amont-row").forEach((r) => {
      const i = Number(r.dataset.i)
      const sel = selection.has(i)
      const isActive = i === active
      r.dataset.selected = String(sel)
      r.setAttribute("aria-selected", String(sel))
      r.tabIndex = isActive ? 0 : -1
      /* a row's "+N" (refGroup, not the hover ghost which always stays outside
         tab order, cf. render/rows.ts) follows the same roving tabindex as its row: without this
         second pass, it would stay frozen on the tabindex it had at mount, stale as soon
         as the active row changes without that bucket remounting. */
      const more = r.querySelector<HTMLElement>(".amont-more-btn:not([data-ghost])")
      if (more) more.tabIndex = isActive ? 0 : -1
    })
  }

  function applyMatches(hashOf: number[]) {
    inner.toggleAttribute("data-search", matches !== null)
    inner.querySelectorAll<HTMLElement>(".amont-row").forEach((r) => {
      if (matches) r.dataset.match = String(matches.has(hashOf[Number(r.dataset.i)]))
      else delete r.dataset.match
    })
  }

  return {
    get selection(): ReadonlySet<number> {
      return selection
    },
    get matches(): ReadonlySet<number> | null {
      return matches
    },
    /** current keyboard cursor row, `null` before any interaction (cf. `primeActive`) */
    get active(): number | null {
      return active
    },
    /** `activeRow`: row that just got touched (click, ctrl-click, arrow…) — if omitted, `active`
        doesn't move (cf. header comment). Passed explicitly by every repo-store.tsx caller that
        knows which row just acted; redundant call sites (a React effect that resyncs
        `selection.rows` afterward) omit it and thus don't touch it twice. */
    setSelection(rows: Iterable<number>, activeRow?: number) {
      selection = new Set(rows)
      if (activeRow !== undefined) active = activeRow
      applySelection()
    },
    /** primes the keyboard cursor without touching the selection — so Tab reaches the graph
        as soon as the repo opens, before any click (cf. controller.ts `reset`). No-op if already
        primed or if a restored selection (`reresolveSelection`) already set it. */
    primeActive(row: number) {
      if (active !== null) return
      active = row
      applySelection()
    },
    setMatches(ids: number[] | null, hashOf: number[]) {
      matches = ids && new Set(ids)
      applyMatches(hashOf)
    },
  }
}

export type SelectionController = ReturnType<typeof createSelection>
