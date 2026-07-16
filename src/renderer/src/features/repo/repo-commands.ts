/* The one-way channel from the application menu (assembled in App, outside any repo) to the
   foreground repository's own surfaces (modals, inline banner, footer progress — all mounted
   inside RepoView). App holds no repo `api`; it only *dispatches* a command, and the active
   RepoView executes it through its store/api. `nonce` makes an identical command re-fire (two
   "Verify database" in a row), `repoId` lets a mounted-but-background tab ignore what isn't its. */

import type { BranchFlow } from "@/lib/gitflow"

/** Long-running database maintenance run through the git object DB. */
export type MaintOp = "fsck" | "gc"

export type RepoCommand =
  | { type: "flowInit" }
  | { type: "flowStart"; kind: BranchFlow; base?: string }
  | { type: "flowFinish"; name: string }
  | { type: "flowPublish"; kind: BranchFlow; name: string }
  | { type: "stats" }
  | { type: "maint"; op: MaintOp }

/** A command addressed to one repo, carrying a monotonic nonce so React effects fire once per send. */
export type RepoCommandEnvelope = { repoId: number; command: RepoCommand; nonce: number }
