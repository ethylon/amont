import { useEffect, useRef, useState, type ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Kept in sync with the `amont-roll-*` animations (app.css): the outgoing line is dropped
    once its roll is done. A hair longer than the animation so it never cuts mid-frame. */
const ROLL_MS = 240

/** Single-line ticker: on a text change the current line rolls up and out while the next one
    rises from below, both clipped to one line so the host never changes height. The two lines
    are stacked in a single grid cell; only the transform moves, layout stays put. While a roll
    is in flight (`data-rolling`), `amont-roll-fade` (app.css) masks the clip edges with a
    vertical fade so lines dissolve at the boundary instead of being sheared by the overflow.

    `shimmer`: shadcn's sweep while the host's operation runs. The class goes on the inner
    text-bearing span, not the container, and only while the line is settled — two reasons:
    Chromium drops `background-clip: text` for a subtree whenever a descendant animates a
    transform (the glyphs go fully invisible during a roll), and both effects drive the
    `animation` shorthand, so on one span the sweep would cancel the roll. A rolling line thus
    renders solid and the sweep resumes on settle; while commands stream fast, the roll itself
    is the busy signal. */
export function RollingText({ text, className, shimmer }: { text: string; className?: string; shimmer?: boolean }) {
  const [{ prev, cur, seq }, setState] = useState({ prev: null as string | null, cur: text, seq: 0 })
  const curRef = useRef(text)

  useEffect(() => {
    if (text === curRef.current) return
    const from = curRef.current
    curRef.current = text
    setState((s) => ({ prev: from, cur: text, seq: s.seq + 1 }))
  }, [text])

  useEffect(() => {
    if (prev === null) return
    const t = window.setTimeout(() => setState((s) => (s.seq === seq ? { ...s, prev: null } : s)), ROLL_MS)
    return () => window.clearTimeout(t)
  }, [prev, seq])

  return (
    <span
      data-rolling={prev !== null || undefined}
      className={cn("amont-roll-fade grid max-w-full grid-cols-1 overflow-hidden", className)}
    >
      {prev !== null && (
        <span key={`p-${seq}`} className="amont-roll-out col-start-1 row-start-1 min-w-0 truncate">
          {prev}
        </span>
      )}
      <span
        key={`c-${seq}`}
        className={cn(
          "col-start-1 row-start-1 min-w-0 truncate",
          prev !== null ? "amont-roll-in" : shimmer && "shimmer"
        )}
      >
        {cur}
      </span>
    </span>
  )
}

/** Content variant of the ticker: same roll, swapping whole rows of markup when `swapKey`
    changes (the flow banner rolling between its info row and the finish confirmation). The
    outgoing row is a snapshot of what the previous key last rendered; a key that keeps
    re-rendering only refreshes in place, without rolling. */
export function RollingSwap({
  swapKey,
  className,
  children,
}: {
  swapKey: string
  className?: string
  children: ReactNode
}) {
  const [{ prev, seq }, setState] = useState({ prev: null as ReactNode, seq: 0 })
  const shown = useRef({ key: swapKey, node: children })

  useEffect(() => {
    if (swapKey === shown.current.key) {
      shown.current.node = children
      return
    }
    const from = shown.current.node
    shown.current = { key: swapKey, node: children }
    setState((s) => ({ prev: from, seq: s.seq + 1 }))
  }, [swapKey, children])

  useEffect(() => {
    if (prev === null) return
    const t = window.setTimeout(() => setState((s) => (s.seq === seq ? { ...s, prev: null } : s)), ROLL_MS)
    return () => window.clearTimeout(t)
  }, [prev, seq])

  return (
    <div
      data-rolling={prev !== null || undefined}
      className={cn("amont-roll-fade grid grid-cols-1 overflow-hidden", className)}
    >
      {prev !== null && (
        <div key={`p-${seq}`} className="amont-roll-out col-start-1 row-start-1 min-w-0">
          {prev}
        </div>
      )}
      <div key={`c-${seq}`} className={cn("col-start-1 row-start-1 min-w-0", prev !== null && "amont-roll-in")}>
        {children}
      </div>
    </div>
  )
}
