/* SHA interning (fix B1, AUDIT.md §2/§6): the main process now carries full SHAs
   (40 characters) end to end — no more `parseInt(h.slice(0, 8), 16)`, whose birthday
   paradox statistically guaranteed collisions past a few tens of thousands
   of commits (~25% at 50k, ~69% at 100k).

   To keep the memory compactness of the old `hkey` (an integer rather than a 40-character
   string in every layout Map/array), this module interns each SHA into a sequential
   integer id at ingestion time — bijective by construction (a Map, not a truncated hash). All
   PURE functions in layout/ take and return `HashId`s, never raw hash strings;
   only ingestion (layout/lanes.ts) and display (React, cf. `shortHash`) cross the
   string <-> id boundary. */

export type HashId = number

export interface IdTable {
  readonly toId: Map<string, HashId>
  /** id -> full SHA, in interning order */
  readonly toHash: string[]
}

export function createIdTable(): IdTable {
  return { toId: new Map(), toHash: [] }
}

/** Returns the SHA's id, interning it if it's new. */
export function internId(t: IdTable, hash: string): HashId {
  let id = t.toId.get(hash)
  if (id === undefined) {
    id = t.toHash.length
    t.toHash.push(hash)
    t.toId.set(hash, id)
  }
  return id
}

/** Id of an already-interned SHA, `undefined` if unknown — never creates an entry. */
export function idOf(t: IdTable, hash: string): HashId | undefined {
  return t.toId.get(hash)
}

export function hashOfId(t: IdTable, id: HashId): string {
  return t.toHash[id]
}

/** Display truncation: the only one left after fix B1. The graph's identity (rowOf,
    pending, matches, jumpTo) always travels as a full SHA or `HashId` — never in this
    shortened, purely cosmetic form. */
export const shortHash = (hash: string): string => hash.slice(0, 8)
