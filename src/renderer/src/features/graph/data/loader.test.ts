/* growUntil shares the fetchMore single-flight. loader.ts is a pure module (no DOM), so the
   race is reproducible under the Node test env: a scroll-driven fetchMore, or a second jump,
   firing while a batch is in flight must not append a page of its own — it would land at a
   shifted rowStart and duplicate rows. `api.log` resolves on a macrotask so the concurrent
   calls genuinely interleave. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { Commit } from "../../../../../shared/types.ts"
import type { RepoApi } from "@/lib/git"
import { createLoader, type GraphLoader } from "./loader.ts"

/** Linear history of n commits, c0 (newest) .. c{n-1} (root); parent of c{k} is c{k+1}. */
function linearRepo(n: number): Commit[] {
  return Array.from({ length: n }, (_, k) => ({
    h: `c${k}`,
    p: k + 1 < n ? [`c${k + 1}`] : [],
    d: "2026-01-01",
    a: "Ada",
    e: "ada@x.io",
    r: "",
    s: `c${k}`,
  }))
}

function fakeApi(commits: Commit[]): RepoApi {
  return {
    total: () => Promise.resolve(commits.length),
    stashes: () => Promise.resolve([]),
    worktrees: () => Promise.resolve([]),
    log: (skip: number, count: number) =>
      new Promise<Commit[]>((res) => setTimeout(() => res(commits.slice(skip, skip + count)), 0)),
  } as unknown as RepoApi
}

/** Every row maps to a distinct hash id and rowOf is its inverse — the property a duplicated
    page would break (same commits laid out at two rowStarts). */
function assertNoDuplicateRows(loader: GraphLoader): void {
  const S = loader.state
  assert.equal(new Set(S.hashOf).size, S.next, "every row maps to a distinct hash id")
  for (let row = 0; row < S.next; row++) {
    assert.equal(S.rowOf.get(S.hashOf[row]), row, `rowOf(hashOf(${row})) must return to ${row}`)
  }
}

describe("loader — growUntil single-flight (F3)", () => {
  it("a fetchMore firing during a jump doesn't duplicate a page", async () => {
    const loader = createLoader({ api: fakeApi(linearRepo(20)), pageSize: 2, resident: 100 })
    await loader.reset()
    const jump = loader.growUntil(() => loader.state.next >= 10, loader.token)
    const scroll = loader.fetchMore()
    await Promise.all([jump, scroll])
    assert.ok(loader.state.next >= 10, "the jump reached its target")
    assertNoDuplicateRows(loader)
  })

  it("two concurrent growUntil calls serialize without duplication", async () => {
    const loader = createLoader({ api: fakeApi(linearRepo(20)), pageSize: 2, resident: 100 })
    await loader.reset()
    const a = loader.growUntil(() => loader.state.next >= 8, loader.token)
    const b = loader.growUntil(() => loader.state.next >= 12, loader.token)
    await Promise.all([a, b])
    assertNoDuplicateRows(loader)
  })
})
