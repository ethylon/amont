/* Gitflow branch/merge conventions (AUDIT.md §7, phase 5). These encode the domain rules that
   drive every ref chip color and context indicator — a single wrong branch here miscolors the
   whole graph silently. `mergeColor`/`branchFlow` carry most of the branching, hence most of the
   cases below. */
import assert from "node:assert/strict"
import { describe, it } from "vitest"

import type { ParsedMerge } from "./commit-parse.ts"
import { branchFlow, mergeColor, mergeFlow, pinRank, tagFlowColor } from "./gitflow.ts"

const merge = (from: string, to: string | null = null, extra: Partial<ParsedMerge> = {}): ParsedMerge => ({
  from,
  to,
  noise: false,
  ...extra,
})

describe("pinRank", () => {
  it("ranks the integration branches in master → main → develop order", () => {
    assert.equal(pinRank("master"), 0)
    assert.equal(pinRank("main"), 1)
    assert.equal(pinRank("develop"), 2)
  })

  it("sends any other branch to the end", () => {
    assert.equal(pinRank("feature/x"), 3)
    assert.equal(pinRank(""), 3)
  })
})

describe("mergeFlow", () => {
  it("recognizes a hotfix branch, and prefers it over release", () => {
    assert.equal(mergeFlow(merge("hotfix/1.2.1")), "hotfix")
  })

  it("recognizes a release branch", () => {
    assert.equal(mergeFlow(merge("release/1.3.0")), "release")
  })

  it("treats a merged semver tag as a release (the develop side of a version)", () => {
    assert.equal(mergeFlow(merge("v1.3.0", "develop", { tag: true })), "release")
    assert.equal(mergeFlow(merge("1.3.0", "develop", { tag: true })), "release")
  })

  it("does not treat a semver-looking source as a release without the tag flag", () => {
    assert.equal(mergeFlow(merge("v1.3.0", "develop")), null)
  })

  it("returns null for an ordinary branch", () => {
    assert.equal(mergeFlow(merge("feature/login", "develop")), null)
  })
})

describe("mergeColor", () => {
  it("colors release/hotfix flows regardless of the tag or target", () => {
    assert.equal(mergeColor(merge("hotfix/1.2.1", "master", { tag: true })), "danger")
    assert.equal(mergeColor(merge("release/1.3.0", "master")), "release")
  })

  it("keeps a non-flow tag amber", () => {
    assert.equal(mergeColor(merge("some-tag", "develop", { tag: true })), "warning")
  })

  it("paints a merge into a trunk in the primary teal", () => {
    assert.equal(mergeColor(merge("feature/x", "develop")), "primary")
    assert.equal(mergeColor(merge("feature/x", "release/1.3.0")), "primary")
  })

  it("falls back to neutral for a noise merge or a non-trunk target", () => {
    assert.equal(mergeColor(merge("feature/x", "develop", { noise: true })), "neutral")
    assert.equal(mergeColor(merge("feature/x", "feature/y")), "neutral")
    assert.equal(mergeColor(merge("feature/x", null)), "neutral")
  })
})

describe("tagFlowColor", () => {
  it("is red for a hotfix, purple otherwise", () => {
    assert.equal(tagFlowColor("hotfix"), "danger")
    assert.equal(tagFlowColor("release"), "release")
    assert.equal(tagFlowColor(null), "release")
  })
})

describe("branchFlow — configured gitflow prefixes", () => {
  const prefixes = { feature: "feature/", bugfix: "bugfix/", release: "release/", hotfix: "hotfix/" }

  it("matches on the configured prefix", () => {
    assert.equal(branchFlow("feature/login", prefixes), "feature")
    assert.equal(branchFlow("hotfix/1.2.1", prefixes), "hotfix")
  })

  it("ignores an empty-string prefix rather than matching everything", () => {
    // an empty prefix would `startsWith`-match every name; it must be skipped
    assert.equal(branchFlow("random", { feature: "" }), null)
  })
})

describe("branchFlow — fallback conventions (no gitflow configured)", () => {
  it("recognizes the common feature/fix/release/hotfix conventions", () => {
    assert.equal(branchFlow("feat/x", null), "feature")
    assert.equal(branchFlow("feature/x", null), "feature")
    assert.equal(branchFlow("fix/x", null), "bugfix")
    assert.equal(branchFlow("bugfix/x", null), "bugfix")
    assert.equal(branchFlow("release/1.0.0", null), "release")
    assert.equal(branchFlow("hotfix/1.0.1", null), "hotfix")
  })

  it("returns null for a name that matches no convention", () => {
    assert.equal(branchFlow("master", null), null)
    assert.equal(branchFlow("my-branch", null), null)
  })

  it("falls back to conventions when prefixes are set but none match", () => {
    assert.equal(branchFlow("fix/x", { feature: "feature/" }), "bugfix")
  })
})
