/* Sélection et surbrillance de recherche (AUDIT.md §6) : React possède la vérité (cf.
   features/repo/repo-store.tsx), ce module ne fait qu'appliquer `data-selected`/`data-match` sur les
   lignes montées — flux à sens unique, comme avant ce refactor (AUDIT.md §1, à préserver). */

export function createSelection(inner: HTMLDivElement) {
  let selection = new Set<number>()
  /** ids de hash (cf. ids.ts) des commits en surbrillance de recherche, `null` hors recherche */
  let matches: Set<number> | null = null

  function applySelection() {
    inner.querySelectorAll<HTMLElement>(".gg-row").forEach((r) => {
      r.dataset.selected = String(selection.has(Number(r.dataset.i)))
    })
  }

  function applyMatches(hashOf: number[]) {
    inner.toggleAttribute("data-search", matches !== null)
    inner.querySelectorAll<HTMLElement>(".gg-row").forEach((r) => {
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
    setSelection(rows: Iterable<number>) {
      selection = new Set(rows)
      applySelection()
    },
    setMatches(ids: number[] | null, hashOf: number[]) {
      matches = ids && new Set(ids)
      applyMatches(hashOf)
    },
    /** ré-applique les attributs sur les lignes qui viennent d'être montées (nouveau chunk) */
    refresh(hashOf: number[]) {
      applySelection()
      applyMatches(hashOf)
    },
  }
}

export type SelectionController = ReturnType<typeof createSelection>
