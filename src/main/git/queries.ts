/* Read operations (AUDIT.md §4): status, working tree, log, refs, search,
   files/diff, and the two shell handles (icon, opening) confined to the repo. No
   mutation here — no mutex, same as before this refactor. */

import { readFile } from "node:fs/promises"
import { extname } from "node:path"
import { app, shell } from "electron"

import { AppError } from "../../shared/errors.ts"
import type {
  CommitMessage,
  Commit,
  ConflictFile,
  FileChange,
  GitRef,
  MergeState,
  Stash,
  Status,
  Worktree,
  WtSource,
} from "../../shared/types.ts"
import { inRepo, type RepoHandle } from "../repos.ts"
import { ALL_REFS, parseForEachRef, parseLogPage, parseNameStatus, parsePorcelain, parseStashList } from "./parse.ts"

const HASH = /^[0-9a-f]{7,64}$/ // 40 hex for sha1, 64 for sha256 object-format repos

function assertHash(hash: string, parent?: string | null): void {
  if (!HASH.test(hash) || (parent != null && !HASH.test(parent))) throw new AppError("BAD_ARG", "hash")
}

/* --- Status ---
   Current branch + divergence from its remote. No upstream or detached HEAD
   aren't errors: the renderer simply displays dashes. */
export async function repoStatus(r: RepoHandle): Promise<Status> {
  /* unborn HEAD (freshly-init repo): rev-parse fails even though nothing is wrong —
     empty status rather than a rejection, as repo:unstage already knows to do */
  const branch = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim()
  if (!branch) return { branch: null, head: null, ahead: null, behind: null }
  const head = (await r.git(["rev-parse", "HEAD"]).catch(() => "")).trim() || null
  if (branch === "HEAD") return { branch: null, head, ahead: null, behind: null }
  try {
    const [behind, ahead] = (await r.git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]))
      .trim()
      .split(/\s+/)
      .map(Number)
    return { branch, head, ahead, behind }
  } catch {
    return { branch, head, ahead: null, behind: null }
  }
}

/* --- Working tree --- */
export const worktree = (r: RepoHandle): Promise<Worktree> =>
  r.git(["status", "--porcelain=v1", "-z", "-uall"]).then(parsePorcelain)

/* --- Merge conflicts ---
   The A/B labels of the conflict view. `MERGE_HEAD` only exists during a merge: rev-parse
   failing is the normal "no merge" case, not an error. `theirs` prefers a branch name over
   a bare hash — several branches on the same tip: the first alphabetically, good enough for
   a display label. */
export async function mergeState(r: RepoHandle): Promise<MergeState> {
  const mergeHead = (await r.git(["rev-parse", "-q", "--verify", "MERGE_HEAD"]).catch(() => "")).trim()
  if (!mergeHead) return { merging: false, ours: null, theirs: null }
  const branch = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim()
  const ours = branch && branch !== "HEAD" ? branch : null
  const named = (
    await r.git(["for-each-ref", "--points-at", mergeHead, "--format=%(refname:short)", "refs/heads"]).catch(() => "")
  )
    .split("\n")
    .filter(Boolean)
  return { merging: true, ours, theirs: named[0] ?? mergeHead.slice(0, 8) }
}

/* A conflict view is a text editor: a binary or enormous file has no business there. */
const CONFLICT_MAX = 4 * 1024 * 1024

/** The three index stages of a conflicted path (1 = base, 2 = ours, 3 = theirs) plus the
    working file, markers included. `cat-file blob :N:path` embeds the path in the object
    name — starting with `:`, it can never be read as an option — and fails cleanly for a
    missing stage (delete/modify, add/add): null, the renderer says "deleted on this side". */
export async function conflict(r: RepoHandle, path: string): Promise<ConflictFile> {
  const full = inRepo(r, path) // validates and confines before anything touches git or disk
  const stage = (n: 1 | 2 | 3) => r.git(["cat-file", "blob", `:${n}:${path}`]).then(
    (o) => o,
    () => null
  )
  const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
  const merged = await readFile(full, "utf8").catch(() => "")
  if (merged.length > CONFLICT_MAX) throw new AppError("OUTPUT_LIMIT", path)
  return { base, ours, theirs, merged }
}

const WT_DIFF: Record<"staged" | "unstaged", string[]> = { staged: ["diff", "--cached"], unstaged: ["diff"] }

export function wtdiff(r: RepoHandle, path: string, source: WtSource): Promise<string> {
  if (source === "untracked") return r.diffNoIndex("/dev/null", inRepo(r, path))
  if (source !== "staged" && source !== "unstaged") throw new AppError("BAD_ARG", "source")
  return r.git([...WT_DIFF[source], "--", path])
}

/* --- Stash --- */
export const stashList = (r: RepoHandle): Promise<Stash[]> =>
  r
    .git(["stash", "list", "--format=%H%x1f%P%x1f%gd%x1f%as%x1f%an%x1f%ae%x1f%gs%x1e"])
    .catch(() => "")
    .then(parseStashList)

const stashTips = (r: RepoHandle): Promise<string[]> =>
  r
    .git(["stash", "list", "--format=%H"])
    .catch(() => "")
    .then((o) => o.split("\n").filter(Boolean))

/* --- Log ---
   `git log --skip` re-walks history from the start on every page — fine up to roughly 100k
   commits; switch to a persistent streaming spawn if that ever becomes the bottleneck. */
export async function logPage(r: RepoHandle, skip: number, count: number, signal?: AbortSignal): Promise<Commit[]> {
  /* --decorate=full: `%D` then outputs `refs/heads/x` / `refs/remotes/origin/x` / `refs/tags/x`.
     In its short form, `origin/x` and a local branch named `origin/x` are indistinguishable. */
  const out = await r.git(
    [
      "log",
      ...ALL_REFS,
      ...(await stashTips(r)),
      "--date-order",
      "--date=short",
      "--decorate=full",
      `--skip=${skip}`,
      `-n${count}`,
      "--pretty=format:%H%x1f%P%x1f%ad%x1f%an%x1f%ae%x1f%D%x1f%s%x1e",
    ],
    { signal }
  )
  return parseLogPage(out)
}

/* --- Search ---
   git ANDs `--grep` and `--author` together, so each criterion is a separate invocation and we
   take the union. `-F` makes patterns literal, `-S` searches diff content (the pickaxe).
   Capped per criterion rather than paginated — the search bar only shows a counter and jumps
   from hit to hit, so a hard cap is simpler than real pagination. */
const SEARCH_MAX = 2000
const SEARCH_TIMEOUT = 30_000

export async function searchCommits(
  r: RepoHandle,
  q: string,
  content: boolean,
  signal?: AbortSignal
): Promise<string[]> {
  const base = ["log", ...ALL_REFS, "--format=%H", `-n${SEARCH_MAX}`, "-i", "-F"]
  const runs = [r.git([...base, `--grep=${q}`], { signal }), r.git([...base, `--author=${q}`], { signal })]
  /* a hash prefix isn't a pattern: rev-parse resolves it, or fails (unknown, ambiguous) */
  if (/^[0-9a-f]{4,40}$/i.test(q))
    runs.push(r.git(["rev-parse", "--verify", "-q", `${q}^{commit}`], { signal }).catch(() => ""))
  /* the pickaxe rereads the diff of every commit: slow, so never implicit */
  if (content) runs.push(r.git([...base, `-S${q}`], { timeout: SEARCH_TIMEOUT, signal }))

  const outs = await Promise.all(runs)
  return [...new Set(outs.join("\n").split("\n").filter(Boolean))]
}

/* The count includes stash tips, same as the log. Each entry drags along 1 to 2
   plumbing commits (index, untracked) that the renderer collapses: we subtract them so that
   `total` stays the number of lines actually displayable. Deduplicated: two stashes created
   in the same second share the same index commit (same tree, same parent, same date). */
export async function total(r: RepoHandle): Promise<number> {
  const stashes = await stashList(r)
  const plumbing = new Set(stashes.flatMap((s) => s.p.slice(1)))
  const count = parseInt(await r.git(["rev-list", "--count", ...ALL_REFS, ...stashes.map((s) => s.h)]), 10)
  return count - plumbing.size
}

/* --- Refs ---
   Integration branches: never flagged as "merged", we don't clean them up. */
const TRUNK = new Set(["main", "master", "develop"])
/* One `git reflog` per candidate branch: with a bare Promise.all, 200 local branches with no
   upstream = 200 concurrent processes on every refresh. A small worker pool that drains a
   shared queue instead. */
const REFLOG_POOL = 8

export async function listRefs(r: RepoHandle): Promise<GitRef[]> {
  const out = await r.git([
    "for-each-ref",
    "--sort=refname",
    "--format=%(refname)\x1f%(HEAD)\x1f%(upstream:track,nobracket)\x1f%(symref:short)\x1f%(upstream:short)\x1f%(objectname)\x1f%(*objectname)",
    "refs/heads",
    "refs/remotes",
    "refs/tags",
  ])
  const { refs, base: symrefBase } = parseForEachRef(out)

  /* Without a remote, we fall back to convention. Without convention either, nobody is
     "merged": better to say nothing than to designate an arbitrary base. */
  const base =
    symrefBase || ["main", "master", "develop"].find((b) => refs.some((x) => x.kind === "head" && x.name === b)) || ""
  if (base) {
    /* `origin/main` → `main`; a base that's already local passes through unchanged. The
       integration branch is its own ancestor: flagging it would teach us nothing. */
    const mainline = base.slice(base.indexOf("/") + 1)
    const mergedOut = await r.git(["for-each-ref", "--merged", base, "--format=%(refname:short)", "refs/heads"])
    const merged = new Set(mergedOut.split("\n").filter(Boolean))
    /* `--merged` includes every ancestor of the base: a fresh or lagging branch, sitting on a
       trunk commit, shows up there without having "finished" anything. Its tip then sits on the
       first-parent chain of the base — just a bookmark in the history. Only a branch whose tip
       leaves the trunk (on the second-parent side of a merge) has actually been merged: we
       discard anything that points at the trunk, whether a current tip or an old commit.

       The chain walks the entire history and the refs are reread on every refresh:
       we cache it as long as the base's tip hasn't moved. */
    const baseTip = (await r.git(["rev-parse", base])).trim()
    if (r.trunk?.key !== `${base} ${baseTip}`) {
      const chain = (await r.git(["rev-list", "--first-parent", base])).split("\n").filter(Boolean)
      r.trunk = { key: `${base} ${baseTip}`, set: new Set(chain) }
    }
    const trunk = r.trunk.set
    for (const ref of refs)
      ref.merged =
        ref.kind === "head" &&
        ref.name !== mainline &&
        !TRUNK.has(ref.name) &&
        !trunk.has(ref.tip) &&
        merged.has(ref.name)
  }
  /* the graph interns full SHAs into integer ids at ingestion (fix B1): the tip travels
     as-is, no truncation here — `merged` already uses it as-is right above */

  /* A tracked branch reports `gone` on its own. Without an upstream — pushed without `-u`, or
     config never set — the remote deletion takes down even the reflog of `refs/remotes/…`: all
     that's left is the local reflog, where `branch: Created from origin/x` attests to the past
     link. A branch born locally never mentions its own remote name there, and so isn't flagged.

     A reflog expired by gc (90 days) makes such a branch indistinguishable from a purely local
     one — a known limitation of this heuristic, not something more code can fix (no other
     persistent state records the original tracking relationship). */
  const remoteRefs = refs.filter((x) => x.kind === "remote").map((x) => x.name)
  const present = new Set(remoteRefs.map((n) => n.slice(n.indexOf("/") + 1)))
  const remoteNames = [...new Set(remoteRefs.map((n) => n.slice(0, n.indexOf("/"))))]

  const candidates: GitRef[] = remoteNames.length
    ? refs.filter((ref) => ref.kind === "head" && !ref.gone && !present.has(ref.name))
    : []
  await Promise.all(
    Array.from({ length: Math.min(REFLOG_POOL, candidates.length) }, async () => {
      for (let ref: GitRef | undefined; (ref = candidates.shift()) !== undefined;) {
        const reflog = await r.git(["reflog", "show", "--format=%gs", ref.name]).catch(() => "")
        ref.gone = remoteNames.some((remote) => reflog.includes(`${remote}/${ref.name}`))
      }
    })
  )
  return refs
}

/* --- Files / diff --- */

/* Files touched. For a merge, the renderer passes the first-parent:
   the diff shows what the merge brought onto the target branch. */
export function files(r: RepoHandle, hash: string, parent: string | null, signal?: AbortSignal): Promise<FileChange[]> {
  assertHash(hash, parent)
  const args = parent
    ? ["diff", "--name-status", "-z", parent, hash]
    : ["diff-tree", "-r", "--root", "--no-commit-id", "--name-status", "-z", hash]
  return r.git(args, { signal }).then(parseNameStatus)
}

/* Message body, on demand. Joining it to the log would cost, just to display one,
   a copy of every long message in the history. */
export function body(r: RepoHandle, hash: string, signal?: AbortSignal): Promise<string> {
  assertHash(hash)
  return r.git(["show", "-s", "--format=%b", hash], { signal })
}

/* Subject and body of the last commit, to prefill an amend. `%B` is the raw message:
   the first line is the subject, the rest (after the blank line) is the description. */
export async function headMessage(r: RepoHandle): Promise<CommitMessage> {
  const raw = await r.git(["show", "-s", "--format=%B", "HEAD"])
  const nl = raw.indexOf("\n")
  const subject = (nl < 0 ? raw : raw.slice(0, nl)).trim()
  const body_ = (nl < 0 ? "" : raw.slice(nl + 1)).replace(/^\n+/, "").trimEnd()
  return { subject, body: body_ }
}

export function diff(
  r: RepoHandle,
  hash: string,
  parent: string | null,
  path: string,
  oldPath: string | null,
  signal?: AbortSignal
): Promise<string> {
  assertHash(hash, parent)
  if (typeof path !== "string" || (oldPath != null && typeof oldPath !== "string"))
    throw new AppError("BAD_ARG", "path")
  const paths = oldPath ? [oldPath, path] : [path]
  const args = parent ? ["diff", parent, hash, "--", ...paths] : ["show", "--format=", hash, "--", ...paths]
  return r.git(args, { signal })
}

/* --- Shell: icon and opening ---
   Windows icon of the file. Missing from disk (deleted, old commit): the renderer falls back
   to its generic icon. */
export function fileIcon(r: RepoHandle, path: string): Promise<string | null> {
  return app.getFileIcon(inRepo(r, path), { size: "small" }).then(
    (i) => i.toDataURL(),
    () => null
  )
}

/* Extensions Windows executes on double-click (default or near-universal association): a hostile
   cloned repo containing one would turn `repo:openFile` into native execution. Denylist by
   extension — defense in depth, not a guarantee; it covers neither third-party handlers
   registered on other extensions nor content whose real type doesn't match its extension. For a
   blocked extension, the file is revealed in the file explorer instead of failing silently
   (AUDIT.md §2, misc). */
const BLOCKED_EXT = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".scr",
  ".msi",
  ".msp",
  ".ps1",
  ".ps1xml",
  ".vbs",
  ".vbe",
  ".js",
  ".jse",
  ".wsf",
  ".wsh",
  ".msc",
  ".cpl",
  ".jar",
  ".pif",
  ".reg",
  ".lnk",
  ".hta",
  ".gadget",
  ".application",
  ".ws",
])

export function openFile(r: RepoHandle, path: string): Promise<string> {
  const full = inRepo(r, path)
  if (BLOCKED_EXT.has(extname(full).toLowerCase())) {
    shell.showItemInFolder(full)
    return Promise.resolve("")
  }
  return shell.openPath(full)
}
