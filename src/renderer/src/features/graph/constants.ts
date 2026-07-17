/* Graph engine constants (AUDIT.md §6/§10, "decomposition" item): geometry, virtualization
   budgets and column widths in a single place. Before this module, `FIXED_W` and the
   grid-template of `ROW_CLASS` (graph-canvas.ts) re-summed the same widths by hand in
   two separate expressions, liable to silently drift from one another — they now derive
   from the same named constants. */

export const ROW = 28
export const LANE = 14
export const PAD = 10
export const R = 4

/** Mount/unmount bucket for the SVG (one `<g>` per chunk, cf. render/svg.ts) AND granularity of
    `layoutChunk` (layout progresses in batches of this size). The two uses deliberately share
    the same constant: a layout batch corresponds to a render chunk. */
export const CHUNK = 500

/** Size of one `api.log` page (data/loader.ts). */
export const PAGE = 1000

/** Resident window of the commit page cache (data/page-cache.ts): beyond this, the least
    recently touched pages get evicted — except pages under the viewport or under the selection. */
export const RESIDENT = 12

/** Number of distinct hues defined in app.css (`--lane-0`..`--lane-9`): beyond this,
    `laneColor` wraps around — two simultaneous branches at rank 10 and 11 then share the hue
    of ranks 0 and 1. */
export const LANES = 10

/* Cap on the metro column: past this, deep lanes get clipped by the SVG viewport rather than
   pushing the subject out of view. Known mismatch with `LANES` (10): lanes 10 and 11 are drawn but
   recycle a hue already used further left; extending the palette (`--lane-10`/`--lane-11`) is a
   designer's call that's out of scope here (AUDIT.md §6 flags it as a constants-debt note, not a
   visual bug to fix in this pass) — left as is. */
export const MAX_LANES = 12

/* Hues live in :root / .dark (cf. app.css): a var() in an SVG presentation attribute
   follows the theme without going through a Tailwind utility. */
export const laneColor = (i: number) => `var(--lane-${i % LANES})`

/** column gutter, `pe-2.5` or empty end-of-lane space */
export const GAP = 10
export const TYPE_MAX = "max-w-28"
/** branch name cap: 96px, beyond which it scrolls on hover */
export const BRANCH_MAX = "max-w-24"
/* Fixed budget of 1: the column is one chip wide, showing two would require measuring every row
   instead of just counting. Refs are sorted branch → tag (cf. parseRefs), so `slice(0, 1)`
   correctly keeps the higher-priority branch name. */
export const BRANCH_BUDGET = 1

/* --- Fixed column widths: a single source for both the grid-template AND FIXED_W ---
   Before: `FIXED_W` re-summed the same pixels as the literal `grid-cols-[...]` by hand. A
   column change (addition, width) could only drift from one without the other. */
/** offset of the graph column under the SVG (`calc(var(--graphw,0px)+Npx)`) */
export const COL_GRAPH_GUTTER = 12
/** assumed minimum width of the subject column (`1fr`, not fixed — only used to estimate
    the row's total minimum width for `inner.style.minWidth`) */
export const COL_SUBJECT_MIN = 320
export const COL_AUTHOR = 130
export const COL_DATE = 84
export const COL_HASH = 68
/** `pr-4.5` (Tailwind, 4.5 × 4px): end-of-row margin */
export const ROW_PADDING_END = 18

export const FIXED_W = COL_GRAPH_GUTTER + COL_SUBJECT_MIN + COL_AUTHOR + COL_DATE + COL_HASH + ROW_PADDING_END

/* The branch column sits left of the metro: it merges the former branch chips (which used
   to precede the subject) and the tags column. Branch name takes priority; overflow branches
   and tags fall behind a "+N". It and the type column size themselves on loaded content
   (cf. render/measure.ts) and collapse to 0 when the repo has nothing to put there. The graph
   column is a spacer reserving `--graphw` under the SVG, offset by the branch column's width. */
/* The grid-template derives from the same constants but lives in a CSS variable (`--amont-cols`, set
   by rowDiv) rather than in the class: `grid-cols-[…${COL}px…]` built by interpolation
   isn't a literal the Tailwind scanner can see — it never emitted it and the row
   fell back to a single column (everything crammed to the left). `grid-cols-(--amont-cols)` is a
   static class, so it gets emitted; the interpolated value flows through the var. The spaces around
   the calc's `+` are mandatory — `calc(a+b)` is invalid. */
export const GRID_COLS = `var(--amont-branch,0px) calc(var(--graphw,0px) + ${COL_GRAPH_GUTTER}px) var(--amont-type,0px) 1fr ${COL_AUTHOR}px ${COL_DATE}px ${COL_HASH}px`

export const ROW_CLASS =
  "amont-row grid h-7 cursor-pointer grid-cols-(--amont-cols) " +
  "items-center border-l-2 border-l-transparent pr-4.5 text-xs hover:bg-muted/60 " +
  "focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:-ring-offset-2 focus-visible:ring-ring/30 " +
  "data-selected:border-l-primary data-selected:bg-primary/20 data-selected:hover:bg-primary/25"

/** Project's floating surface (cf. `dialog`, `command`). Height-bounded: a heavily
    decorated commit (dozens of tags) scrolls within the panel instead of overflowing the window. */
export const MORE_CLASS =
  "amont-more absolute z-20 hidden max-h-[min(50vh,20rem)] w-max max-w-72 flex-col items-start gap-1 overflow-y-auto " +
  /* imperative DOM (render/rows.ts pipeline): the shadcn ScrollArea can't wrap it — the
     standard scrollbar properties keep its native bar thin and themed in both engines */
  "[scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] " +
  "rounded-xl bg-popover p-2 text-popover-foreground shadow-lg ring-1 ring-foreground/10"

/* --- Decoupled virtualization windows ---
   The SVG (nodes/short edges) mounts in whole chunks (CHUNK rows): a chunk's geometry
   is cheap and its mount/unmount follows `layoutChunk`. HTML ROWS (chips, avatars,
   scrolling text), on the other hand, are expensive per row — mounting them in whole chunks meant
   rendering up to 3 × CHUNK rows for ~30 visible ones (~50x overdraw, AUDIT.md §6). They therefore
   mount in a finer bucket, sized on the actual viewport rather than on CHUNK. */
/** HTML row mount granularity — ten times finer than the SVG bucket */
export const ROW_BUCKET = CHUNK / 10

/** Overlay bucketing (long + dangling edges, render/overlay.ts): deliberately coarse — a
    long edge touches at most a few buckets even if it spans the entire history, which
    avoids copying it into hundreds of fine buckets while still letting `sync()` mount
    only the buckets that intersect the viewport (no more O(n²/PAGE) rebuild of the whole overlay
    on every page received, AUDIT.md §6). */
export const OVERLAY_BUCKET = CHUNK * 10
