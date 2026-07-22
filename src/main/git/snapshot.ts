/* The repo's two "did anything move?" reads, side by side because their DIFFERENCE is
   load-bearing (architecture audit, §I.2):

   - `refTips` answers "did history move" — object ids only, deduplicated and sorted. It
     feeds the fetch/pull/push result (`ops.ts runOp`: `changed`, the "N new commits"
     badge), where a branch rename or a new name on an existing tip is not news. Much
     cheaper than the full `rev-list --all --count` we used to pay for twice per fetch.

   - `refSnapshot` answers "did anything the UI shows move" — `refname␀objectname` pairs,
     names included. It feeds the graph fingerprint (`queries.ts computeSnapshot`, which
     adds HEAD and the stash list), where `git branch foo` on an existing tip, a rename, or
     switching HEAD between two branches parked on the same commit MUST register even
     though no object id moved — a tips-only key would silence those forever.

   `refTips` must never be "simplified" to reuse the fingerprint (it would report a rename
   as fetched commits), and the fingerprint must never reuse the dedup (it would go blind
   to name-only changes). snapshot.test.ts pins both directions. Same three namespaces for
   both, one place to extend when a new ref kind becomes UI-relevant. */

/** The one slice of RepoHandle these reads need — keeps the module (and its test) free of
    the registry, like watcher.ts' Watchable. */
export interface RefReader {
  git(args: string[]): Promise<string>
}

const REF_NAMESPACES = ["refs/heads", "refs/remotes", "refs/tags"]

/** Tips of all refs, deduplicated and sorted: two equal snapshots = nothing moved. */
export const refTips = (r: RefReader): Promise<string[]> =>
  r
    .git(["for-each-ref", "--format=%(objectname)", ...REF_NAMESPACES])
    .then((o) => [...new Set(o.split("\n").filter(Boolean))].sort())

/** Every ref as `refname␀objectname`, verbatim: two equal snapshots = nothing the ref
    lists display has moved, names included. */
export const refSnapshot = (r: RefReader): Promise<string> =>
  r.git(["for-each-ref", "--format=%(refname)%00%(objectname)", ...REF_NAMESPACES]).then((o) => o.trim())
