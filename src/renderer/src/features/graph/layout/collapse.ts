/* Pure data transformations on the commit stream, before layout (AUDIT.md §6):
   folding of gitflow release/hotfix pairs into "capsules", and folding of stash entries. Both
   used to live in graph-canvas.ts (the second one explicitly listed in the audit as having no
   business in the imperative renderer: these are `Commit[] -> Commit[]` transformations, not
   rendering); they live here alongside `layoutChunk` (lanes.ts), whose call they precede. */

import type { Commit } from "../../../../../shared/types.ts"
import { parseMerge, parseRefs, type ParsedMerge } from "../../../lib/commit-parse.ts"
import { mergeFlow, SEMVER } from "../../../lib/gitflow.ts"

/* --- Collapse release/hotfix ---
   A gitflow release/hotfix lands as two merges — one on the master side, one on the develop side.
   We merge them into a "capsule": a synthetic multi-parent commit [develop-prev, master-prev,
   release-tip] that the metro draws as-is — the node straddles both lanes. The survivor keeps
   the develop merge's hash (the top row); the master merge, removed, leaves its hash in
   `cap.absorbed`, which `layoutChunk` keeps resolving — so no edge dangles, no matter
   the distance between the two merges. */

const MASTER = /^(master|main)$/
const masterSide = (m: ParsedMerge) => !m.to || MASTER.test(m.to)

function semverTag(refs: string): string | null {
  return parseRefs(refs).find((r) => r.kind === "tag" && SEMVER.test(r.name))?.name ?? null
}

/* Pairing happens page by page — a pair straddling two log pages stays as 2 rows instead of
   collapsing into one. Rare (both merges are born within a second of each other from a single
   `git flow finish`), and non-regressive: worst case is an extra row, never wrong data. */
export function collapsePairs(commits: Commit[]): Commit[] {
  const at = new Map(commits.map((c, i) => [c.h, i]))
  const drop = new Set<number>()
  const out: Commit[] = []
  for (let i = 0; i < commits.length; i++) {
    if (drop.has(i)) continue
    out.push(capsuleAt(commits, i, at, drop) ?? commits[i])
  }
  return out
}

function capsuleAt(commits: Commit[], i: number, at: Map<string, number>, drop: Set<number>): Commit | null {
  const d = commits[i]
  if (d.p.length < 2) return null
  const md = parseMerge(d.s)
  if (!md || md.to !== "develop" || !mergeFlow(md)) return null // the surviving row: the develop merge

  let mi: number | undefined
  if (md.tag)
    mi = at.get(d.p[1]) // pattern B: "merge tag" — the tag points to the master merge
  else
    for (let j = i + 1; j < commits.length; j++) {
      // pattern A: two branch merges, twinned by the release tip (2nd common parent)
      const m = commits[j]
      if (drop.has(j) || m.p.length < 2) continue
      const mm = parseMerge(m.s)
      if (mm && masterSide(mm) && mm.from === md.from && m.p[1] === d.p[1]) mi = j
      if (mi !== undefined) break
    }
  if (mi === undefined || mi <= i || drop.has(mi)) return null // the master merge is older: further down

  const m = commits[mi]
  const mm = parseMerge(m.s)
  const flow = mm ? mergeFlow(mm) : null // the master side (branch name) decides release vs hotfix
  if (!mm || !masterSide(mm) || !flow) return null

  drop.add(mi)
  const p = [...new Set([d.p[0], m.p[0], m.p[1]])]
  const r = [d.r, m.r].filter(Boolean).join(", ")
  return {
    ...m,
    h: d.h,
    p,
    r,
    cap: {
      absorbed: m.h,
      version: semverTag(r) ?? (md.tag ? md.from : null),
      from: mm.from,
      flow,
      targets: [mm.to || "master", md.to],
    },
  }
}

/* --- Stash folding ---
   A stash arrives from the log with its 2-3 parents (base, index, untracked). We only keep the
   base: the entry becomes a simple node hanging off its origin commit, and its plumbing
   commits — invisible elsewhere — are removed from the stream. The server total already
   subtracts them (cf. repo:total). `stashOf`/`plumbing` are re-read on every reset by the
   controller, just like the total: the list moves with push/pop/drop. */
export function foldStashes(page: Commit[], stashOf: Map<string, string>, plumbing: Set<string>): Commit[] {
  if (!stashOf.size) return page
  const out: Commit[] = []
  for (const c of page) {
    if (plumbing.has(c.h)) continue
    const name = stashOf.get(c.h)
    out.push(name ? { ...c, p: c.p.slice(0, 1), stash: { name, untracked: c.p[2] ?? null } } : c)
  }
  return out
}
