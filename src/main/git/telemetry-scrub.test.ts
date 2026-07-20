/* Tests for the pure telemetry helpers (telemetry-scrub.ts): the scrubber must let no
   user-identifying fragment through (path, URL, credential, host, email, sha, quoted ref),
   gitVerb must never surface an argument, and the session dedup must send a given
   scope×code pair exactly once. The Sentry wiring itself (main/telemetry.ts) stays
   untested, like captureRendererGone. */
import assert from "node:assert/strict"
import { afterEach, describe, it } from "vitest"

import { gitVerb, isNetworkNoise, resetDedupForTests, sanitizeDetail, shouldSend } from "./telemetry-scrub.ts"

describe("gitVerb (subcommand label, never an argument)", () => {
  it("keeps the first token alone for plain commands", () => {
    assert.equal(gitVerb(["status", "--porcelain", "-uall"]), "status")
    assert.equal(gitVerb(["checkout", "ma-branche"]), "checkout")
    assert.equal(gitVerb(["push", "--progress"]), "push")
  })

  it("appends the second token only when it is a whitelisted subverb", () => {
    assert.equal(gitVerb(["stash", "pop"]), "stash pop")
    assert.equal(gitVerb(["stash", "push", "-u", "-m", "amont: x"]), "stash push")
    assert.equal(gitVerb(["worktree", "list", "--porcelain", "-z"]), "worktree list")
    assert.equal(gitVerb(["reflog", "show", "--format=%gs", "refs/stash"]), "reflog show")
    assert.equal(gitVerb(["config", "--unset", "gitflow.branch.x.base"]), "config --unset")
    assert.equal(gitVerb(["config", "--get-regexp", "^gitflow"]), "config --get-regexp")
    assert.equal(gitVerb(["merge-tree", "--write-tree", "--no-messages", "a", "b"]), "merge-tree --write-tree")
    assert.equal(gitVerb(["cat-file", "blob", ":café.txt"]), "cat-file blob")
  })

  it("never picks up a sha, path or branch sitting in second position", () => {
    assert.equal(gitVerb(["rev-parse", "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef"]), "rev-parse")
    assert.equal(gitVerb(["cat-file", "-s", ":secret.txt"]), "cat-file")
    assert.equal(gitVerb(["merge", "feature/topsecret"]), "merge")
  })

  it("tolerates an empty argv", () => {
    assert.equal(gitVerb([]), "")
  })
})

describe("sanitizeDetail (privacy scrubber)", () => {
  it("keeps only the first line", () => {
    assert.equal(sanitizeDetail("could not lock config file\nsecond line\nthird"), "could not lock config file")
    assert.equal(sanitizeDetail("windows line\r\nrest"), "windows line")
  })

  it("replaces URLs, credentials included — no token fragment survives", () => {
    const out = sanitizeDetail("unable to access 'https://user:s3cr3t-tok@github.com/me/repo.git/'")
    assert.ok(!out.includes("s3cr3t"), out)
    assert.ok(!out.includes("github.com"), out)
    assert.ok(!out.includes("repo.git"), out)
  })

  it("replaces scp-like remotes (git@host:path)", () => {
    const out = sanitizeDetail("does not appear to be a git repository: git@github.com:me/repo.git")
    assert.ok(!out.includes("github.com"), out)
    assert.ok(!out.includes("me/repo"), out)
  })

  it("replaces the host of a resolve failure", () => {
    assert.equal(
      sanitizeDetail("Could not resolve host: git.internal.corp (exit 128)"),
      "Could not resolve host: <host> (exit 128)"
    )
  })

  it("replaces absolute paths — unix, windows, UNC, tilde", () => {
    assert.equal(sanitizeDetail("could not open /home/mathieu/dev/repo/.git/config"), "could not open <path>")
    const win = sanitizeDetail("could not open C:\\Users\\mathieu\\repo\\.git\\config")
    assert.ok(!win.includes("mathieu"), win)
    const unc = sanitizeDetail("could not open \\\\srv\\share\\repo")
    assert.ok(!unc.includes("srv"), unc)
    assert.equal(sanitizeDetail("stat ~/dev/repo failed"), "stat <path> failed")
  })

  it("replaces emails and shas", () => {
    const out = sanitizeDetail("Author mathieu.guey@gmail.com not allowed at deadbeefcafe1234")
    assert.ok(!out.includes("gmail"), out)
    assert.ok(!out.includes("deadbeef"), out)
    assert.ok(out.includes("<email>"), out)
    assert.ok(out.includes("<sha>"), out)
  })

  it("replaces quoted tokens (branch, pathspec) in both quote styles", () => {
    assert.equal(sanitizeDetail("pathspec 'clients/acme.txt' did not match"), "pathspec '<ref>' did not match")
    assert.equal(sanitizeDetail('branch "feature/acme" not found'), "branch '<ref>' not found")
  })

  it("leaves an already-clean message untouched", () => {
    assert.equal(sanitizeDetail("bad revision (exit 128)"), "bad revision (exit 128)")
    assert.equal(
      sanitizeDetail("Not possible to fast-forward, aborting. (exit 128)"),
      "Not possible to fast-forward, aborting. (exit 128)"
    )
  })

  it("does not touch relative ref paths (no leading slash)", () => {
    assert.equal(sanitizeDetail("couldn't read refs (exit 1)"), "couldn't read refs (exit 1)")
  })

  it("truncates past 300 characters", () => {
    assert.equal(sanitizeDetail("x".repeat(500)).length, 300)
  })
})

describe("isNetworkNoise (environmental failures, never captured for ops)", () => {
  it("matches every known environmental pattern, case-insensitively", () => {
    for (const line of [
      "Could not resolve host: <host>",
      "unable to access '<url>': Failed to connect",
      "Failed to connect: Connection timed out",
      "Connection refused",
      "Could not read from remote repository.",
      "No route to host",
      "Network is unreachable",
      "Operation timed out",
      "early EOF",
      "The remote end hung up unexpectedly",
    ])
      assert.equal(isNetworkNoise(line), true, line)
  })

  it("lets real failures through", () => {
    assert.equal(isNetworkNoise("bad object refs/heads/x"), false)
    assert.equal(isNetworkNoise("could not lock config file"), false)
  })
})

describe("shouldSend (session dedup)", () => {
  afterEach(() => resetDedupForTests())

  it("sends a scope×code pair once, then never again", () => {
    assert.equal(shouldSend("checkout.recovery-pop", "GIT_FAILED"), true)
    assert.equal(shouldSend("checkout.recovery-pop", "GIT_FAILED"), false)
  })

  it("treats a different scope or code as a fresh pair", () => {
    assert.equal(shouldSend("a", "GIT_FAILED"), true)
    assert.equal(shouldSend("b", "GIT_FAILED"), true)
    assert.equal(shouldSend("a", "TIMEOUT"), true)
  })

  it("resets for tests", () => {
    assert.equal(shouldSend("a", "X"), true)
    resetDedupForTests()
    assert.equal(shouldSend("a", "X"), true)
  })
})
