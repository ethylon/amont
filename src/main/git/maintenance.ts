/* Database maintenance (Repository menu): a read of the object DB's shape (`count-objects`), and
   the two long-running housekeeping commands — `fsck --full` (integrity) and `gc` (repack +
   orphaned-pack cleanup, cf. packs.ts). Both mutations take the per-repo mutex; fsck streams its
   `NN%` progress to the renderer footer via the runner's `onProgress` hook (cf. git/exec.ts).
   The pure `count-objects` parser lives in parse.ts, unit-tested there. */

import { join } from "node:path"

import type { CountObjects } from "../../shared/types.ts"
import { withLock, type RepoHandle } from "../repos.ts"
import { sweepOrphanedPacks } from "./packs.ts"
import { parseCountObjects } from "./parse.ts"

/** fsck/gc on a large repo can run for a while — well past the read timeout, but not forever:
    a finite ceiling still guards against a genuinely stuck process. */
const MAINT_TIMEOUT = 15 * 60_000

/** Shape of the object database, from `git count-objects -vH`. A plain read, no mutex. */
export const countObjects = (r: RepoHandle): Promise<CountObjects> =>
  r.git(["count-objects", "-vH"]).then(parseCountObjects)

/** `git fsck --full`: verify object connectivity/integrity. Read-only for the repo, but it holds
    the mutex so it can't race a concurrent mutation, and it reports progress to the footer. */
export const fsck = (r: RepoHandle): Promise<void> =>
  withLock(r, "fsck", () =>
    r
      .git(["fsck", "--full", "--progress"], {
        timeout: MAINT_TIMEOUT,
        onProgress: (percent) => r.events.progress({ op: "fsck", percent }),
      })
      .then(() => {})
  )

/** "Compact database": `git gc` (repack loose objects and prune), then the orphaned-pack sweep
    gc never performs — recover or delete each `.pack` without its `.idx` (cf. packs.ts) — with a
    final gc to absorb/prune the objects a recovered pack brought back. The sweep belongs to
    Compact only; Verify (fsck) stays read-only. Mutating. Unlike fsck, gc rejects `--progress`
    (usage error, exit 129) and its subcommands emit nothing without a TTY, so the footer shows
    the indeterminate spinner (percent: null). */
export const gc = (r: RepoHandle): Promise<void> =>
  withLock(r, "gc", async () => {
    await r.git(["gc"], { timeout: MAINT_TIMEOUT })
    const recovered = await sweepOrphanedPacks({
      packDir: join(r.gitDir, "objects", "pack"),
      git: r.git,
      timeout: MAINT_TIMEOUT,
      log: (text) => r.events.trace({ kind: "out", text }),
    })
    if (recovered) await r.git(["gc"], { timeout: MAINT_TIMEOUT })
    /* re-check: the sweep should have brought `garbage` to 0 (the renderer refetches the stats
       when gc resolves) — a leftover means something new to diagnose, so leave a trace of it */
    const after = await countObjects(r)
    if (after.garbage > 0) r.events.trace({ kind: "out", text: `garbage files remain after compaction: ${after.garbage}` })
  })
