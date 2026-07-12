/* Width of the branch and type columns (AUDIT.md §6): an `auto` track would size itself row
   by row (each row is its own grid) — columns would no longer line up. So we measure,
   once per distinct string, in an off-flow ruler — batched writes then batched
   reads, a single reflow. Maxima only ever grow: neither pagination nor
   scrolling ever moves a column. */

import type { Commit } from "../../../../../shared/types.ts"
import { parseRefs, parseSubject, type RefChip } from "@/lib/commit-parse"
import { badgeVariants } from "@/components/ui/badge"
import { BRANCH_BUDGET, BRANCH_MAX, GAP, TYPE_MAX } from "../constants.ts"
import { refGroup } from "./rows.ts"

/** signature of a branch cell: two commits rendering the same chips have the same width */
const cellSig = (refs: RefChip[]) => refs.map((r) => r.kind + r.name + (r.remotes.length ? "~" : "")).join(",")

export function createMeasurer(inner: HTMLDivElement) {
  const ruler = document.createElement("div")
  ruler.className = "invisible absolute top-0 left-0 flex"
  const seenType = new Set<string>()
  const seenCell = new Set<string>()
  let typeW = 0
  let cellW = 0 // auto width of the branch column: the widest rendered cell
  /* measurement queues, consumed by measureCols; the distinct sources persist (small:
     unique types and decorated cells) so we can re-measure once the real font arrives —
     commit pages, on the other hand, may have been evicted in the meantime */
  let queueTypes: string[] = []
  let queueCells: RefChip[][] = []
  let queueStash: string[] = []
  const allTypes: string[] = []
  const allCells: string[] = [] // raw refs of the distinct cells, re-parsed on re-measurement

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

  /** Feeds the measurement queues with what the page brings that's new (types, cells). */
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

  /** The stash chip occupies the branch column without going through refs: without this queue,
      a repo with short branch names would clip it. Called on reset, once entry names are known. */
  function queueStashNames(names: string[]) {
    for (const name of names) {
      if (seenCell.has(name)) continue
      seenCell.add(name)
      queueStash.push(name)
    }
  }

  /** Sets `--amont-type` on `inner` and returns the `type`/`branch` widths — it's up to the controller
      to push `branch` to `cb.onBranchWidth` and to sum both for `inner.style.minWidth`. */
  function measureCols(): { type: number; branch: number } {
    if (queueTypes.length) {
      typeW = Math.max(typeW, widest(queueTypes, TYPE_MAX))
      queueTypes = []
    }
    if (queueStash.length) {
      cellW = Math.max(cellW, widest(queueStash, BRANCH_MAX))
      queueStash = []
    }
    /* The branch column is auto-width: we measure the actual cell (real chips + "+N", ghost
       included), not a sum of independent maxima that would inflate it. One signature per
       distinct cell is enough — same chips, same width. */
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
    const branch = cellW && cellW + 2 * GAP // cell's px-2.5
    inner.style.setProperty("--amont-type", type + "px")
    return { type, branch }
  }

  /* Chips are measured against the actual font. As long as Geist hasn't replaced the fallback,
     widths are wrong: a single re-run, from the persisted sources, is enough. */
  function requeueAll(stashNames: string[]) {
    typeW = cellW = 0
    queueTypes = [...allTypes]
    queueCells = allCells.map(parseRefs)
    queueStash = [...new Set(stashNames)]
  }

  /** Clears every measured maximum and its source. The maxima are monotone *within* a repo
      (a column never jumps around on scroll or pagination), but they must not survive a
      rebuild: after a checkout or `branch -d`, a column should give back the width a since-gone
      decoration was holding rather than keep the historical maximum forever. */
  function reset() {
    seenType.clear()
    seenCell.clear()
    typeW = cellW = 0
    queueTypes = []
    queueCells = []
    queueStash = []
    allTypes.length = 0
    allCells.length = 0
  }

  return { scanPage, queueStashNames, measureCols, requeueAll, reset }
}

export type Measurer = ReturnType<typeof createMeasurer>
