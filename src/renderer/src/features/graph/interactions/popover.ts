/* Panneau flottant « +N » (AUDIT.md §6) : ouverture au survol, fermeture différée pour franchir
   le vide entre le bouton et le panneau — le survol du panneau, arrivé dans l'intervalle, annule
   la fermeture. Déplie soit les refs cachées d'une ligne, soit les chips fantômes d'un tip
   partagé (`data-ghost`, posé par render/rows.ts `ghostChips`). */

import type { Commit } from "../../../../../shared/types.ts"
import { parseRefs } from "@/lib/commit-parse"
import { MORE_CLASS } from "../constants.ts"
import { ghostChip, refChip } from "../render/rows.ts"

const CLOSE_DELAY = 120

export function createPopover(board: HTMLDivElement, inner: HTMLDivElement, commitAt: (row: number) => Commit | undefined) {
  const el = document.createElement("div")
  el.className = MORE_CLASS
  inner.appendChild(el)
  let openBtn: HTMLElement | null = null
  let timer = 0

  function closeMore() {
    if (!openBtn) return
    openBtn.setAttribute("aria-expanded", "false")
    openBtn = null
    el.classList.replace("flex", "hidden")
  }

  const cancelClose = () => clearTimeout(timer)
  const scheduleClose = () => {
    clearTimeout(timer)
    timer = window.setTimeout(closeMore, CLOSE_DELAY)
  }

  function openMore(btn: HTMLElement) {
    closeMore()
    const row = btn.closest<HTMLElement>(".gg-row")!
    if (btn.dataset.ghost !== undefined) {
      /* "+N" fantôme : les autres branches du tip, en chips fantômes — pas des refs de la ligne */
      el.replaceChildren(...btn.dataset.ghost.split("\n").map((n) => ghostChip(n, "", "max-w-full")))
    } else {
      const c = commitAt(Number(row.dataset.i))
      if (!c) return // la ligne est montée donc résidente ; pure défense
      const refs = parseRefs(c.r).slice(Number(btn.dataset.n))
      const flow = (row.dataset.flow as Parameters<typeof refChip>[2]) || null
      el.replaceChildren(...refs.map((r) => refChip(r, "max-w-full", flow)))
    }
    /* le panneau flotte sous `inner`, pas sous la ligne : la teinte de lane ne peut pas hériter */
    el.style.setProperty("--badge-color", row.style.getPropertyValue("--badge-color"))

    const b = btn.getBoundingClientRect()
    const box = inner.getBoundingClientRect() // se déplace avec le scroll, comme `more`
    el.style.left = b.left - box.left + "px"
    el.style.top = b.bottom - box.top + 4 + "px"
    el.classList.replace("hidden", "flex")
    /* mesuré une fois visible : un "+N" près du bord droit rabat le panneau dans la zone visible
       du board au lieu d'étendre son scroll horizontal */
    const maxLeft = board.scrollLeft + board.clientWidth - el.offsetWidth - 4
    if (b.left - box.left > maxLeft) el.style.left = Math.max(0, maxLeft) + "px"
    btn.setAttribute("aria-expanded", "true")
    openBtn = btn
  }

  return {
    el,
    openMore,
    closeMore,
    cancelClose,
    scheduleClose,
    get openBtn(): HTMLElement | null {
      return openBtn
    },
    destroy() {
      clearTimeout(timer)
      el.remove()
    },
  }
}

export type PopoverController = ReturnType<typeof createPopover>
