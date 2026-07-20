/* Merge-cascade dry-run (release composition, cf. features/flow/release-create-dialog):
   predicts what merging each branch — in order — into `base` would do, without ever touching
   the worktree, the index or a ref.

   Each step runs `git merge-tree --write-tree` (git ≥ 2.38): a real merge of the two commits'
   trees, written to the object database alone. A clean step is folded into the cascade through
   `git commit-tree` — a synthetic, unreferenced commit carrying the merged tree, so the next
   branch is previewed on top of the ones before it, exactly like the queue will merge them.
   A conflicted branch is left OUT of the cascade (the rest is previewed as if it were
   skipped): its conflicted tree would poison every prediction after it, and at merge time
   the user resolves it by hand anyway. The synthetic commits stay unreachable and are swept
   by any future gc.

   No repo lock: nothing here mutates refs, index or worktree — concurrent with an autofetch
   or a user mutation, the object writes are safe (git's odb handles concurrent writers). */

import { AppError } from "../../shared/errors.ts"
import type { MergePreview } from "../../shared/types.ts"
import type { RepoHandle } from "../repos.ts"
import { captureGitError } from "../telemetry.ts"
import { BRANCH, parseMergeTree } from "./parse.ts"

/** The modal never shows more than a handful — no need to ship a pathological conflict list. */
const FILES_CAP = 50
/** Bound the request (and the git spawns it costs) to something a human actually selected. */
const BRANCHES_CAP = 100

const shaOf = (r: RepoHandle, ref: string): Promise<string | null> =>
  r.git(["rev-parse", "--verify", "-q", ref]).then(
    (o) => o.trim() || null,
    () => null
  )

const isAncestor = (r: RepoHandle, a: string, b: string): Promise<boolean> =>
  r.git(["merge-base", "--is-ancestor", a, b]).then(
    () => true,
    () => false
  )

export async function mergePreview(r: RepoHandle, base: string, branches: string[]): Promise<MergePreview[]> {
  if (typeof base !== "string" || !BRANCH.test(base)) throw new AppError("BAD_ARG", "base")
  const valid = (a: unknown): a is string[] =>
    Array.isArray(a) && a.length <= BRANCHES_CAP && a.every((b) => typeof b === "string" && BRANCH.test(b))
  if (!valid(branches)) throw new AppError("BAD_ARG", "branches")

  const start = await shaOf(r, `refs/heads/${base}`)
  if (!start) throw new AppError("BAD_ARG", base)
  /** tip of the simulated cascade: the base, then each clean merge's synthetic commit */
  let cur: string = start

  const out: MergePreview[] = []
  for (const branch of branches) {
    const sha = await shaOf(r, `refs/heads/${branch}`)
    if (!sha) {
      out.push({ branch, status: "unknown", files: [] })
      continue
    }
    if (await isAncestor(r, sha, cur)) {
      out.push({ branch, status: "merged", files: [] })
      continue
    }
    /* exit 0 = clean, exit 1 = conflicts — both print the result; anything else (an older
       git without --write-tree, a corrupt object) degrades to "unknown" for this branch —
       silently for the user, hence the telemetry: a git too old for the feature would
       otherwise never be heard of */
    const merged = await r
      .git(["merge-tree", "--write-tree", "--no-messages", "--name-only", cur, sha], { okCodes: [1] })
      .then(parseMergeTree, (e) => {
        captureGitError("merge-preview", e)
        return null
      })
    if (!merged?.tree) {
      out.push({ branch, status: "unknown", files: [] })
      continue
    }
    if (merged.files.length) {
      out.push({ branch, status: "conflicts", files: merged.files.slice(0, FILES_CAP) })
      continue
    }
    /* fold the clean merge into the cascade: a synthetic commit over the merged tree */
    cur = (await r.git(["commit-tree", merged.tree, "-p", cur, "-p", sha, "-m", "amont merge preview"])).trim()
    out.push({ branch, status: "clean", files: [] })
  }
  return out
}
