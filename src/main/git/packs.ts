/* Pack-directory garbage cleanup, the second stage of "Compact database" (cf. maintenance.ts):
   `git gc` leaves behind everything `count-objects` reports as `garbage` — a `.pack` that lost
   its `.idx` (interrupted fetch/clone/gc), companion files stranded by a vanished pack, and
   recent `tmp_*` transfer temporaries (prune only expires them after `gc.pruneExpire`, two
   weeks) — so the "compacting recommended" hint would come right back after a compact. This
   module recovers what it can (`git index-pack` rebuilds a missing index, a final gc then
   absorbs or prunes the objects) and deletes what git will never clean up on its own. Files it
   doesn't recognize are left alone, like git does: the caller traces any remaining garbage.

   No Electron import and no repos.ts import (whose chain pulls `electron`): the sweep takes its
   dependencies as plain values, so packs.test.ts can exercise it under Node against a real
   temporary repository. */

import { readdir, rm, stat } from "node:fs/promises"
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

const COMPANIONS = [".idx", ".rev", ".mtimes", ".bitmap", ".promisor", ".keep"]

/** The companion files (`pack-*.idx`, `.rev`, `.mtimes`, `.bitmap`, `.promisor`, `.keep`) whose
    `.pack` is gone — stranded by a deleted or never-completed pack, and reported as garbage by
    `count-objects` forever after. `multi-pack-index*` never matches: it has no `.pack` stem by
    design. Sorted, for a deterministic sweep order. */
export function orphanedCompanions(files: string[]): string[] {
  const names = new Set(files)
  return files
    .filter((f) => f.startsWith("pack-") && COMPANIONS.some((ext) => f.endsWith(ext)))
    .filter((f) => !names.has(f.slice(0, f.lastIndexOf(".")) + ".pack"))
    .sort()
}

/** The `tmp_*` working files of a transfer (`tmp_pack_*`, `tmp_idx_*`, …), left behind when a
    fetch/clone/repack dies. Age-gated at the sweep: a live transfer touches its temporary
    continuously, so only a stale one is a leftover. Sorted. */
export function transferTemporaries(files: string[]): string[] {
  return files.filter((f) => f.startsWith("tmp_")).sort()
}

/** A `tmp_*` untouched for this long belongs to a dead transfer: even a stalled-but-alive fetch
    writes (and touches) its temporary far more often than hourly. */
export const TMP_GRACE_MS = 60 * 60_000

export interface PackSweep {
  /** `<gitDir>/objects/pack` — absent (fresh repo without any pack) is a quiet no-op. */
  packDir: string
  git: (args: string[], opts?: RunOpts) => Promise<string>
  /** index-pack on a large orphan can be as slow as gc itself: same generous ceiling. */
  timeout: number
  /** one line per orphan handled (recovered vs deleted), for the console trace */
  log: (text: string) => void
  /** index-pack rejected an orphan, which is about to be deleted: tolerated but destructive,
      the caller reports it to telemetry (cf. maintenance.ts). Injected so this module keeps
      importing nothing Electron-bound (packs.test.ts runs it under plain Node). */
  onUnrecoverable?: (err: unknown) => void
}

/** Recover or delete every orphaned pack — `git index-pack` rebuilds the missing `.idx` when
    the pack is intact (its objects become readable again — the caller runs a final gc to absorb
    or prune them); a pack index-pack rejects is unrecoverable and is deleted — then delete the
    stranded companions and the stale transfer temporaries gc never cleans. Returns the number
    of packs recovered, i.e. whether that final gc has anything to do. */
export async function sweepPackGarbage(s: PackSweep): Promise<number> {
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
    } catch (e) {
      s.onUnrecoverable?.(e)
      await rm(join(s.packDir, pack), { force: true })
      s.log(`orphaned pack deleted (unrecoverable): ${pack}`)
    }
  }
  /* re-list: a deleted orphan strands its companions, a recovered one regained its .idx */
  try {
    files = await readdir(s.packDir)
  } catch {
    return recovered
  }
  for (const f of orphanedCompanions(files)) {
    await rm(join(s.packDir, f), { force: true })
    s.log(`stranded pack file deleted: ${f}`)
  }
  for (const f of transferTemporaries(files)) {
    try {
      if (Date.now() - (await stat(join(s.packDir, f))).mtimeMs < TMP_GRACE_MS) {
        s.log(`transfer temporary kept (may be live): ${f}`)
        continue
      }
      await rm(join(s.packDir, f), { force: true })
      s.log(`stale transfer temporary deleted: ${f}`)
    } catch {
      /* vanished between readdir and stat: its owner is alive, leave it be */
    }
  }
  return recovered
}
