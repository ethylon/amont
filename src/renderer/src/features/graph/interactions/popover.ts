/* Floating "+N" panel (AUDIT.md §6/§8): opens on hover OR on click/keyboard (the button
   is a real <button>, Enter/Space natively trigger the same `click` on it — no separate
   keyboard code is needed for opening). Closing is delayed to bridge the gap
   between the button and the panel on hover — hovering the panel, arriving within that gap,
   cancels the close. Unfolds either a row's hidden refs, or the ghost chips of a shared tip
   (`data-ghost`, set by render/rows.ts `ghostChips`).

   Considered porting to a Base UI primitive instead of hand-rolling this: evaluated and dropped
   (cf. PR) — this panel lives in the rows' imperative pipeline (render/rows.ts), outside the React
   tree; porting it would require duplicating chip rendering in JSX and moving the
   controller/React boundary, a bigger undertaking than this a11y pass. Instead: role/aria-label,
   focus placed inside on intentional opening (click/keyboard, not mouse hover) and returned to
   the trigger on close — only if focus was there (`el.contains(activeElement)`),
   otherwise a mouse scroll that closes the panel along the way wouldn't steal keyboard focus. */

import type { Commit } from "../../../../../shared/types.ts"
import { parseRefs } from "@/lib/commit-parse"
import { messages } from "@/lib/messages"
import { MORE_CLASS } from "../constants.ts"
import { ghostChip, refChip } from "../render/rows.ts"

const CLOSE_DELAY = 120

export function createPopover(board: HTMLDivElement, inner: HTMLDivElement, commitAt: (row: number) => Commit | undefined) {
  const el = document.createElement("div")
  el.className = MORE_CLASS
  el.setAttribute("role", "group")
  el.tabIndex = -1
  inner.appendChild(el)
  let openBtn: HTMLElement | null = null
  let timer = 0

  function closeMore() {
    if (!openBtn) return
    const btn = openBtn
    const returnFocus = el.contains(document.activeElement)
    btn.setAttribute("aria-expanded", "false")
    openBtn = null
    el.classList.replace("flex", "hidden")
    if (returnFocus) btn.focus()
  }

  const cancelClose = () => clearTimeout(timer)
  const scheduleClose = () => {
    clearTimeout(timer)
    timer = window.setTimeout(closeMore, CLOSE_DELAY)
  }

  /** `focus`: places focus inside the panel once open — reserved for intentional opening
      (click, Enter/Space on the button), never mouse hover (cf. header comment). */
  function openMore(btn: HTMLElement, opts?: { focus?: boolean }) {
    closeMore()
    const row = btn.closest<HTMLElement>(".amont-row")!
    if (btn.dataset.ghost !== undefined) {
      /* ghost "+N": the tip's other branches, as ghost chips — not the row's own refs */
      el.replaceChildren(...btn.dataset.ghost.split("\n").map((n) => ghostChip(n, "", "max-w-full")))
    } else {
      const c = commitAt(Number(row.dataset.i))
      if (!c) return // the row is mounted so it's resident; pure defensive check
      const refs = parseRefs(c.r).slice(Number(btn.dataset.n))
      const flow = (row.dataset.flow as Parameters<typeof refChip>[2]) || null
      el.replaceChildren(...refs.map((r) => refChip(r, "max-w-full", flow)))
    }
    /* the panel floats under `inner`, not under the row: lane hue can't be inherited */
    el.style.setProperty("--badge-color", row.style.getPropertyValue("--badge-color"))
    /* same text as the button that opens it (set by render/rows.ts): a screen reader landing
       in the panel hears what it's unfolding, not a mute "group". */
    el.setAttribute("aria-label", btn.getAttribute("aria-label") || messages.graph.extraRefs)

    const b = btn.getBoundingClientRect()
    const box = inner.getBoundingClientRect() // moves with scroll, like `more`
    el.style.left = b.left - box.left + "px"
    el.style.top = b.bottom - box.top + 4 + "px"
    el.classList.replace("hidden", "flex")
    /* measured once visible: a "+N" near the right edge folds the panel back into the board's
       visible area instead of extending its horizontal scroll */
    const maxLeft = board.scrollLeft + board.clientWidth - el.offsetWidth - 4
    if (b.left - box.left > maxLeft) el.style.left = Math.max(0, maxLeft) + "px"
    btn.setAttribute("aria-expanded", "true")
    openBtn = btn
    if (opts?.focus) el.focus()
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
