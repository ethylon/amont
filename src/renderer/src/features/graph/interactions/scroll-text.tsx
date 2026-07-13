/* Text too long for its box, without ellipsis: the `scroll-fade-x` fade (shadcn) signals
   overflow and follows the scroll position — sharp left edge at 0, sharp right edge at the end
   of the run. `overflow-hidden` keeps the box scrollable by script but neutralizes the wheel.
   On hover the text scrolls left at a fixed, linear speed, and loops without snapping back:
   a copy of the text takes over behind a constant gap, the scroll drops back to 0 at the
   seam — undetectable, since the two copies coincide there. */

import { cn } from "@/lib/utils"

const SPEED = 30 // px/s, independent of text length

/** container classes, shared between scrollText() and ScrollText */
export const SCROLL_TEXT_CLASS =
  "amont-scrolltext scroll-fade-x flex min-w-0 max-w-full gap-3 overflow-hidden whitespace-nowrap"

/* React twin of scrollText(). `selfHover: false` leaves the activation to an ancestor
   (a list row triggers the marquee for its whole surface, cf. FileRow) via
   scrollTextHover/scrollTextStop on its own mouse events. */
export function ScrollText({
  text,
  className,
  selfHover = true,
}: {
  text: string
  className?: string
  selfHover?: boolean
}) {
  return (
    <span
      className={cn(SCROLL_TEXT_CLASS, className)}
      onMouseEnter={selfHover ? (e) => scrollTextHover(e.currentTarget) : undefined}
      onMouseLeave={selfHover ? () => scrollTextStop() : undefined}
    >
      <span>{text}</span>
    </span>
  )
}

export function scrollText(text: string) {
  const el = document.createElement("span")
  el.className = SCROLL_TEXT_CLASS
  const copy = document.createElement("span")
  copy.textContent = text
  el.appendChild(copy)
  return el
}

/* Only one text scrolls at a time — the one under the cursor. */
let current: HTMLElement | null = null
let dup: HTMLElement | null = null
let raf = 0

export function scrollTextStop() {
  if (!current) return
  cancelAnimationFrame(raf)
  dup?.remove()
  dup = null
  current.scrollLeft = 0
  current = null
}

export function scrollTextHover(el: HTMLElement | null) {
  if (el === current) return
  scrollTextStop()
  if (!el || el.scrollWidth <= el.clientWidth) return
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const first = el.firstElementChild as HTMLElement
  /* length of one loop: the text plus the gap, measured before adding the copy */
  const cycle = first.getBoundingClientRect().width + (parseFloat(getComputedStyle(el).columnGap) || 0)
  dup = first.cloneNode(true) as HTMLElement
  dup.setAttribute("aria-hidden", "true")
  el.appendChild(dup)
  current = el
  /* position as a local float: `scrollLeft` rounds to the physical pixel and would lose the accumulation */
  let pos = 0
  let last = performance.now()
  const step = (now: number) => {
    /* element unmounted without a mouseleave (graph reset, tab switch): without this
       early exit, the rAF loop would run indefinitely on a detached node */
    if (!el.isConnected) return scrollTextStop()
    pos = (pos + ((now - last) / 1000) * SPEED) % cycle
    last = now
    el.scrollLeft = pos
    raf = requestAnimationFrame(step)
  }
  raf = requestAnimationFrame(step)
}
