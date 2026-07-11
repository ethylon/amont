/* Sélection et surbrillance de recherche (AUDIT.md §6/§8) : React possède la vérité (cf.
   features/repo/repo-store.tsx), ce module ne fait qu'appliquer `data-selected`/`aria-selected`/
   `data-match` sur les lignes montées — flux à sens unique, comme avant ce refactor (AUDIT.md §1,
   à préserver).

   `active` (roving tabindex, AUDIT.md §8) est une notion distincte de `selection` : c'est la
   dernière ligne touchée, souris ou clavier, celle qui porte `tabindex=0` — les autres restent à
   `-1`. Un clic dans le vide vide `selection` (plus rien de surligné) mais laisse `active`
   inchangé : le curseur clavier ne doit pas disparaître pour autant, sinon Tab échouerait à
   ratrapper le graphe tant qu'aucune ligne n'est sélectionnée. */

export function createSelection(inner: HTMLDivElement) {
  let selection = new Set<number>()
  /** ids de hash (cf. ids.ts) des commits en surbrillance de recherche, `null` hors recherche */
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
      /* le "+N" d'une ligne (refGroup, pas le fantôme de survol qui reste toujours hors
         tabulation, cf. render/rows.ts) suit le même roving tabindex que sa ligne : sans ce
         second passage, il resterait figé sur le tabindex qu'il avait à son montage, périmé dès
         que la ligne active change sans que ce bucket ne remonte. */
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
    /** ligne du curseur clavier courant, `null` avant toute interaction (cf. `primeActive`) */
    get active(): number | null {
      return active
    },
    /** `activeRow` : ligne qui vient d'être touchée (clic, ctrl-clic, flèche…) — omis, `active`
        ne bouge pas (cf. en-tête). Passé explicitement par chaque appelant de repo-store.tsx qui
        sait quelle ligne vient d'agir ; les rappels redondants (effet React qui resynchronise
        `selection.rows` après coup) l'omettent et n'y touchent donc pas deux fois. */
    setSelection(rows: Iterable<number>, activeRow?: number) {
      selection = new Set(rows)
      if (activeRow !== undefined) active = activeRow
      applySelection()
    },
    /** amorce le curseur clavier sans toucher à la sélection — pour que Tab atteigne le graphe
        dès l'ouverture du dépôt, avant tout clic (cf. controller.ts `reset`). No-op si déjà amorcé
        ou si une sélection restaurée (`reresolveSelection`) l'a déjà posé. */
    primeActive(row: number) {
      if (active !== null) return
      active = row
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
