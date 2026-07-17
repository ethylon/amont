/* Text too long for its box, without ellipsis: the `scroll-fade-x` fade (shadcn) signals
   overflow and follows the scroll position — sharp left edge at 0, sharp right edge at the end
   of the run. `overflow-hidden` keeps the box scrollable by script but neutralizes the wheel.
   On hover the text scrolls left at a fixed, linear speed, and loops without snapping back:
   a copy of the text takes over behind a constant gap, the scroll drops back to 0 at the
   seam — undetectable, since the two copies coincide there. */

import { useEffect, useRef } from "react"

import { cn } from "@/lib/utils"

const SPEED = 30 // px/s, independent of text length

/** fade width, mirroring the default of `scroll-fade-x` (shadcn) */
const FADE_SIZE = "min(12%, calc(var(--spacing) * 10))"

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
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!fadeObserver) return
    const el = ref.current!
    const child = el.firstElementChild!
    observeFade(el)
    return () => {
      fadeObserver.unobserve(el)
      fadeObserver.unobserve(child)
    }
  }, [])

  return (
    <span
      ref={ref}
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
  observeFade(el)
  return el
}

/* Only one text scrolls at a time — the one under the cursor. */
let current: HTMLElement | null = null
let dup: HTMLElement | null = null
let raf = 0

/* Without `animation-timeline: scroll()` (Firefox), the shadcn CSS falls back to a permanent
   static fade, even without overflow: the mask variables are driven inline instead, so the fade
   only shows on edges actually truncated. Chromium needs none of this — its scroll-timeline
   animation overrides the inline values whenever the box overflows, and without overflow the
   timeline is inactive and the same 0px applies — so the whole machinery is gated out there
   (and in tests, where ResizeObserver does not exist). Observed targets are weakly held per
   spec: recycled graph rows need no unobserve. */
const fadeObserver =
  typeof ResizeObserver !== "undefined" && !CSS.supports("animation-timeline: scroll()")
    ? new ResizeObserver((entries) => {
        for (const entry of entries) {
          const el = (entry.target as HTMLElement).closest<HTMLElement>(".amont-scrolltext")
          if (el) syncFade(el)
        }
      })
    : null

function syncFade(el: HTMLElement) {
  el.style.setProperty("--scroll-fade-s", el === current ? FADE_SIZE : "0px")
  el.style.setProperty("--scroll-fade-e", el.scrollWidth > el.clientWidth ? FADE_SIZE : "0px")
}

/* both the box and the text: either resizing can change the truncation */
function observeFade(el: HTMLElement) {
  fadeObserver?.observe(el)
  fadeObserver?.observe(el.firstElementChild as Element)
}

export function scrollTextStop() {
  if (!current) return
  cancelAnimationFrame(raf)
  dup?.remove()
  dup = null
  current.scrollLeft = 0
  const el = current
  current = null
  if (fadeObserver) syncFade(el)
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
  if (fadeObserver) syncFade(el)
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
