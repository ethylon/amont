/* Layout state, pure (AUDIT.md §6/§10): zero DOM, zero pixel, zero CSS — runnable under Node
   as-is (that's the whole point of the decomposition, cf. layout/*.test.ts). Persists for
   the entire history, in compact form: integer ids (cf. ../ids.ts) rather than 40-character
   SHAs, and text (refs, parsed merges) only for the rows that carry them. The
   commits themselves live in an evictable page cache (cf. ../data/page-cache.ts). */

import type { ParsedMerge } from "../../../lib/commit-parse.ts"
import type { FlowKind } from "../../../lib/gitflow.ts"
import { createIdTable, type HashId, type IdTable } from "../ids.ts"

export type Edge = {
  r1: number
  l1: number
  travel: number
  k: number
  r2?: number
  l2?: number
  /** stash edge: drawn dashed — a suspended snapshot, not history */
  dash?: boolean
}
export type GraphNode = { row: number; lane: number; merge: boolean; cap?: FlowKind; stash?: boolean }

export type LayoutState = {
  ids: IdTable
  lanes: (string | null)[]
  meta: number[]
  pending: Map<string, Edge[]>
  /** bumped by `layoutChunk` whenever `pending` actually mutates — the dangling-edge
      overlay (cf. ../render/overlay.ts) keys its rebuild on it, so a scroll tick that
      laid out nothing new doesn't reserialize a group that hasn't changed */
  pendingGen: number
  next: number
  /** hash id -> row; also covers a capsule's absorbed hash */
  rowOf: Map<HashId, number>
  /** row -> hash id of the surviving hash */
  hashOf: HashId[]
  /** lazy chunks: `nodes[ci]`/`edges[ci]` only exist once reached — a repo that
      grows between the initial `total()` estimate and actual pagination no longer
      crashes on `.push()` against a never-allocated slot (AUDIT.md §6, perf item). */
  nodes: GraphNode[][]
  edges: Edge[][]
  long: Edge[]
  ms: number
  /** lane of each row */
  laneOf: number[]
  /** first-parent edge leaving each row */
  fpEdge: Edge[]
  /** row -> row of its first-parent, absent until it's laid out */
  fpRow: number[]
  /** parent row -> rows of the children it is the first-parent of */
  fpChildren: Map<number, number[]>
  /** row of the absorbed tip -> row of the absorbing merge */
  mergedBy: Map<number, number>
  /** raw `%D` refs, decorated rows only */
  refsOf: Map<number, string>
  /** parsed merge subject, merge rows only; a GitHub PR puts its source branch here */
  mergeOf: Map<number, ParsedMerge>
  /** memoized `chainTip` per row (cf. ./chains.ts): a row's climb only reads data frozen
      at its own layout time (refs, fpChildren, lanes of rows above it — git log emits
      parents after all their children), so an entry stays valid for the whole life of this
      state. Dies with the state: a rebuild goes through `createState`, never a clear. */
  tipOf: Map<number, number>
}

export function createState(): LayoutState {
  return {
    ids: createIdTable(),
    lanes: [],
    meta: [],
    pending: new Map(),
    pendingGen: 0,
    next: 0,
    rowOf: new Map(),
    hashOf: [],
    nodes: [],
    edges: [],
    long: [],
    ms: 0,
    laneOf: [],
    fpEdge: [],
    fpRow: [],
    fpChildren: new Map(),
    mergedBy: new Map(),
    refsOf: new Map(),
    mergeOf: new Map(),
    tipOf: new Map(),
  }
}

/** Chunk slot, allocated on demand (cf. comment on `nodes`/`edges` above). */
export function chunkOf<T>(chunks: T[][], ci: number): T[] {
  return (chunks[ci] ??= [])
}
