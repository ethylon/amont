/* État de layout, pur (AUDIT.md §6/§10) : zéro DOM, zéro pixel, zéro CSS — exécutable sous Node
   tel quel (c'est toute la raison d'être de la décomposition, cf. layout/*.test.ts). Persiste pour
   tout l'historique, sous forme compacte : ids entiers (cf. ../ids.ts) plutôt que des SHA de 40
   caractères, et les textes (refs, merges parsés) seulement pour les lignes qui en portent. Les
   commits eux-mêmes vivent dans un cache de pages évincable (cf. ../data/page-cache.ts). */

import type { ParsedMerge } from "../../../lib/commit-parse.ts"
import type { FlowKind } from "../../../lib/gitflow.ts"
import { createIdTable, type HashId, type IdTable } from "../ids.ts"

export type Edge = {
  r1: number; l1: number; travel: number; k: number; r2?: number; l2?: number
  /** arête de stash : tracée en pointillés — un instantané suspendu, pas de l'historique */
  dash?: boolean
}
export type GraphNode = { row: number; lane: number; merge: boolean; cap?: FlowKind; stash?: boolean }

export type LayoutState = {
  ids: IdTable
  lanes: (string | null)[]
  meta: number[]
  pending: Map<string, Edge[]>
  next: number
  /** id de hash -> ligne ; couvre aussi le hash absorbé d'une capsule */
  rowOf: Map<HashId, number>
  /** ligne -> id de hash du hash survivant */
  hashOf: HashId[]
  /** chunks paresseux : `nodes[ci]`/`edges[ci]` n'existent qu'une fois atteints — un dépôt qui
      grandit entre l'estimation initiale de `total()` et la pagination réelle ne fait plus
      planter `.push()` sur un slot jamais alloué (AUDIT.md §6, item perf). */
  nodes: GraphNode[][]
  edges: Edge[][]
  long: Edge[]
  ms: number
  /** lane de chaque ligne */
  laneOf: number[]
  /** arête first-parent partant de chaque ligne */
  fpEdge: Edge[]
  /** ligne -> ligne de son first-parent, absent tant qu'il n'est pas mis en page */
  fpRow: number[]
  /** ligne parent -> lignes des enfants dont il est le first-parent */
  fpChildren: Map<number, number[]>
  /** ligne du tip absorbé -> ligne du merge absorbeur */
  mergedBy: Map<number, number>
  /** refs brutes `%D`, lignes décorées seulement */
  refsOf: Map<number, string>
  /** sujet de merge parsé, lignes de merge seulement ; une PR GitHub y met sa branche source */
  mergeOf: Map<number, ParsedMerge>
}

export function createState(): LayoutState {
  return {
    ids: createIdTable(),
    lanes: [], meta: [], pending: new Map(), next: 0,
    rowOf: new Map(),
    hashOf: [],
    nodes: [],
    edges: [],
    long: [], ms: 0,
    laneOf: [],
    fpEdge: [],
    fpRow: [],
    fpChildren: new Map(),
    mergedBy: new Map(),
    refsOf: new Map(),
    mergeOf: new Map(),
  }
}

/** Slot de chunk, alloué à la demande (cf. commentaire sur `nodes`/`edges` ci-dessus). */
export function chunkOf<T>(chunks: T[][], ci: number): T[] {
  return (chunks[ci] ??= [])
}
