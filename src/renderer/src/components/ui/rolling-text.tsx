import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/** Kept in sync with the `amont-roll-*` animations (app.css): the outgoing line is dropped
    once its roll is done. A hair longer than the animation so it never cuts mid-frame. */
const ROLL_MS = 240

/** Single-line ticker: on a text change the current line rolls up and out while the next one
    rises from below, both clipped to one line so the host never changes height. The two lines
    are stacked in a single grid cell; only the transform moves, layout stays put. */
export function RollingText({ text, className }: { text: string; className?: string }) {
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
    <span className={cn("grid max-w-full grid-cols-1 overflow-hidden", className)}>
      {prev !== null && (
        <span key={`p-${seq}`} className="amont-roll-out col-start-1 row-start-1 min-w-0 truncate">
          {prev}
        </span>
      )}
      <span
        key={`c-${seq}`}
        className={cn("col-start-1 row-start-1 min-w-0 truncate", prev !== null && "amont-roll-in")}
      >
        {cur}
      </span>
    </span>
  )
}
