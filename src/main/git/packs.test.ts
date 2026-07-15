/* Tests for the pack-garbage sweep (packs.ts). The listing filters are pure, tested like the
   parse.ts parsers; `sweepPackGarbage` gets integration runs against a real temporary
   repository (git spawned through createGitRunner, which imports nothing from Electron): every
   garbage class the sweep recognizes must leave `count-objects` at `garbage: 0` after the
   compact flow. */
import assert from "node:assert/strict"
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, it } from "vitest"

import { createGitRunner } from "./exec.ts"
import { orphanedCompanions, orphanedPacks, sweepPackGarbage, transferTemporaries } from "./packs.ts"
import { parseCountObjects } from "./parse.ts"

const SHA = "0".repeat(40)

describe("orphanedPacks (pack-directory listing filter)", () => {
  it("returns nothing for an empty or pack-less listing", () => {
    assert.deepEqual(orphanedPacks([]), [])
    assert.deepEqual(orphanedPacks(["multi-pack-index", "pack-x.idx"]), [])
  })

  it("keeps a .pack without its .idx, never a valid pair", () => {
    assert.deepEqual(orphanedPacks([`pack-${SHA}.pack`]), [`pack-${SHA}.pack`])
    assert.deepEqual(orphanedPacks([`pack-${SHA}.pack`, `pack-${SHA}.idx`]), [])
  })

  it("leaves a .keep-protected pack alone even without an index", () => {
    assert.deepEqual(orphanedPacks([`pack-${SHA}.pack`, `pack-${SHA}.keep`]), [])
  })

  it("ignores the other companion extensions: they neither validate nor protect", () => {
    const files = [
      `pack-${SHA}.pack`,
      `pack-${SHA}.rev`,
      `pack-${SHA}.bitmap`,
      `pack-${SHA}.mtimes`,
      `pack-${SHA}.promisor`,
    ]
    assert.deepEqual(orphanedPacks(files), [`pack-${SHA}.pack`])
  })

  it("sorts the orphans and matches stems exactly", () => {
    const files = ["pack-b.pack", "pack-a.pack", "pack-a.idx", "pack-c.pack", "pack-cc.idx"]
    assert.deepEqual(orphanedPacks(files), ["pack-b.pack", "pack-c.pack"])
  })
})

describe("orphanedCompanions (pack-directory listing filter)", () => {
  it("returns every companion whose .pack is gone, sorted", () => {
    const files = [`pack-${SHA}.rev`, `pack-${SHA}.mtimes`, `pack-${SHA}.keep`, `pack-${SHA}.idx`]
    assert.deepEqual(orphanedCompanions(files), [...files].sort())
  })

  it("leaves the companions of an existing pack alone, .keep included", () => {
    const files = [`pack-${SHA}.pack`, `pack-${SHA}.idx`, `pack-${SHA}.rev`, `pack-${SHA}.keep`]
    assert.deepEqual(orphanedCompanions(files), [])
  })

  it("never touches the multi-pack index or files it doesn't recognize", () => {
    assert.deepEqual(orphanedCompanions(["multi-pack-index", `multi-pack-index-${SHA}.bitmap`, "note.txt"]), [])
  })
})

describe("transferTemporaries (pack-directory listing filter)", () => {
  it("returns only tmp_* files, sorted", () => {
    const files = [`pack-${SHA}.pack`, "tmp_pack_b", "tmp_idx_a", "multi-pack-index"]
    assert.deepEqual(transferTemporaries(files), ["tmp_idx_a", "tmp_pack_b"])
  })
})

describe("sweepPackGarbage (integration, real git)", () => {
  let repo: string
  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "amont-packs-"))
  })
  afterEach(() => rm(repo, { recursive: true, force: true }))

  const initRepo = async () => {
    const { git } = createGitRunner({ path: repo, children: new Set() })
    await git(["init", "-q"])
    await git(["config", "user.email", "t@example.com"])
    await git(["config", "user.name", "t"])
    await writeFile(join(repo, "f.txt"), "hello\n")
    await git(["add", "f.txt"])
    await git(["commit", "-q", "-m", "c1"])
    return git
  }

  it("recovers a valid orphan, deletes a truncated one: garbage 0 after compacting", async () => {
    const git = await initRepo()

    /* A valid orphan: pack the repo's objects into objects/pack (the loose originals stay, so
       the repo remains healthy), then strip the pack's companions down to the bare `.pack`. */
    const packDir = join(repo, ".git", "objects", "pack")
    const objects = await git(["rev-list", "--objects", "HEAD"])
    const packed = (await git(["pack-objects", "-q", join(packDir, "pack")], { input: objects })).trim()
    for (const f of await readdir(packDir)) if (!f.endsWith(".pack")) await rm(join(packDir, f))
    /* And an unrecoverable one: arbitrary bytes under a well-formed pack name. */
    await writeFile(join(packDir, `pack-${SHA}.pack`), "not a pack")

    const logs: string[] = []
    const sweep = () => sweepPackGarbage({ packDir, git, timeout: 60_000, log: (t) => logs.push(t) })

    const recovered = await sweep()
    assert.equal(recovered, 1)
    const files = await readdir(packDir)
    assert.ok(files.includes(`pack-${packed}.idx`), "index-pack rebuilt the missing .idx")
    assert.ok(!files.includes(`pack-${SHA}.pack`), "the truncated pack was deleted")
    assert.deepEqual(logs, [
      `orphaned pack deleted (unrecoverable): pack-${SHA}.pack`,
      `orphaned pack recovered: pack-${packed}.pack`,
    ])

    /* The compact flow's final gc absorbs/prunes the recovered objects: no garbage left. */
    await git(["gc", "-q"])
    const after = parseCountObjects(await git(["count-objects", "-v"]))
    assert.equal(after.garbage, 0)
    assert.equal(await sweep(), 0) // and the sweep itself is now a no-op
  }, 30_000)

  it("clears stranded companions and stale temporaries, spares a live-looking tmp", async () => {
    const git = await initRepo()
    await git(["gc", "-q"])
    const packDir = join(repo, ".git", "objects", "pack")

    /* companions of a pack that no longer exists, a dead transfer's tmp, a live transfer's tmp */
    for (const ext of ["rev", "mtimes", "keep"]) await writeFile(join(packDir, `pack-${SHA}.${ext}`), "x")
    await writeFile(join(packDir, "tmp_pack_dead"), "x")
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000)
    await utimes(join(packDir, "tmp_pack_dead"), twoHoursAgo, twoHoursAgo)
    await writeFile(join(packDir, "tmp_pack_live"), "x")

    const logs: string[] = []
    const recovered = await sweepPackGarbage({ packDir, git, timeout: 60_000, log: (t) => logs.push(t) })
    assert.equal(recovered, 0)

    const files = await readdir(packDir)
    for (const ext of ["rev", "mtimes", "keep"]) assert.ok(!files.includes(`pack-${SHA}.${ext}`))
    assert.ok(!files.includes("tmp_pack_dead"), "the stale temporary was deleted")
    assert.ok(files.includes("tmp_pack_live"), "the recent temporary was spared")
    assert.deepEqual(logs, [
      `stranded pack file deleted: pack-${SHA}.keep`,
      `stranded pack file deleted: pack-${SHA}.mtimes`,
      `stranded pack file deleted: pack-${SHA}.rev`,
      `stale transfer temporary deleted: tmp_pack_dead`,
      `transfer temporary kept (may be live): tmp_pack_live`,
    ])

    /* only the possibly-live tmp is left; once it goes stale, a re-sweep finishes the job */
    assert.equal(parseCountObjects(await git(["count-objects", "-v"])).garbage, 1)
    await utimes(join(packDir, "tmp_pack_live"), twoHoursAgo, twoHoursAgo)
    await sweepPackGarbage({ packDir, git, timeout: 60_000, log: () => {} })
    assert.equal(parseCountObjects(await git(["count-objects", "-v"])).garbage, 0)
  }, 30_000)

  it("is a quiet no-op without a pack directory", async () => {
    const { git } = createGitRunner({ path: repo, children: new Set() })
    const recovered = await sweepPackGarbage({ packDir: join(repo, "missing"), git, timeout: 60_000, log: () => {} })
    assert.equal(recovered, 0)
  })
})
