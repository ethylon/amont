/* Local/remote divergence (pure, zero DOM): which rows are ahead of the upstream (to push)
   and which only exist on it (to pull). Everything is read from the layout state — `refsOf`
   places HEAD and its remote-tracking ref, `fpRow` gives the first-parent chain — no extra
   git query. Accepted limit: the walk follows first-parent only; the subtree brought in by
   the second parent of an unpushed merge is not marked. */

import type { LayoutState } from "./state.ts"

export type SyncInfo = {
  branch: string
  /** full remote-tracking name (`origin/develop`) */
  upstream: string
  headRow: number
  upstreamRow: number
  /** rows reachable from HEAD but not from the upstream: to push */
  ahead: Set<number>
  /** rows reachable from the upstream but not from HEAD: to pull */
  behind: Set<number>
}

/* Past this, give up: a divergence of thousands of commits is no longer a lag worth
   visualizing, and the walk would start to weigh on every recompute. */
const CAP = 5000

/** Row decorated `HEAD -> refs/heads/x`, or null (detached HEAD, empty repo). */
function findHead(S: LayoutState): { branch: string; row: number } | null {
  for (const [row, refs] of S.refsOf) {
    const m = /(?:^|, )HEAD -> refs\/heads\/([^,]+)/.exec(refs)
    if (m) return { branch: m[1], row }
  }
  return null
}

/** Row of `branch`'s remote-tracking ref — origin first, else the first remote found. */
function findUpstream(S: LayoutState, branch: string): { upstream: string; row: number } | null {
  let fallback: { upstream: string; row: number } | null = null
  for (const [row, refs] of S.refsOf) {
    for (const entry of refs.split(", ")) {
      if (!entry.startsWith("refs/remotes/") || !entry.endsWith(`/${branch}`)) continue
      const name = entry.slice("refs/remotes/".length)
      if (name === `origin/${branch}`) return { upstream: name, row }
      fallback ??= { upstream: name, row }
    }
  }
  return fallback
}

export function computeSync(S: LayoutState): SyncInfo | null {
  const head = findHead(S)
  if (!head) return null
  const up = findUpstream(S, head.branch)
  if (!up || up.row === head.row) return null

  /* Two cursors walking down the first-parent chain; always advance the younger one
     (smaller row index) — they meet on the common base. A missing `fpRow` (layout hasn't
     reached there yet) invalidates the whole computation: better no marking than a wrong
     one, the next ingested page recomputes. */
  const ahead = new Set<number>()
  const behind = new Set<number>()
  let a = head.row
  let b = up.row
  while (a !== b) {
    if (ahead.size + behind.size > CAP) return null
    if (a < b) {
      ahead.add(a)
      const n = S.fpRow[a]
      if (n === undefined) return null
      a = n
    } else {
      behind.add(b)
      const n = S.fpRow[b]
      if (n === undefined) return null
      b = n
    }
  }
  return { branch: head.branch, upstream: up.upstream, headRow: head.row, upstreamRow: up.row, ahead, behind }
}

/** Compact fingerprint to detect a change between two recomputes (cf. controller). */
export const syncSignature = (s: SyncInfo | null) =>
  s ? `${s.headRow}:${s.upstreamRow}:${s.ahead.size}:${s.behind.size}` : ""
