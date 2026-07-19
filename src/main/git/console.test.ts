/* Tests for the typed console's policy (console.ts): the parser is the whole security
   boundary between a string typed in the popup (or forged by a compromised renderer) and a
   spawned git process — every rejection here is an execution or confinement escape that
   must never reach spawn. `electron` is mocked out like in flow.test.ts: console.ts drags in
   repos.ts → state.ts, whose module scope imports `app`. */
import assert from "node:assert/strict"
import { describe, it, vi } from "vitest"

vi.mock("electron", () => ({ app: {} }))

import { AppError } from "../../shared/errors.ts"
import type { RepoHandle } from "../repos.ts"
import type { RunOpts } from "./exec.ts"
import { parseConsole, runConsole } from "./console.ts"

const code = (fn: () => unknown): string | null => {
  try {
    fn()
    return null
  } catch (e) {
    return (e as AppError).code
  }
}

describe("parseConsole", () => {
  it("splits a plain command, with or without the leading `git`", () => {
    assert.deepEqual(parseConsole("git status"), ["status"])
    assert.deepEqual(parseConsole("status"), ["status"])
    assert.deepEqual(parseConsole("  git   log  --oneline  -5 "), ["log", "--oneline", "-5"])
  })

  it("honors quotes like a shell would, without any expansion", () => {
    assert.deepEqual(parseConsole('git commit -m "hello world"'), ["commit", "-m", "hello world"])
    assert.deepEqual(parseConsole("git log --grep 'a b'"), ["log", "--grep", "a b"])
    assert.deepEqual(parseConsole('git commit -m "say \\"hi\\""'), ["commit", "-m", 'say "hi"'])
    assert.deepEqual(parseConsole("git add file\\ name"), ["add", "file name"])
    /* quoted, shell metacharacters are plain argument text — there is no shell to expand them */
    assert.deepEqual(parseConsole('git commit -m "a | b; c"'), ["commit", "-m", "a | b; c"])
  })

  it("rejects shell syntax instead of passing it to git as arguments", () => {
    for (const input of [
      "git log | head",
      "git status && ls",
      "git status; ls",
      "git log > out.txt",
      "git show `x`",
      "git show $(x)",
    ])
      assert.equal(
        code(() => parseConsole(input)),
        "BAD_ARG",
        input
      )
  })

  it("rejects malformed input: empty, unterminated quotes, control chars, oversized", () => {
    for (const input of [
      "",
      "   ",
      "git",
      "git log 'oops",
      'git log "oops',
      "git log \u0001x",
      "git " + "a".repeat(2000),
    ])
      assert.equal(
        code(() => parseConsole(input)),
        "BAD_ARG",
        JSON.stringify(input)
      )
    assert.equal(
      code(() => parseConsole(42)),
      "BAD_ARG"
    )
  })

  it("refuses global options — the subcommand must come first", () => {
    for (const input of [
      "git -c core.fsmonitor=/tmp/x status", // config injection = command execution
      "git -C /elsewhere status", // repo confinement escape
      "git --git-dir=/elsewhere/.git log",
      "git --exec-path=/tmp log",
    ])
      assert.equal(
        code(() => parseConsole(input)),
        "NOT_ALLOWED",
        input
      )
  })

  it("refuses subcommands outside the builtin allowlist (aliases can't shadow builtins)", () => {
    for (const input of [
      "git smash", // an alias — could be `!anything`
      "git config user.name x", // config writes = fsmonitor/pager/insteadOf injection
      "git difftool", // runs an external tool
      "git submodule update", // clones URLs taken from repo content
      "git worktree add /tmp/x", // writes outside the repo
      "git bisect run sh x.sh", // runs a command by design
      "git filter-branch --env-filter x",
      "git help log", // opens a browser/man viewer
      "git format-patch HEAD~1", // writes files by default
    ])
      assert.equal(
        code(() => parseConsole(input)),
        "NOT_ALLOWED",
        input
      )
  })

  it("refuses command-injection and file-writing options wherever they sit", () => {
    for (const input of [
      "git fetch --upload-pack=/tmp/evil origin",
      "git push --receive-pack /tmp/evil origin main",
      "git push --exec=/tmp/evil origin main",
      "git ls-remote --upload-pack=/tmp/evil origin",
      "git grep --open-files-in-pager=/tmp/evil x",
      "git log --output=/tmp/anywhere",
      "git apply --unsafe-paths x.patch",
    ])
      assert.equal(
        code(() => parseConsole(input)),
        "NOT_ALLOWED",
        input
      )
  })

  it("catches blocked short options even bundled in a cluster", () => {
    assert.equal(
      code(() => parseConsole("git rebase -x cmd HEAD~2")),
      "NOT_ALLOWED"
    )
    assert.equal(
      code(() => parseConsole("git rebase -fx cmd HEAD~2")),
      "NOT_ALLOWED"
    )
    assert.equal(
      code(() => parseConsole("git grep -O foo")),
      "NOT_ALLOWED"
    )
    /* the same letters stay fine where they are harmless */
    assert.deepEqual(parseConsole("git clean -fdx"), ["clean", "-fdx"])
    assert.deepEqual(parseConsole("git cherry-pick -x abc123"), ["cherry-pick", "-x", "abc123"])
  })

  it("stops option screening at `--`, where pathspecs begin", () => {
    assert.deepEqual(parseConsole("git log -- --output=x"), ["log", "--", "--output=x"])
  })

  it("refuses helper `::` URLs on remote add/set-url, even past `--`", () => {
    for (const input of [
      "git remote add evil ext::sh -c x", // would fire on the NEXT background fetch
      "git remote set-url origin 'ext::sh -c x'",
      "git remote add -- evil fd::17",
    ])
      assert.equal(
        code(() => parseConsole(input)),
        "NOT_ALLOWED",
        input
      )
    assert.deepEqual(parseConsole("git remote add origin https://example.com/a.git"), [
      "remote",
      "add",
      "origin",
      "https://example.com/a.git",
    ])
    assert.deepEqual(parseConsole("git remote -v"), ["remote", "-v"])
  })
})

/** Minimal handle: `git` records its calls; the queue fields are what withLock touches. */
function fakeRepo() {
  const calls: { args: string[]; opts?: RunOpts }[] = []
  const traces: string[] = []
  const r = {
    path: "/r",
    running: null,
    pending: [],
    lockCount: 0,
    lockTail: Promise.resolve(),
    closed: false,
    events: { trace: (l: { kind: string }) => traces.push(l.kind), queue: () => {} },
    git: (args: string[], opts?: RunOpts) => {
      calls.push({ args, opts })
      return Promise.resolve("")
    },
  } as unknown as RepoHandle
  return { r, calls, traces }
}

describe("runConsole", () => {
  it("runs the parsed argv with the console's transport policy and a group header", async () => {
    const { r, calls, traces } = fakeRepo()
    await runConsole(r, "git fetch origin")
    assert.deepEqual(calls[0].args, ["fetch", "origin"])
    assert.equal(calls[0].opts?.env?.GIT_ALLOW_PROTOCOL, "file:git:http:https:ssh")
    assert.deepEqual(traces, ["group"]) // cmd/stderr/exit come from the real runner, not here
  })

  it("re-emits stdout as out lines and closes the stream again", async () => {
    const { r, traces } = fakeRepo()
    const record = r.git
    r.git = (args, opts) => {
      void record(args, opts)
      return Promise.resolve("On branch main\nnothing to commit\n")
    }
    await runConsole(r, "git status")
    /* runner's own exit precedes the stdout re-emission — a closing exit keeps the feed's
       busy heuristic (last line an exit) true for finished commands */
    assert.deepEqual(traces, ["group", "out", "out", "exit"])
  })

  it("never reaches git when the policy refuses the command", async () => {
    const { r, calls } = fakeRepo()
    await assert.rejects(
      async () => runConsole(r, "git config user.name x"),
      (e: AppError) => e.code === "NOT_ALLOWED"
    )
    await assert.rejects(
      async () => runConsole(r, "git log | head"),
      (e: AppError) => e.code === "BAD_ARG"
    )
    assert.equal(calls.length, 0)
  })

  it("queues mutations behind the repo lock; reads run free", async () => {
    const { r, calls } = fakeRepo()
    /* a mutation takes the lock: a second one must wait for the first to settle */
    let release!: () => void
    const gate = new Promise<void>((res) => (release = res))
    const slowGit = r.git
    r.git = async (args, opts) => {
      if (args[0] === "commit") await gate
      return slowGit(args, opts)
    }
    const commit = runConsole(r, "git commit -m x")
    const status = runConsole(r, "git status") // a read — must not wait behind the commit
    await status
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["status"]
    )
    release()
    await commit
    assert.deepEqual(
      calls.map((c) => c.args[0]),
      ["status", "commit"]
    )
  })
})
