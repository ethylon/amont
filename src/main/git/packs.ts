/* Orphaned-pack cleanup, the second stage of "Compact database" (cf. maintenance.ts): `git gc`
   never deletes a `.pack` that lost its `.idx` (leftover of an interrupted fetch/clone/gc), so
   `count-objects` keeps reporting it as `garbage` and the "compacting recommended" hint never
   goes away. This module recovers what it can (`git index-pack` rebuilds the index, a final gc
   then absorbs or prunes the objects) and deletes what it can't (truncated/corrupt pack).

   No Electron import and no repos.ts import (whose chain pulls `electron`): the sweep takes its
   dependencies as plain values, so packs.test.ts can exercise it under Node against a real
   temporary repository. */

import { readdir, rm } from "node:fs/promises"
import { join } from "node:path"

import type { RunOpts } from "./exec.ts"

/** The `.pack` files of a pack-directory listing that have neither their `.idx` (orphans) nor a
    `.keep` (a kept pack is deliberately protected — leave it alone even without an index). The
    other companion extensions (`.rev`, `.bitmap`, `.mtimes`, `.promisor`) neither make a pack
    valid nor protect it: only `.idx` and `.keep` matter here. Valid pack/idx pairs are never
    returned. Sorted, so the sweep order (and the trace) is deterministic. */
export function orphanedPacks(files: string[]): string[] {
  const names = new Set(files)
  return files
    .filter((f) => f.endsWith(".pack"))
    .filter((f) => {
      const stem = f.slice(0, -".pack".length)
      return !names.has(stem + ".idx") && !names.has(stem + ".keep")
    })
    .sort()
}

export interface PackSweep {
  /** `<gitDir>/objects/pack` — absent (fresh repo without any pack) is a quiet no-op. */
  packDir: string
  git: (args: string[], opts?: RunOpts) => Promise<string>
  /** index-pack on a large orphan can be as slow as gc itself: same generous ceiling. */
  timeout: number
  /** one line per orphan handled (recovered vs deleted), for the console trace */
  log: (text: string) => void
}

/** Recover or delete every orphaned pack: `git index-pack` rebuilds the missing `.idx` when the
    pack is intact (its objects become readable again — the caller runs a final gc to absorb or
    prune them); a pack index-pack rejects is unrecoverable and is deleted. Returns the number
    of packs recovered, i.e. whether that final gc has anything to do. */
export async function sweepOrphanedPacks(s: PackSweep): Promise<number> {
  let files: string[]
  try {
    files = await readdir(s.packDir)
  } catch {
    return 0 // no pack directory: nothing to sweep
  }
  let recovered = 0
  for (const pack of orphanedPacks(files)) {
    try {
      await s.git(["index-pack", join(s.packDir, pack)], { timeout: s.timeout })
      recovered++
      s.log(`orphaned pack recovered: ${pack}`)
    } catch {
      await rm(join(s.packDir, pack), { force: true })
      s.log(`orphaned pack deleted (unrecoverable): ${pack}`)
    }
  }
  return recovered
}
