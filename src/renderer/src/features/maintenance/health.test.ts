import { describe, expect, it } from "vitest"

import { GC_LOOSE_LIMIT, GC_PACK_LIMIT, repoHealth } from "@/features/maintenance/health"
import type { CountObjects } from "@/lib/git"

const base: CountObjects = {
  count: 0,
  size: "0",
  inPack: 0,
  packs: 0,
  sizePack: "0",
  prunePackable: 0,
  garbage: 0,
  sizeGarbage: "0",
}

describe("repoHealth", () => {
  it("reports a healthy repo (nothing to compact)", () => {
    expect(repoHealth({ ...base, count: 100, packs: 1 })).toEqual({ needsCompaction: false, reason: null })
  })

  it("flags loose objects at/above the gc.auto limit", () => {
    expect(repoHealth({ ...base, count: GC_LOOSE_LIMIT })).toEqual({ needsCompaction: true, reason: "loose" })
    expect(repoHealth({ ...base, count: GC_LOOSE_LIMIT - 1 }).needsCompaction).toBe(false)
  })

  it("flags too many packs at/above the gc.autoPackLimit", () => {
    expect(repoHealth({ ...base, packs: GC_PACK_LIMIT })).toEqual({ needsCompaction: true, reason: "packs" })
    expect(repoHealth({ ...base, packs: GC_PACK_LIMIT - 1 }).needsCompaction).toBe(false)
  })

  it("flags unreferenced/prunable cruft", () => {
    expect(repoHealth({ ...base, garbage: 1 })).toEqual({ needsCompaction: true, reason: "garbage" })
    expect(repoHealth({ ...base, prunePackable: 3 })).toEqual({ needsCompaction: true, reason: "garbage" })
  })

  it("prioritizes loose > packs > garbage when several signals fire", () => {
    expect(repoHealth({ ...base, count: GC_LOOSE_LIMIT, packs: GC_PACK_LIMIT, garbage: 5 }).reason).toBe("loose")
    expect(repoHealth({ ...base, packs: GC_PACK_LIMIT, garbage: 5 }).reason).toBe("packs")
  })
})
