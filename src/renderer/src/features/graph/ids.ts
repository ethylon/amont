/* Interning des SHA (fix B1, AUDIT.md §2/§6) : le main transporte désormais des SHA complets
   (40 caractères) de bout en bout — plus de `parseInt(h.slice(0, 8), 16)` dont le paradoxe des
   anniversaires garantissait statistiquement des collisions passé quelques dizaines de milliers
   de commits (~25% à 50k, ~69% à 100k).

   Pour garder la compacité mémoire de l'ancien `hkey` (un entier plutôt qu'un string de 40
   caractères dans chaque Map/tableau de layout), ce module interne chaque SHA en un id entier
   séquentiel à l'ingestion — bijectif par construction (une Map, pas un hash tronqué). Toutes les
   fonctions PURES de layout/ prennent et rendent des `HashId`, jamais des strings de hash bruts ;
   seul l'ingestion (layout/lanes.ts) et l'affichage (React, cf. `shortHash`) traversent la
   frontière string <-> id. */

export type HashId = number

export interface IdTable {
  readonly toId: Map<string, HashId>
  /** id -> SHA complet, dans l'ordre d'interning */
  readonly toHash: string[]
}

export function createIdTable(): IdTable {
  return { toId: new Map(), toHash: [] }
}

/** Rend l'id du SHA, en l'internant s'il est nouveau. */
export function internId(t: IdTable, hash: string): HashId {
  let id = t.toId.get(hash)
  if (id === undefined) {
    id = t.toHash.length
    t.toHash.push(hash)
    t.toId.set(hash, id)
  }
  return id
}

/** Id d'un SHA déjà interné, `undefined` s'il est inconnu — ne crée jamais d'entrée. */
export function idOf(t: IdTable, hash: string): HashId | undefined {
  return t.toId.get(hash)
}

export function hashOfId(t: IdTable, id: HashId): string {
  return t.toHash[id]
}

/** Troncature d'affichage : la seule qui reste après le fix B1. L'identité du graphe (rowOf,
    pending, matches, jumpTo) voyage toujours en SHA complet ou en `HashId` — jamais sous cette
    forme raccourcie, purement cosmétique. */
export const shortHash = (hash: string): string => hash.slice(0, 8)
