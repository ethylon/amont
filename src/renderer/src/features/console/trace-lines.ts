/* Line ordering and the failure↔command join of the git console (git-console.tsx). Parallel
   reads on the main side (the post-fetch refresh) interleave their trace lines, so anything
   positional — "the exit goes after the last line", "the failed command is the cmd above" —
   pins failures onto the wrong command. Both joins go through the `seq` the runner stamps on
   its lines (git/exec.ts) instead. Pure, so the interleaving cases are unit-testable. */

import type { TraceLine } from "@/lib/git"

/** Display order: each failed exit is moved right under the last line of ITS command (same
    `seq`), wherever the interleaving put it. An exit whose command has left the buffer (the
    console cap) — or that carries no `seq` (emitted outside the runner) — stays in place and
    degrades to the generic failure line. Successful exits render nothing and stay put. */
export function displayOrder<T extends TraceLine>(lines: T[]): T[] {
  const out: T[] = []
  /* seq → index in `out` of the last cmd/out line of that command */
  const lastOfSeq = new Map<number, number>()
  for (const l of lines) {
    if (l.kind === "exit" && !l.ok && l.seq !== undefined) {
      const at = lastOfSeq.get(l.seq)
      if (at !== undefined && at !== out.length - 1) {
        out.splice(at + 1, 0, l)
        for (const [s, i] of lastOfSeq) if (i > at) lastOfSeq.set(s, i + 1)
        continue
      }
    }
    if ((l.kind === "cmd" || l.kind === "out") && l.seq !== undefined) lastOfSeq.set(l.seq, out.length)
    out.push(l)
  }
  return out
}

/** The most recent failure, joined to its command by `seq`: `null` when nothing failed,
    `{ cmd: null }` when the failure is real but its cmd line is unknowable (evicted by the
    cap, or no `seq`) — the caller falls back to its generic "a command" label. */
export function lastFailure(lines: TraceLine[]): { cmd: string | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]
    if (l.kind !== "exit" || l.ok) continue
    if (l.seq === undefined) return { cmd: null }
    const cmd = lines.find((p): p is Extract<TraceLine, { kind: "cmd" }> => p.kind === "cmd" && p.seq === l.seq)
    return { cmd: cmd?.text ?? null }
  }
  return null
}
