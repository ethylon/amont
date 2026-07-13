/* Repository healthcheck: a pure verdict over `git count-objects -vH`, surfaced in the status
   bar as a gentle "compacting recommended" hint. The thresholds mirror git's own `gc --auto`
   defaults so the suggestion appears exactly when git would repack on its own — loose objects
   past `gc.auto`, packs past `gc.autoPackLimit`, or any unreferenced/prunable cruft lying around. */

import type { CountObjects } from "@/lib/git"

/** `gc.auto` default: the loose-object count above which `git gc --auto` repacks. */
export const GC_LOOSE_LIMIT = 6700
/** `gc.autoPackLimit` default: the pack count above which `git gc --auto` consolidates packs. */
export const GC_PACK_LIMIT = 50

export type HealthReason = "loose" | "packs" | "garbage"

export type RepoHealth = {
  needsCompaction: boolean
  /** the dominant signal, for an optional detail; `null` when healthy */
  reason: HealthReason | null
}

export function repoHealth(c: CountObjects): RepoHealth {
  const reason: HealthReason | null =
    c.count >= GC_LOOSE_LIMIT
      ? "loose"
      : c.packs >= GC_PACK_LIMIT
        ? "packs"
        : c.garbage > 0 || c.prunePackable > 0
          ? "garbage"
          : null
  return { needsCompaction: reason !== null, reason }
}
