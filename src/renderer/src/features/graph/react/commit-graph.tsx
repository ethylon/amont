import { useEffect, useRef } from "react"

import type { RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { getCustomization, onCustomizationChange } from "@/lib/customization"
import { createGraph, type GraphCallbacks, type GraphHandle } from "../controller.ts"

/* Structural customization: the prefix column and the fonts change row layout / column widths, so
   a change here needs a full graph rebuild to re-measure. Colors are pure CSS vars and repaint on
   their own, so they're deliberately absent from this signature. */
const structuralSig = () => {
  const c = getCustomization()
  return `${c.showPrefixColumn}|${c.fontUi ?? ""}|${c.fontMono ?? ""}`
}

type Props = {
  api: RepoApi
  callbacks: GraphCallbacks
  /** called with the graph on mount, with `null` on unmount — a single channel instead of
      `graphRef`+`onReady` (AUDIT.md §7, phase 5, item 6): it's up to the caller to write `graph`
      into its own ref if it needs synchronous access outside of render. */
  onReady(graph: GraphHandle | null): void
}

/* React shell around the imperative controller (AUDIT.md §1, preserve as-is): it provides the
   three DOM nodes and the lifecycle, nothing else. Callbacks go through a ref so that a
   handler changing identity never remounts the graph. */
export function CommitGraph({ api, callbacks, onReady }: Props) {
  const board = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)

  const cb = useRef(callbacks)
  cb.current = callbacks
  const ready = useRef(onReady)
  ready.current = onReady

  useEffect(() => {
    const graph = createGraph(board.current!, inner.current!, svg.current!, api, {
      onSelect: (r, a) => cb.current.onSelect(r, a),
      onBranchSelect: (r) => cb.current.onBranchSelect(r),
      onStats: (s) => cb.current.onStats(s),
      onGraphWidth: (px) => cb.current.onGraphWidth(px),
      onBranchWidth: (px) => cb.current.onBranchWidth(px),
      onError: (message) => cb.current.onError(message),
      onWorktreeOpen: (path) => cb.current.onWorktreeOpen(path),
    })
    ready.current(graph)
    /* Rebuild on a structural customization change (prefix column / fonts) — same channel a
       checkout uses. `reset()` clears the measurer, so column widths give back space too. */
    let sig = structuralSig()
    const offCustomization = onCustomizationChange(() => {
      const next = structuralSig()
      if (next === sig) return
      sig = next
      void graph.reset()
    })
    return () => {
      offCustomization()
      graph.destroy()
      ready.current(null)
    }
  }, [api])

  return (
    /* ARIA grid (AUDIT.md §8): "listbox" rather than "grid" — the navigation/selection unit
       is the entire row (not the cell), which "listbox"/"option" describes more faithfully;
       the audit left this choice open. Roving tabindex on rows (interactions/selection.ts),
       arrows/PageUp/Down/Home/End/Enter driven by board.ts (attached to `board`, cf. controller.ts).

       `select-none`: the graph is chrome, not a text surface. Its rows marquee-scroll on hover
       (interactions/scroll-text.ts) and a double-click selects the branch (controller.ts `onDblClick`),
       whose native side effect would otherwise leave a stray *text* selection sitting on the row.
       A committed selection here trips a Blink re-entrancy crash (Sentry AMONT-2): a hover hit-test
       recomputed mid-lifecycle runs LayoutSelection::Commit → FrameSelection::SelectionHasFocus →
       Document::UpdateStyleAndLayout, re-entering layout while tree mutations are forbidden
       (CHECK(StateAllowsTreeMutations()) → EXCEPTION_BREAKPOINT). Removing the selection removes the
       ingredient — commit text stays selectable/copyable in the detail panel (repo/detail-panel.tsx). */
    <div
      ref={board}
      role="listbox"
      aria-label={messages.graph.commits}
      aria-multiselectable="true"
      className="relative overflow-auto select-none"
    >
      <div ref={inner} className="relative">
        {/* offset by the branch column: the metro starts after it — decorative, commits
            are read from the HTML rows, not from this SVG trace */}
        <svg
          ref={svg}
          aria-hidden="true"
          className="amont-graph pointer-events-none absolute top-0 z-1"
          style={{ left: "var(--amont-branch, 0px)" }}
          xmlns="http://www.w3.org/2000/svg"
        />
      </div>
    </div>
  )
}
