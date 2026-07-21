/* Pure parsers for git output — zero Electron import, zero `spawn` call: runnable under
   Node as-is, this is the unit-test surface of the main workstream (AUDIT.md §4/§10, item 6).
   Every function here takes a string (or already-extracted fields) and returns data;
   the git calls that produce these strings live in queries.ts / ops.ts / flow.ts. */

import type {
  Commit,
  CountObjects,
  FileChange,
  FlowInitConfig,
  FlowPrefixes,
  GitRef,
  Stash,
  Worktree,
  WorktreeInfo,
} from "../../shared/types.ts"
import type { ErrorPayload } from "../../shared/errors.ts"

/* --- Working tree ---
   `status --porcelain=v1 -z`: each entry is `XY<space>path`, X = index, Y = tree.
   For a rename, the old path occupies the next NUL field — hence the ++i. */
const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])

export function parsePorcelain(out: string): Worktree {
  const parts = out.split("\0")
  const wt: Worktree = { staged: [], unstaged: [], untracked: [], conflicts: [] }
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (e.length < 4) continue
    const x = e[0],
      y = e[1],
      path = e.slice(3)
    if (x === "?") {
      wt.untracked.push({ st: "?", path })
      continue
    }
    if (CONFLICT.has(x + y)) {
      wt.conflicts.push({ st: x + y, path })
      continue
    }
    const old = x === "R" || x === "C" ? parts[++i] : null
    if (x !== " ") wt.staged.push({ st: x, path, old })
    if (y !== " ") wt.unstaged.push({ st: y, path })
  }
  return wt
}

/* Parser for `--name-status -z` (fix B3), the only safe format: without `-z`, git C-quotes
   non-ASCII paths (`"caf\303\251.txt"`) and a name containing a tab or newline breaks a
   split('\n')/split('\t'). With `-z`, each field is NUL-terminated and paths come out raw.
   A rename/copy occupies three fields: `Rnn NUL old NUL new NUL`. */
export function parseNameStatus(out: string): FileChange[] {
  const files: FileChange[] = []
  const parts = out.split("\0") // trailing NUL: last element is empty, never consumed as a status
  for (let i = 0; i < parts.length - 1;) {
    const st = parts[i++]
    if (!st) break
    /* R and C carry a similarity score (R100) and one extra field: the old path */
    const old = st[0] === "R" || st[0] === "C" ? parts[i++] : null
    const path = parts[i++]
    if (path === undefined) break // truncated output: return what's complete
    files.push({ st: st[0], path, old })
  }
  return files
}

/* --- Linked worktrees ---
   `worktree list --porcelain -z`: one NUL-terminated attribute line per field, an empty
   field closes the entry. `-z` keeps a path containing a newline intact — the LF format
   would split it. The first entry is always the main worktree; a bare one (no working
   tree to display or open) is dropped. `locked`/`prunable` may carry a reason after a
   space: only the presence matters here. `path`/`main`/`current` are finalized by the
   caller (queries.ts), which knows the platform and the repo asking. */
export function parseWorktreeList(out: string): Omit<WorktreeInfo, "main" | "current">[] {
  const list: Omit<WorktreeInfo, "main" | "current">[] = []
  let wt: { path: string; head: string; branch: string | null; bare: boolean; locked: boolean; prunable: boolean } = {
    path: "",
    head: "",
    branch: null,
    bare: false,
    locked: false,
    prunable: false,
  }
  const flush = () => {
    if (wt.path && !wt.bare)
      list.push({ path: wt.path, head: wt.head, branch: wt.branch, locked: wt.locked, prunable: wt.prunable })
    wt = { path: "", head: "", branch: null, bare: false, locked: false, prunable: false }
  }
  for (const line of out.split("\0")) {
    if (!line) {
      flush()
      continue
    }
    const sp = line.indexOf(" ")
    const key = sp < 0 ? line : line.slice(0, sp)
    const value = sp < 0 ? "" : line.slice(sp + 1)
    if (key === "worktree") wt.path = value
    else if (key === "HEAD") wt.head = value
    else if (key === "branch") wt.branch = value.replace(/^refs\/heads\//, "")
    else if (key === "bare") wt.bare = true
    else if (key === "locked") wt.locked = true
    else if (key === "prunable") wt.prunable = true
  }
  flush() // truncated output without the final terminator: keep what's complete
  return list
}

/* --- Stash --- */
export function parseStashList(out: string): Stash[] {
  return out
    .split("\x1e")
    .map((row) => row.split("\x1f"))
    .filter((f) => f.length >= 7)
    .map((f) => ({
      h: f[0].trim(),
      p: f[1].split(" ").filter(Boolean),
      name: f[2],
      d: f[3],
      a: f[4],
      e: f[5],
      s: f.slice(6).join(" "),
    }))
}

/* --- Log ---
   Full SHAs (fix B1, AUDIT.md §2): a hash truncated to 8 characters statistically
   guarantees collisions past a few tens of thousands of commits — the renderer interns
   these SHAs into sequential integer ids at ingestion (cf. features/graph/ids.ts),
   8-character truncation becomes a display-only concern again. */

/* A git trailer line (`Co-Authored-By: x`, `Signed-off-by: y`): the shape git's own
   interpret-trailers recognizes. Matched per line, only to detect a paragraph made of
   nothing else — a real sentence starting with `Note: ` shouldn't be censored. */
const TRAILER = /^[A-Za-z][A-Za-z0-9-]*:\s/

/** One display line out of a raw `%b`: the first paragraph, flattened. The graph row offers
    a single line of leftover width, so the lead paragraph — the summary by convention — is
    the whole story; a paragraph that is only trailers (a body reduced to its
    `Co-Authored-By:` block) says nothing and yields "". Capped: the page result crosses
    IPC, and a row will never show hundreds of characters anyway. */
export function commitDescription(body: string): string {
  const lines = (body.trim().split(/\n\s*\n/)[0] ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  if (lines.every((l) => TRAILER.test(l))) return "" // covers the empty body too
  return lines.join(" ").slice(0, 300)
}

export function parseLogPage(out: string): Commit[] {
  /* git doesn't filter control bytes out of `%s`/`%b`: a subject containing our separators
     would manufacture extra fields (reattached to the subject — the body stays last) or
     lopsided lines (discarded by the field count check). The body's own newlines are safe:
     records split on RS, never on `\n`. */
  return out
    .split("\x1e")
    .map((row) => row.split("\x1f"))
    .filter((f) => f.length >= 8)
    .map((f) => {
      const b = commitDescription(f[f.length - 1])
      return {
        h: f[0].trim(),
        p: f[1].split(" ").filter(Boolean),
        d: f[2],
        a: f[3],
        e: f[4],
        r: f[5],
        s: f.slice(6, -1).join(" "),
        ...(b && { b }),
      }
    })
}

/* --- Ordered hash list (log pagination) ---
   `rev-list` output is fixed-width: every hash of a given repo has the same length (40 hex
   for sha1, 64 for sha256 object-format repos) plus its `\n`. Pages are byte-range slices of
   the one big string — deliberately NOT split into a per-commit array, cf. the `logIndex`
   comment on RepoHandle (repos.ts). */

/** Number of hashes in a `rev-list` output ("" = empty repo). */
export function hashListCount(list: string): number {
  if (!list) return 0
  const nl = list.indexOf("\n")
  /* defensive: a single hash without a trailing newline still counts as one line */
  return nl < 0 ? 1 : Math.ceil(list.length / (nl + 1))
}

/** The page [skip, skip+count) of a `rev-list` output: whole `\n`-terminated hashes, ready
    to feed back to `git log --stdin`. Empty when `skip` is past the end. */
export function hashListSlice(list: string, skip: number, count: number): string {
  if (!list) return ""
  const nl = list.indexOf("\n")
  const width = nl < 0 ? list.length : nl + 1
  return list.slice(skip * width, (skip + count) * width)
}

/* --- Refs ---
   `origin/HEAD` is a display alias: it would duplicate the remote's default branch — we
   strip it from the array and grab its symref for the merge/gone calculation. */
const REF_KINDS: [string, GitRef["kind"]][] = [
  ["refs/heads/", "head"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"],
]

export interface ParsedRefs {
  refs: GitRef[]
  /** symref of `<remote>/HEAD` (short form, e.g. "origin/master"), empty if no remote */
  base: string
}

export function parseForEachRef(out: string): ParsedRefs {
  let base = ""
  const refs: GitRef[] = out
    .split("\n")
    .filter(Boolean)
    .flatMap((line): GitRef[] => {
      const [refname, head, track = "", symref = "", upstream = "", oid = "", peeled = ""] = line.split("\x1f")
      /* `%(*objectname)` peels an annotated tag to its commit; empty for a branch or lightweight tag */
      const tip = peeled || oid
      const kind = REF_KINDS.find(([prefix]) => refname.startsWith(prefix))
      if (!kind) return []
      const name = refname.slice(kind[0].length)
      if (kind[1] === "remote" && name.endsWith("/HEAD")) {
        base ||= symref
        return []
      }
      const ahead = /ahead (\d+)/.exec(track)
      const behind = /behind (\d+)/.exec(track)
      return [
        {
          name,
          kind: kind[1],
          head: head === "*",
          upstream,
          ahead: ahead ? +ahead[1] : 0,
          behind: behind ? +behind[1] : 0,
          merged: false,
          gone: track === "gone",
          tip,
        },
      ]
    })
  return { refs, base }
}

/* `--all` pulls in `refs/stash`, whose plumbing commits ("On x", "index on x",
   "untracked files on x") have no business in the graph. `--exclude` applies to the
   `--all` that follows. Shared by git/queries.ts (log, search, total) and git/ops.ts
   (counting new commits after fetch). */
export const ALL_REFS = ["--exclude=refs/stash", "--all"]

/* --- Branch name validation ---
   Safety filter, not a refname parser — mainly rejects a name starting with `-` that would pass
   itself off as a git option (fix B2). Blacklist rather than whitelist: `[\w./+-]` would reject
   accented letters and `@`, both legal in a refname. */
// eslint-disable-next-line no-control-regex -- \x00-\x20 deliberately rejects control/unprintable bytes, mirroring git's own refname rules
export const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[^\x00-\x20\x7f~^:?*[\\]+$/

/** Commit-hash validation: 40 hex for sha1, 64 for sha256 object-format repos (a 7+ prefix
    is accepted — some callers pass abbreviated revs). */
export const HASH = /^[0-9a-f]{7,64}$/

/* --- Git failures (fix: preserves the exit code, inspects stdout) ---
   git drowns its errors under `hint:` lines: we only keep fatal:/error:. A conflict
   (merge, or a stash pop replaying a merge) is announced by `CONFLICT (...)` lines — on
   STDOUT, never stderr, hence the old bug (gitError only read stderr and lost this
   signal, cf. AUDIT.md §2 B4/misc). */
const CONFLICT_LINE = /^CONFLICT \([^)]*\):.*? in (.+)$/gm

export interface GitFailureInput {
  exitCode: number | null
  stdout: string
  stderr: string
  killedBy: "timeout" | "abort" | "limit" | null
}

export function classifyGitFailure(input: GitFailureInput): ErrorPayload {
  if (input.killedBy === "timeout") return { code: "TIMEOUT" }
  if (input.killedBy === "abort") return { code: "ABORTED" }
  if (input.killedBy === "limit") return { code: "OUTPUT_LIMIT" }

  const files = [...`${input.stdout}\n${input.stderr}`.matchAll(CONFLICT_LINE)].map((m) => m[1])
  if (files.length) return { code: "MERGE_CONFLICT", detail: files.join(", ") }

  const lines = (input.stderr || input.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
  const fatal = lines.filter((l) => /^(fatal|error):/.test(l)).slice(0, 2)
  const msg = (fatal.length ? fatal : lines.slice(-1)).map((l) => l.replace(/^(fatal|error):\s*/, "")).join(" — ")
  const detail = input.exitCode == null ? msg : `${msg} (exit ${input.exitCode})`
  return { code: "GIT_FAILED", detail: detail || undefined }
}

/* --- Git-flow ---
   Prefixes set by `git flow init`, read from `git config --get-regexp ^gitflow\.prefix\.`. */
export function parseFlowPrefixes(out: string): FlowPrefixes {
  const prefixes: FlowPrefixes = {}
  for (const line of out.split("\n").filter(Boolean)) {
    const [key, value = ""] = line.split(" ")
    const kind = key.slice("gitflow.prefix.".length)
    if (kind === "feature" || kind === "bugfix" || kind === "release" || kind === "hotfix") prefixes[kind] = value
  }
  return prefixes
}

const SEMVER_RE = /^v?\d+\.\d+\.\d+/

/** Version suffix of a flow branch: the name minus its prefix, or empty if the result
    would start with `-` (same guard as `finish`, fix B2: `feature/-D` must never be read
    as a version). */
export function flowVersionSuffix(branch: string, prefix: string): string {
  const raw = branch.startsWith(prefix) ? branch.slice(prefix.length) : ""
  return raw.startsWith("-") ? "" : raw
}

/** The tag that `finish` will create: the version carried by the branch name if it has
    one (gitflow convention, "release/4.2.0"), otherwise a bump of the last tag — patch for a
    hotfix, minor for a release. `null` if neither gives a lead. */
export function computeNextTag(kind: "release" | "hotfix", suffix: string, lastTag: string | null): string | null {
  if (SEMVER_RE.test(suffix)) return suffix
  const m = lastTag && /^(v?)(\d+)\.(\d+)\.(\d+)/.exec(lastTag)
  if (!m) return null
  return kind === "hotfix" ? `${m[1]}${m[2]}.${m[3]}.${+m[4] + 1}` : `${m[1]}${m[2]}.${+m[3] + 1}.0`
}

/** The `gitflow.*` key/value pairs `flowInit` writes. A stable order,
    trunk branches first, so the config is deterministic (and the test can assert it). */
export function flowInitConfigArgs(cfg: FlowInitConfig): [string, string][] {
  return [
    ["gitflow.branch.master", cfg.master],
    ["gitflow.branch.develop", cfg.develop],
    ["gitflow.prefix.feature", cfg.feature],
    ["gitflow.prefix.bugfix", cfg.bugfix],
    ["gitflow.prefix.release", cfg.release],
    ["gitflow.prefix.hotfix", cfg.hotfix],
    ["gitflow.prefix.support", cfg.support],
    ["gitflow.prefix.versiontag", cfg.versiontag],
  ]
}

/* --- Merge preview ---
   Output of `git merge-tree --write-tree --no-messages --name-only <a> <b>`: the written
   tree's OID on the first line, then — on a conflicted merge (exit 1) — one conflicted path
   per line. `--name-only` already deduplicates; the dedup here only guards against a future
   git dropping it. */
export function parseMergeTree(out: string): { tree: string; files: string[] } {
  const lines = out.split("\n").filter(Boolean)
  return { tree: lines[0]?.trim() ?? "", files: [...new Set(lines.slice(1))] }
}

/* --- Maintenance ---
   git rewrites its progress on a single line with `\r` ("Counting objects:  45% (90/200)"); a
   determinate percentage is the last `NN%` in a chunk. `null` for a phase git reports without a
   percentage (the footer then falls back to an indeterminate spinner). */
export function parseProgressPercent(line: string): number | null {
  const matches = line.match(/(\d+)%/g)
  if (!matches) return null
  const n = parseInt(matches[matches.length - 1], 10)
  return n >= 0 && n <= 100 ? n : null
}

/** Parse `git count-objects -vH`: `key: value` lines. Counts become numbers; sizes stay the
    human-readable strings `-H` emits ("48.00 KiB") — the maintenance modal only displays them. */
export function parseCountObjects(out: string): CountObjects {
  const map = new Map<string, string>()
  for (const line of out.split("\n")) {
    const idx = line.indexOf(":")
    if (idx < 0) continue
    map.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim())
  }
  const num = (k: string): number => {
    const v = parseInt(map.get(k) ?? "", 10)
    return Number.isFinite(v) ? v : 0
  }
  return {
    count: num("count"),
    size: map.get("size") ?? "0",
    inPack: num("in-pack"),
    packs: num("packs"),
    sizePack: map.get("size-pack") ?? "0",
    prunePackable: num("prune-packable"),
    garbage: num("garbage"),
    sizeGarbage: map.get("size-garbage") ?? "0",
  }
}
