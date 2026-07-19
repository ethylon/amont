import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react"

import { getGraphCols, GRAPH_COL_MAX, GRAPH_COL_MIN, GRAPH_COL_VAR, setGraphCol } from "@/lib/customization"
import { messages } from "@/lib/messages"
import { GRID_COLS, type GraphCol } from "../constants.ts"
import type { GraphHandle } from "../controller.ts"

/* One strip per resizable column: its track in the row grid (the overlay below mirrors
   `--amont-cols`, so the strips sit exactly on the boundaries the rows draw) and the edge
   that carries the strip — the left-side auto columns (branch, type) resize by their END
   edge, the right-side fixed columns by their START edge, so in both cases the dragged
   boundary follows the pointer. The metro and the subject have no strip: one is sized by
   the lanes, the other is the `1fr` that absorbs what the rest releases. */
const STRIPS: { col: GraphCol; track: number; edge: "start" | "end" }[] = [
  { col: "branch", track: 1, edge: "end" },
  { col: "type", track: 3, edge: "end" },
  { col: "author", track: 5, edge: "start" },
  { col: "date", track: 6, edge: "start" },
  { col: "hash", track: 7, edge: "start" },
]

const clamp = (px: number) => Math.round(Math.min(GRAPH_COL_MAX, Math.max(GRAPH_COL_MIN, px)))

/* Column-resize overlay of the commit graph (mounted inside `inner`, cf. commit-graph.tsx):
   drag a boundary to resize its column, double-click to go back to the default. The values
   persist in lib/customization (`graphCols`) — during the drag the live var is written
   directly and the graph re-measured per frame; the release commits the final width, and
   the customization listener path (commit-graph.tsx) covers changes coming from anywhere
   else. Mouse-only affordance (aria-hidden): the columns are presentation, and keyboard
   users keep the defaults every content cap was tuned for. */
export function ColResizers({ graph }: { graph: RefObject<GraphHandle | null> }) {
  function onPointerDown(ev: ReactPointerEvent<HTMLDivElement>, col: GraphCol, edge: "start" | "end") {
    if (ev.button !== 0) return
    ev.preventDefault()
    ev.stopPropagation()
    const el = ev.currentTarget
    el.setPointerCapture(ev.pointerId)
    el.dataset.dragging = ""
    const x0 = ev.clientX
    const dir = edge === "end" ? 1 : -1
    const base = getGraphCols()[col]
    const caps = col === "branch" || col === "type" // chip caps need the maxima re-measured
    let px = base
    let raf = 0
    const onMove = (e: PointerEvent) => {
      px = clamp(base + dir * (e.clientX - x0))
      /* live: the rows' grid tracks and the chips' max-width resolve this var directly */
      document.documentElement.style.setProperty(GRAPH_COL_VAR[col], px + "px")
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0
          graph.current?.remeasure(caps)
        })
      }
    }
    const onUp = () => {
      delete el.dataset.dragging
      el.removeEventListener("pointermove", onMove)
      el.removeEventListener("pointerup", onUp)
      el.removeEventListener("pointercancel", onUp)
      if (raf) cancelAnimationFrame(raf)
      /* persists AND re-applies the var (or clears it back to the fallback when the drag
         landed on the default) — the commit's listener re-measures one last time */
      setGraphCol(col, px)
    }
    el.addEventListener("pointermove", onMove)
    el.addEventListener("pointerup", onUp)
    el.addEventListener("pointercancel", onUp)
  }

  return (
    /* Mirrors the row grid — same template through the same vars — to lay each strip on its
       boundary at any scroll depth (`inset-0` of `inner`: full history height). Cells are
       `overflow-hidden` so a collapsed column (no refs, prefix column off → 0px track) takes
       its strip away with it rather than leaving a dead grip on the wrong boundary. */
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-1 grid grid-cols-(--amont-cols)"
      style={{ "--amont-cols": GRID_COLS } as CSSProperties}
    >
      {STRIPS.map(({ col, track, edge }) => (
        <div key={col} className="relative min-w-0 overflow-hidden" style={{ gridColumn: track, gridRow: 1 }}>
          <div
            title={messages.graph.resizeColumn}
            onPointerDown={(ev) => onPointerDown(ev, col, edge)}
            onDoubleClick={() => setGraphCol(col, null)}
            className={
              "pointer-events-auto absolute inset-y-0 w-1.5 cursor-col-resize " +
              "after:absolute after:inset-y-0 after:w-px after:bg-primary/60 after:opacity-0 " +
              "hover:after:opacity-100 data-dragging:after:opacity-100 " +
              (edge === "end" ? "right-0 after:right-0" : "left-0 after:left-0")
            }
          />
        </div>
      ))}
    </div>
  )
}
