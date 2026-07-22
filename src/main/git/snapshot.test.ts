/* Pins the deliberate difference between the two ref reads (snapshot.ts): `refTips` is
   blind to name-only changes BY DESIGN (a rename is not fetched history), while
   `refSnapshot` must see them (the UI repaints on a rename). A change that makes these two
   agree in either direction reintroduces one of two shipped bugs: renames reported as "N
   new commits", or renames never repainting the sidebar. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import { refSnapshot, refTips, type RefReader } from "./snapshot.ts"

/** for-each-ref canned per format string, as `[refname, objectname]` pairs. */
function reader(refs: [string, string][]): RefReader {
  return {
    git: (args) =>
      Promise.resolve(
        refs.map(([name, hash]) => (args.includes("--format=%(objectname)") ? hash : `${name}\0${hash}`)).join("\n")
      ),
  }
}

const BASE: [string, string][] = [
  ["refs/heads/main", "aaa"],
  ["refs/remotes/origin/main", "aaa"],
  ["refs/heads/topic", "bbb"],
]

describe("refTips vs refSnapshot", () => {
  it("a name-only change (new branch on an existing tip) moves the snapshot, not the tips", async () => {
    const renamed: [string, string][] = [...BASE, ["refs/heads/hotfix", "bbb"]]
    assert.deepEqual(await refTips(reader(BASE)), await refTips(reader(renamed)))
    assert.notEqual(await refSnapshot(reader(BASE)), await refSnapshot(reader(renamed)))
  })

  it("a tip move changes both", async () => {
    const moved: [string, string][] = [...BASE.slice(0, 2), ["refs/heads/topic", "ccc"]]
    assert.notDeepEqual(await refTips(reader(BASE)), await refTips(reader(moved)))
    assert.notEqual(await refSnapshot(reader(BASE)), await refSnapshot(reader(moved)))
  })

  it("tips are deduplicated and sorted: enumeration order never fakes a change", async () => {
    assert.deepEqual(await refTips(reader(BASE)), ["aaa", "bbb"])
    assert.deepEqual(await refTips(reader([...BASE].reverse())), ["aaa", "bbb"])
  })
})
