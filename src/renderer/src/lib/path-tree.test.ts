/* Generic path tree (AUDIT.md §7, phase 5). The single algorithm behind both file-list and
   refs-sidebar's tree views — a regression here breaks two features at once, hence a test of
   its own. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { buildPathTree } from "./path-tree.ts"

/** items are their own path here — the simplest `pathOf` */
const tree = (paths: string[]) => buildPathTree(paths, (p) => p)

describe("buildPathTree", () => {
  it("keeps a single-segment path at the root", () => {
    const t = tree(["README.md"])
    assert.deepEqual(t.items, ["README.md"])
    assert.equal(t.dirs.size, 0)
  })

  it("nests items under their directories, storing only the leaf at each level", () => {
    const t = tree(["src/lib/a.ts", "src/lib/b.ts", "src/index.ts"])
    assert.deepEqual(t.items, [], "nothing stops at the root")
    const src = t.dirs.get("src")!
    assert.deepEqual(src.items, ["src/index.ts"], "index.ts stops at src")
    const lib = src.dirs.get("lib")!
    assert.deepEqual(lib.items, ["src/lib/a.ts", "src/lib/b.ts"])
    assert.equal(lib.dirs.size, 0)
  })

  it("lets items stop at mixed depths under the same directory", () => {
    const t = tree(["a/x", "a/b/y"])
    const a = t.dirs.get("a")!
    assert.deepEqual(a.items, ["a/x"])
    assert.deepEqual(a.dirs.get("b")!.items, ["a/b/y"])
  })

  it("preserves input order among siblings", () => {
    const t = tree(["z", "a", "m"])
    assert.deepEqual(t.items, ["z", "a", "m"])
  })

  it("uses the provided pathOf to read the path off an arbitrary item", () => {
    const items = [{ name: "src/a.ts" }, { name: "src/b.ts" }]
    const t = buildPathTree(items, (i) => i.name)
    assert.deepEqual(
      t.dirs.get("src")!.items.map((i) => i.name),
      ["src/a.ts", "src/b.ts"]
    )
  })

  it("returns an empty root for an empty list", () => {
    const t = tree([])
    assert.equal(t.items.length, 0)
    assert.equal(t.dirs.size, 0)
  })
})
