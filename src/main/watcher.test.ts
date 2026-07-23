/* Tests for the `emitChanged` fingerprint gate (refresh audit, §2/§7): a .git event whose
   graph snapshot (HEAD + refs + stash) is unchanged must never wake the renderer, while a
   missing or failing provider must fail open — staying silent on a real change is the one
   unacceptable outcome. The baseline (`lastGraphKey`) is seeded by the graph's read path
   (git/queries.ts orderedHashes), NOT eagerly by mute(): an eager post-op read could absorb
   an external change the renderer never saw and silence its recovery for good. */
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "vitest"

import { emitChanged, mute, watchWorktree, type Watchable, type WtWatchable } from "./watcher.ts"

function fakeWatchable(keys: Array<string | Error>) {
  let calls = 0
  let emitted = 0
  const r: Watchable = {
    gitDir: "/tmp/x/.git",
    running: null,
    muted: 0,
    dirty: false,
    gen: 0,
    lastGraphKey: null,
    watchers: [],
    watchRetries: 0,
    retryTimer: null,
    events: {
      changed: () => emitted++,
      isFocused: () => true,
      graphKey: () => {
        const k = keys[Math.min(calls++, keys.length - 1)]
        return k instanceof Error ? Promise.reject(k) : Promise.resolve(k)
      },
    },
  }
  return { r, emitted: () => emitted }
}

describe("emitChanged: fingerprint gate in front of git:changed", () => {
  it("emits on first sight of a key, then suppresses while it holds still", async () => {
    const { r, emitted } = fakeWatchable(["A", "A", "A"])
    await emitChanged(r)
    await emitChanged(r) // gc rewrote packed-refs, snapshot identical
    await emitChanged(r)
    assert.equal(emitted(), 1)
  })

  it("emits again as soon as the key moves", async () => {
    const { r, emitted } = fakeWatchable(["A", "A", "B"])
    await emitChanged(r)
    await emitChanged(r)
    await emitChanged(r) // commit from a terminal: HEAD moved
    assert.equal(emitted(), 2)
    assert.equal(r.lastGraphKey, "B")
  })

  it("suppresses an event whose key the read path already seeded (post-op echo)", async () => {
    const { r, emitted } = fakeWatchable(["post-op"])
    r.lastGraphKey = "post-op" // the renderer's own reload read this state (orderedHashes)
    await emitChanged(r) // late filesystem echo of our own command, past the mute window
    assert.equal(emitted(), 0)
  })

  it("fails open without a provider (never silences a possible real change)", async () => {
    const { r, emitted } = fakeWatchable([])
    delete r.events.graphKey
    await emitChanged(r)
    await emitChanged(r)
    assert.equal(emitted(), 2)
  })

  it("fails open when the provider rejects, and leaves the baseline untouched", async () => {
    const { r, emitted } = fakeWatchable(["A", new Error("git died"), "A"])
    await emitChanged(r)
    await emitChanged(r) // provider failure: emit anyway
    assert.equal(emitted(), 2)
    assert.equal(r.lastGraphKey, "A")
    await emitChanged(r) // back to a healthy read of the same state: suppressed
    assert.equal(emitted(), 2)
  })

  it("drops the emission when a command starts during the key read (mid-op race)", async () => {
    const { r, emitted } = fakeWatchable([])
    r.events.graphKey = () => {
      r.running = "checkout" // the user clicked mid-read; the op's own path reloads
      return Promise.resolve("K")
    }
    await emitChanged(r)
    assert.equal(emitted(), 0)
    assert.equal(r.lastGraphKey, null) // the mid-op key is unreliable: not baselined
  })

  it("drops the emission when the mute window reopens during the key read", async () => {
    const { r, emitted } = fakeWatchable([])
    r.events.graphKey = () => {
      mute(r) // an op finished while we were reading
      return Promise.resolve("K")
    }
    await emitChanged(r)
    assert.equal(emitted(), 0)
  })
})

describe("mute: quiets the watcher without touching the baseline", () => {
  it("bumps gen and never reads or writes the fingerprint", async () => {
    const { r } = fakeWatchable(["should-not-be-read"])
    let reads = 0
    r.events.graphKey = () => {
      reads++
      return Promise.resolve("X")
    }
    mute(r)
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(r.gen, 1)
    assert.equal(reads, 0) // an eager read here could absorb a change held as `dirty`
    assert.equal(r.lastGraphKey, null)
  })
})

/* Real-filesystem tests: fs.watch delivery timing varies by platform, so assertions poll up
   to a deadline instead of sleeping a fixed debounce — a quiet CI box must not flake them. */
describe("watchWorktree: recursive watch over the repo root", () => {
  const roots: string[] = []
  const watchers: WtWatchable[] = []
  afterEach(() => {
    for (const w of watchers.splice(0)) w.wtWatcher?.close()
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function setup(focused = true) {
    const root = mkdtempSync(join(tmpdir(), "amont-wt-"))
    roots.push(root)
    mkdirSync(join(root, ".git"))
    mkdirSync(join(root, "src"))
    let fired = 0
    const r: WtWatchable = {
      running: null,
      muted: 0,
      wtDirty: false,
      wtWatcher: null,
      events: { isFocused: () => focused, wtChanged: () => fired++ },
    }
    watchWorktree(r, root)
    watchers.push(r)
    return { root, r, fired: () => fired }
  }

  const until = async (cond: () => boolean, ms = 3000) => {
    const deadline = Date.now() + ms
    while (!cond() && Date.now() < deadline) await new Promise((res) => setTimeout(res, 50))
    return cond()
  }
  /** long enough past WT_DEBOUNCE for a wrongly-scheduled fire to have landed */
  const settle = () => new Promise((res) => setTimeout(res, 700))

  it("collapses a burst of edits into one focused wtChanged", async () => {
    const { root, fired } = setup()
    writeFileSync(join(root, "src", "a.ts"), "a")
    writeFileSync(join(root, "src", "b.ts"), "b")
    assert.ok(await until(() => fired() === 1), "expected one debounced emission")
    await settle()
    assert.equal(fired(), 1)
  })

  it("ignores writes under .git — that's the ref trio's domain", async () => {
    const { root, fired } = setup()
    writeFileSync(join(root, ".git", "index"), "idx")
    await settle()
    assert.equal(fired(), 0)
  })

  it("holds an unfocused change as wtDirty for the focus flush", async () => {
    const { root, r, fired } = setup(false)
    writeFileSync(join(root, "src", "a.ts"), "a")
    assert.ok(await until(() => r.wtDirty), "expected the change held as wtDirty")
    assert.equal(fired(), 0)
  })

  it("drops events while a mutation runs — its completion path re-reads anyway", async () => {
    const { root, r, fired } = setup()
    r.running = "checkout"
    writeFileSync(join(root, "src", "a.ts"), "a")
    await settle()
    assert.equal(fired(), 0)
    assert.equal(r.wtDirty, false)
  })
})
