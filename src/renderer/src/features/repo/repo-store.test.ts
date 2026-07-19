import { beforeAll, describe, expect, it, vi } from "vitest"

import type { GraphHandle } from "@/features/graph/controller"

// The lingui-macro module can't be transformed under the node test env; the store only
// reads it for banner copy, never in the selection path exercised here.
vi.mock("@/lib/messages", () => ({ messages: new Proxy({}, { get: () => "" }) }))

type SelectRow = { getState(): { selectRow(row: number, additive: boolean): void } }

/* Mock graph. Branch A tip → row 0, branch B tip → row 5.
   `jumpTo` reproduces the real controller: reveal() selects the revealed row (non-additive)
   unless the caller opts out with `select: false` — the exact side effect that used to drop
   the first branch of a multi-selection. */
function mockGraph(store: () => SelectRow): GraphHandle {
  const rowOf: Record<string, number> = { a: 0, b: 5 }
  const branchOf: Record<number, { name: string; kind: "head" | "remote" }> = {
    0: { name: "A", kind: "head" },
    5: { name: "B", kind: "head" },
  }
  return {
    reset: () => Promise.resolve(),
    jumpTo: (hash: string, select = true) => {
      if (select) store().getState().selectRow(rowOf[hash], false)
      return Promise.resolve()
    },
    setSelection: () => {},
    setMatches: () => {},
    nextMatch: () => Promise.resolve(null),
    rowsOf: (hashes: string[]) => Promise.resolve(hashes.map((h) => rowOf[h]).filter((r) => r !== undefined)),
    pin: () => Promise.resolve(),
    commit: (row: number) => ({ h: row === 0 ? "a" : "b" }) as never,
    branchSegment: (row: number) => [row],
    chainInfo: () => ({}) as never,
    branchesOf: (row: number) => (branchOf[row] ? [branchOf[row]] : []),
  } as unknown as GraphHandle
}

let createRepoStore: (typeof import("@/features/repo/repo-store"))["createRepoStore"]

beforeAll(async () => {
  const g = globalThis as unknown as { window?: unknown; localStorage?: unknown }
  const kv: Record<string, string> = {}
  g.localStorage = {
    getItem: (k: string) => kv[k] ?? null,
    setItem: (k: string, v: string) => void (kv[k] = v),
    removeItem: (k: string) => void delete kv[k],
  }
  g.window = { amont: new Proxy({}, { get: () => () => {} }), localStorage: g.localStorage }
  ;({ createRepoStore } = await import("@/features/repo/repo-store"))
})

describe("focusRef additive (Ctrl-click multi-select from the sidebar)", () => {
  it("keeps the first branch lit when Ctrl-clicking a second", async () => {
    const store = createRepoStore(1, {} as never, () => {})
    store.getState().graphRef.current = mockGraph(() => store)

    await store.getState().focusRef({ kind: "head", name: "A", tip: "a" } as never, false)
    expect([...store.getState().selection.focusedKeys]).toEqual(["head:A"])

    await store.getState().focusRef({ kind: "head", name: "B", tip: "b" } as never, true)
    expect([...store.getState().selection.focusedKeys].sort()).toEqual(["head:A", "head:B"])
  })
})
