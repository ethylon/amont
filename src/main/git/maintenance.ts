/* Database maintenance (Repository menu): a read of the object DB's shape (`count-objects`), and
   the two long-running housekeeping commands — `fsck --full` (integrity) and `gc` (repack). Both
   mutations take the per-repo mutex and stream their `NN%` progress to the renderer footer via
   the runner's `onProgress` hook (cf. git/exec.ts). The pure `count-objects` parser lives in
   parse.ts, unit-tested there. */

import type { CountObjects } from "../../shared/types.ts"
import { withLock, type RepoHandle } from "../repos.ts"
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

/** `git gc`: repack loose objects and prune. Mutating; footer progress. */
export const gc = (r: RepoHandle): Promise<void> =>
  withLock(r, "gc", () =>
    r
      .git(["gc", "--progress"], {
        timeout: MAINT_TIMEOUT,
        onProgress: (percent) => r.events.progress({ op: "gc", percent }),
      })
      .then(() => {})
  )
