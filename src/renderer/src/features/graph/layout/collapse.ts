/* Transformations de données pures sur le flux de commits, avant mise en page (AUDIT.md §6) :
   repli des paires release/hotfix gitflow en « capsules », et repli des entrées de stash. Les
   deux vivaient dans graph-canvas.ts (le second nommément listé dans l'audit comme n'ayant rien
   à faire dans le renderer impératif : ce sont des transformations `Commit[] -> Commit[]`, pas du
   rendu) ; elles cohabitent ici avec `layoutChunk` (lanes.ts) dont elles précèdent l'appel. */

import type { Commit } from "../../../../../shared/types.ts"
import { mergeFlow, parseMerge, parseRefs, SEMVER, type ParsedMerge } from "../../../lib/commit-message.ts"

/* --- Collapse release/hotfix ---
   Une release/hotfix gitflow atterrit en deux merges — un côté master, un côté develop. On les
   fusionne en une « capsule » : un commit synthétique multi-parents [develop-prev, master-prev,
   tip-release] que le métro dessine tel quel — le nœud enjambe les deux lanes. Le survivant garde
   le hash du merge develop (la ligne du haut) ; le merge master, retiré, laisse son hash dans
   `cap.absorbed`, que `layoutChunk` continue de résoudre — donc aucune arête ne pend, quelle que
   soit la distance entre les deux merges. */

const MASTER = /^(master|main)$/
const masterSide = (m: ParsedMerge) => !m.to || MASTER.test(m.to)

function semverTag(refs: string): string | null {
  return parseRefs(refs).find((r) => r.kind === "tag" && SEMVER.test(r.name))?.name ?? null
}

/* ponytail: appariement page par page — une paire à cheval sur deux pages de log reste en 2 lignes.
   Rare (les deux merges naissent à la seconde près d'un `git flow finish`), non régressif. */
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
  if (!md || md.to !== "develop" || !mergeFlow(md)) return null // la ligne survivante : le merge develop

  let mi: number | undefined
  if (md.tag) mi = at.get(d.p[1]) // pattern B : « merge tag » — le tag pointe le merge master
  else
    for (let j = i + 1; j < commits.length; j++) {
      // pattern A : deux merges de branche, jumeaux par le tip release (2e parent commun)
      const m = commits[j]
      if (drop.has(j) || m.p.length < 2) continue
      const mm = parseMerge(m.s)
      if (mm && masterSide(mm) && mm.from === md.from && m.p[1] === d.p[1]) mi = j
      if (mi !== undefined) break
    }
  if (mi === undefined || mi <= i || drop.has(mi)) return null // le merge master est plus vieux : en dessous

  const m = commits[mi]
  const mm = parseMerge(m.s)
  const flow = mm ? mergeFlow(mm) : null // le côté master (nom de branche) tranche release vs hotfix
  if (!mm || !masterSide(mm) || !flow) return null

  drop.add(mi)
  const p = [...new Set([d.p[0], m.p[0], m.p[1]])]
  const r = [d.r, m.r].filter(Boolean).join(", ")
  return {
    ...m,
    h: d.h,
    p,
    r,
    cap: { absorbed: m.h, version: semverTag(r) ?? (md.tag ? md.from : null), from: mm.from, flow, targets: [mm.to || "master", md.to] },
  }
}

/* --- Repli des stash ---
   Un stash arrive du log avec ses 2-3 parents (base, index, non suivis). On ne garde que la
   base : l'entrée devient un nœud simple accroché à son commit d'origine, et ses commits de
   plomberie — invisibles ailleurs — sont retirés du flux. Le total du serveur les soustrait
   déjà (cf. repo:total). `stashOf`/`plumbing` sont relus à chaque reset par le contrôleur,
   comme le total : la liste bouge avec push/pop/drop. */
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
