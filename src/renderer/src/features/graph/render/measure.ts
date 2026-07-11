/* Largeur des colonnes branche et type (AUDIT.md §6) : une piste `auto` se dimensionnerait ligne
   par ligne (chaque ligne est sa propre grille) — les colonnes ne s'aligneraient plus. On mesure
   donc, une fois par chaîne distincte, dans une règle hors flux — écritures groupées puis
   lectures groupées, un seul reflow. Les maxima ne font que croître : ni la pagination ni le
   scroll ne déplacent une colonne. */

import type { Commit } from "../../../../../shared/types.ts"
import { parseRefs, parseSubject, type RefChip } from "@/lib/commit-parse"
import { badgeVariants } from "@/components/ui/badge"
import { BRANCH_BUDGET, BRANCH_MAX, GAP, TYPE_MAX } from "../constants.ts"
import { refGroup } from "./rows.ts"

/** signature d'une cellule branche : deux commits qui rendent les mêmes chips ont la même largeur */
const cellSig = (refs: RefChip[]) => refs.map((r) => r.kind + r.name + (r.remotes.length ? "~" : "")).join(",")

export function createMeasurer(inner: HTMLDivElement) {
  const ruler = document.createElement("div")
  ruler.className = "invisible absolute top-0 left-0 flex"
  const seenType = new Set<string>()
  const seenCell = new Set<string>()
  let typeW = 0
  let cellW = 0 // largeur auto de la colonne branche : la cellule rendue la plus large
  /* files de mesure, consommées par measureCols ; les sources distinctes persistent (petites :
     types et cellules décorées uniques) pour re-mesurer quand la police réelle arrive —
     les pages de commits, elles, ont pu être évincées entre-temps */
  let queueTypes: string[] = []
  let queueCells: RefChip[][] = []
  let queueStash: string[] = []
  const allTypes: string[] = []
  const allCells: string[] = [] // refs brutes des cellules distinctes, re-parsées à la re-mesure

  function widest(texts: string[], maxw: string) {
    ruler.replaceChildren(
      ...texts.map((t) => {
        const s = document.createElement("span")
        s.className = badgeVariants({ color: "neutral", shape: "squared" }) + " " + maxw
        s.textContent = t
        return s
      })
    )
    inner.appendChild(ruler)
    const w = Math.max(0, ...[...ruler.children].map((el) => (el as HTMLElement).offsetWidth))
    ruler.remove()
    return w
  }

  /** Alimente les files de mesure avec ce que la page apporte de nouveau (types, cellules). */
  function scanPage(commits: Commit[]) {
    for (const c of commits) {
      const label = parseSubject(c.s).label
      if (label && !seenType.has(label)) {
        seenType.add(label)
        queueTypes.push(label)
        allTypes.push(label)
      }
      if (!c.r) continue
      const refs = parseRefs(c.r)
      const sig = cellSig(refs)
      if (seenCell.has(sig)) continue
      seenCell.add(sig)
      queueCells.push(refs)
      allCells.push(c.r)
    }
  }

  /** Le chip de stash occupe la colonne branche sans passer par les refs : sans cette file, un
      dépôt aux branches courtes le rognerait. Appelée au reset, une fois les noms d'entrée connus. */
  function queueStashNames(names: string[]) {
    for (const name of names) {
      if (seenCell.has(name)) continue
      seenCell.add(name)
      queueStash.push(name)
    }
  }

  /** Pose `--gg-type` sur `inner` et rend les largeurs `type`/`branch` — au contrôleur de pousser
      `branch` vers `cb.onBranchWidth` et de sommer les deux pour `inner.style.minWidth`. */
  function measureCols(): { type: number; branch: number } {
    if (queueTypes.length) {
      typeW = Math.max(typeW, widest(queueTypes, TYPE_MAX))
      queueTypes = []
    }
    if (queueStash.length) {
      cellW = Math.max(cellW, widest(queueStash, BRANCH_MAX))
      queueStash = []
    }
    /* La colonne branche est en auto-width : on mesure la vraie cellule (chips réels + "+N", nuage
       compris), pas une somme de maxima indépendants qui la gonflerait. Une signature par cellule
       distincte suffit — mêmes chips, même largeur. */
    if (queueCells.length) {
      const cells = queueCells.map((refs) => {
        const cell = document.createElement("div")
        cell.className = "flex items-center gap-1.5"
        refGroup(refs, BRANCH_BUDGET, BRANCH_MAX, cell)
        return cell
      })
      ruler.replaceChildren(...cells)
      inner.appendChild(ruler)
      cellW = Math.max(cellW, ...cells.map((el) => el.offsetWidth))
      ruler.remove()
      queueCells = []
    }

    const type = typeW && typeW + GAP
    const branch = cellW && cellW + 2 * GAP // px-2.5 de la cellule
    inner.style.setProperty("--gg-type", type + "px")
    return { type, branch }
  }

  /* Les chips sont mesurés à la police réelle. Tant que Geist n'a pas remplacé le fallback,
     les largeurs sont fausses : une seule reprise, depuis les sources persistées, suffit. */
  function requeueAll(stashNames: string[]) {
    typeW = cellW = 0
    queueTypes = [...allTypes]
    queueCells = allCells.map(parseRefs)
    queueStash = [...new Set(stashNames)]
  }

  return { scanPage, queueStashNames, measureCols, requeueAll }
}

export type Measurer = ReturnType<typeof createMeasurer>
