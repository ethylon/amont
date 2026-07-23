/* The console's bounded trace-line buffer, fed by the `git:trace` event stream and scoped
   to one repo. Owns the line keys and the rAF batching; the display logic (ordering,
   failure join) stays pure in trace-lines.ts. */

import { useCallback, useEffect, useRef, useState } from "react"

import { onTrace, type TraceLine } from "@/lib/git"

/* `key`: lines have no identity of their own on the main side; a local counter is enough for React. */
export type Entry = TraceLine & { key: number }

/* Bounded buffer: a debug console, not a log. Beyond that, the oldest lines drop. */
const CAP = 500

export function useTraceBuffer(repoId: number) {
  const [lines, setLines] = useState<Entry[]>([])
  const keyRef = useRef(0)

  /* Traced lines are batched behind a rAF (perf audit, finding 23): a chatty command (fetch
     progress, fsck) streams dozens of lines per frame, and one setState per line meant as
     many re-renders of the whole status bar. The buffer flushes once per frame; the 500-line
     cap applies at flush like before. */
  const pendingRef = useRef<Entry[]>([])
  const rafRef = useRef(0)
  useEffect(() => {
    const unsub = onTrace((p) => {
      if (p.id !== repoId) return
      pendingRef.current.push({ ...p, key: keyRef.current++ })
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        const batch = pendingRef.current
        pendingRef.current = []
        setLines((prev) => {
          const next = [...prev, ...batch]
          return next.length > CAP ? next.slice(next.length - CAP) : next
        })
      })
    })
    return () => {
      unsub()
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
      pendingRef.current = []
    }
  }, [repoId])

  const clear = useCallback(() => {
    /* also drop the un-flushed batch: resetting the key counter with old-keyed entries
       still buffered could otherwise hand two lines the same React key later on */
    cancelAnimationFrame(rafRef.current)
    rafRef.current = 0
    pendingRef.current = []
    setLines([])
    keyRef.current = 0
  }, [])

  return { lines, clear }
}
