/* Generic path tree (AUDIT.md §7, phase 5). The single algorithm behind both file-list and
   refs-sidebar's tree views — a regression here breaks two features at once, hence a test of
   its own. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { buildPathTree, compactPathTree } from "./path-tree.ts"

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

describe("compactPathTree", () => {
  const compact = (paths: string[]) => compactPathTree(tree(paths))

  it("joins a chain of single-child directories into one node", () => {
    const t = compact(["src/components/ui/combobox.tsx"])
    assert.deepEqual([...t.dirs.keys()], ["src/components/ui"])
    assert.deepEqual(t.dirs.get("src/components/ui")!.items, ["src/components/ui/combobox.tsx"])
  })

  it("stops joining where the tree branches", () => {
    const t = compact([
      "src/components/ui/combobox.tsx",
      "src/components/ui/input.tsx",
      "src/components/shared/hook.ts",
    ])
    assert.deepEqual([...t.dirs.keys()], ["src/components"])
    const c = t.dirs.get("src/components")!
    assert.deepEqual([...c.dirs.keys()].sort(), ["shared", "ui"])
    assert.deepEqual(c.dirs.get("ui")!.items, ["src/components/ui/combobox.tsx", "src/components/ui/input.tsx"])
    assert.deepEqual(c.dirs.get("shared")!.items, ["src/components/shared/hook.ts"])
  })

  it("stops joining where a directory holds an item of its own", () => {
    const t = compact(["src/index.ts", "src/lib/a.ts"])
    const src = t.dirs.get("src")!
    assert.deepEqual(src.items, ["src/index.ts"])
    assert.deepEqual([...src.dirs.keys()], ["lib"])
  })

  it("compacts chains that start below a branching point", () => {
    const t = compact(["a/x.ts", "a/b/c/d/y.ts"])
    const a = t.dirs.get("a")!
    assert.deepEqual([...a.dirs.keys()], ["b/c/d"])
    assert.deepEqual(a.dirs.get("b/c/d")!.items, ["a/b/c/d/y.ts"])
  })

  it("leaves an already-compact tree unchanged", () => {
    const t = compact(["src/a.ts", "src/b.ts", "README.md"])
    assert.deepEqual([...t.dirs.keys()], ["src"])
    assert.deepEqual(t.items, ["README.md"])
  })
})
