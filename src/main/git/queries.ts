/* Read operations (AUDIT.md §4): status, working tree, log, refs, search,
   files/diff, and the two shell handles (icon, opening) confined to the repo. No
   mutation here — no mutex, same as before this refactor. */

import { readFile, stat } from "node:fs/promises"
import { extname, resolve } from "node:path"
import { app, shell } from "electron"

import { truncateDiff } from "../../shared/diff.ts"
import { AppError } from "../../shared/errors.ts"
import type {
  BlobData,
  BlobRef,
  CommitMessage,
  Commit,
  ConflictFile,
  DiffText,
  FileChange,
  GitRef,
  MergeState,
  Stash,
  Status,
  Worktree,
  WorktreeInfo,
  WtSource,
} from "../../shared/types.ts"
import { inRepo, type RepoHandle } from "../repos.ts"
import { refTips } from "./ops.ts"
import {
  ALL_REFS,
  hashListCount,
  hashListSlice,
  parseForEachRef,
  parseLogPage,
  parseNameStatus,
  parsePorcelain,
  parseStashList,
  parseWorktreeList,
} from "./parse.ts"

const HASH = /^[0-9a-f]{7,64}$/ // 40 hex for sha1, 64 for sha256 object-format repos

function assertHash(hash: string, parent?: string | null): void {
  if (!HASH.test(hash) || (parent != null && !HASH.test(parent))) throw new AppError("BAD_ARG", "hash")
}

/* --- Status ---
   Current branch + divergence from its remote. No upstream or detached HEAD
   aren't errors: the renderer simply displays dashes. */
export async function repoStatus(r: RepoHandle): Promise<Status> {
  /* Three independent reads, in parallel rather than chained: this runs after every mutation
     and on every `git:changed`, so the serial fork/exec chain was pure latency. Each read
     carries its own fallback — an unborn HEAD (freshly-init repo) makes both rev-parses fail
     even though nothing is wrong (as repo:unstage already knows), and no upstream or a
     detached HEAD makes the rev-list fail: empty fields rather than a rejection. */
  const [branch, head, counts] = await Promise.all([
    r.git(["rev-parse", "--abbrev-ref", "HEAD"]).then(
      (o) => o.trim(),
      () => ""
    ),
    r.git(["rev-parse", "HEAD"]).then(
      (o) => o.trim(),
      () => ""
    ),
    /* left side of `@{upstream}...HEAD` = commits only upstream has = behind */
    r.git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).then(
      (o) => o.trim().split(/\s+/).map(Number),
      () => null
    ),
  ])
  if (!branch || branch === "HEAD") return { branch: null, head: head || null, ahead: null, behind: null }
  return { branch, head: head || null, ahead: counts?.[1] ?? null, behind: counts?.[0] ?? null }
}

/* --- Working tree --- */
export const worktree = (r: RepoHandle): Promise<Worktree> =>
  r.git(["status", "--porcelain=v1", "-z", "-uall"]).then(parsePorcelain)

/* --- Linked worktrees ---
   Git prints forward-slash paths even on Windows: `resolve()` brings them back to platform
   separators so the renderer can compare them to `Repo.path` as-is. The comparison is
   case-insensitive on Windows — two spellings of the same folder are the same worktree. */
export const sameWtPath = (a: string, b: string): boolean =>
  process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b

export async function worktrees(r: RepoHandle): Promise<WorktreeInfo[]> {
  const out = await r.git(["worktree", "list", "--porcelain", "-z"])
  const self = resolve(r.path)
  return parseWorktreeList(out).map((w, i) => {
    const path = resolve(w.path)
    return { ...w, path, main: i === 0, current: sameWtPath(path, self) }
  })
}

/** The entry of `git worktree list` matching `path`, or NOT_ALLOWED: the only gate through
    which a renderer-supplied worktree path may reach an open/reveal/remove. */
export async function resolveWorktree(r: RepoHandle, path: unknown): Promise<WorktreeInfo> {
  if (typeof path !== "string" || !path) throw new AppError("BAD_ARG", "path")
  const list = await worktrees(r)
  const target = resolve(path)
  const wt = list.find((w) => sameWtPath(w.path, target))
  if (!wt) throw new AppError("NOT_ALLOWED", path)
  return wt
}

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
  const stage = (n: 1 | 2 | 3) =>
    r.git(["cat-file", "blob", `:${n}:${path}`]).then(
      (o) => o,
      () => null
    )
  const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)])
  /* size gate BEFORE the read, like blob(): an over-cap file never has its bytes pulled into
     memory just to be rejected. Missing from disk (delete/delete) reads as empty, as before. */
  const size = (await stat(full).catch(() => null))?.size ?? 0
  if (size > CONFLICT_MAX) throw new AppError("OUTPUT_LIMIT", path)
  const merged = await readFile(full, "utf8").catch(() => "")
  return { base, ours, theirs, merged }
}

const WT_DIFF: Record<"staged" | "unstaged", string[]> = { staged: ["diff", "--cached"], unstaged: ["diff"] }

/* Both diff channels cap their payload right after the git call (truncateDiff, shared/diff.ts):
   the renderer shows at most DIFF_MAX_LINES lines, so shipping up to the 64 MB OUTPUT_CAP
   across IPC was pure structured-clone weight — the `{text, totalLines}` shape keeps its
   "N more lines" footer exact without the full text ever leaving this process. */
export function wtdiff(r: RepoHandle, path: string, source: WtSource): Promise<DiffText> {
  if (source === "untracked") return r.diffNoIndex("/dev/null", inRepo(r, path)).then(truncateDiff)
  if (source !== "staged" && source !== "unstaged") throw new AppError("BAD_ARG", "source")
  return r.git([...WT_DIFF[source], "--", path]).then(truncateDiff)
}

/* --- Stash --- */
export const stashList = (r: RepoHandle): Promise<Stash[]> =>
  r
    .git(["stash", "list", "--format=%H%x1f%P%x1f%gd%x1f%as%x1f%an%x1f%ae%x1f%gs%x1e"])
    .catch(() => "")
    .then(parseStashList)

/* `git stash list` walks the whole stash reflog: cached for one change-generation
   (watcher.ts bumps `gen` on every observed .git change, mute() after each of our own
   mutations) — logPage/total used to re-spawn it on every page, a serial fork/exec tax on
   the hottest read path. The promise never rejects (stashList catches into an empty list),
   so a cached failure can't get stuck. */
function cachedStashes(r: RepoHandle): Promise<Stash[]> {
  if (r.stashCache?.gen !== r.gen) r.stashCache = { gen: r.gen, list: stashList(r) }
  return r.stashCache.list
}

/* --- Log ---
   `git log --skip=N` used to re-walk (and `--date-order` re-sort) the whole history from the
   tips on every page: O(history) per page, the exact bottleneck the old comment here
   predicted. Instead, the ordered hash list of the entire graph is materialized ONCE per
   tips snapshot (`rev-list --date-order` over the same refs+stash tips), cached on the
   RepoHandle like `trunk`, and every page is a byte-range slice of it fed to
   `git log --no-walk=unsorted --stdin` — page cost no longer depends on where the page sits
   in history. Same traversal, same roots: the order is bit-identical to the old command. */
/** Fingerprint of everything the graph displays: HEAD + ref tips + stash list. One snapshot,
    two consumers — `orderedHashes` keys its cached hash list on it, and the watcher's
    `emitChanged` gate (watcher.ts, injected through repos.ts `setGraphKey`) compares it
    before waking the renderer: a .git write that leaves this key unchanged (gc rewriting
    packed-refs, a reflog touch) reloads nothing. */
async function graphSnapshot(r: RepoHandle): Promise<{ key: string; stashes: Stash[] }> {
  /* HEAD belongs in the key: `--all` walks it too, and on a detached HEAD (tag checkout,
     bisect, rebase stop) a new commit moves no branch/tag/stash tip — without HEAD in the
     snapshot the stale list would be served until some unrelated ref moved. */
  const [tips, stashes, head] = await Promise.all([
    refTips(r),
    cachedStashes(r),
    r.git(["rev-parse", "HEAD"]).catch(() => ""), // unborn repo: no HEAD commit yet
  ])
  return { key: [head.trim(), ...tips, ...stashes.map((s) => s.h)].join(" "), stashes }
}

export const graphSnapshotKey = (r: RepoHandle): Promise<string> => graphSnapshot(r).then((s) => s.key)

async function orderedHashes(r: RepoHandle): Promise<{ hashes: string; stashes: Stash[] }> {
  const { key, stashes } = await graphSnapshot(r)
  let entry = r.logIndex
  if (entry?.key !== key) {
    /* no caller signal on the build: the list is shared by every page in flight, and a
       cancelled page must not kill the walk its siblings are waiting on (closeRepo still
       reaps it through the children set). A failed build — timeout, repo gone mid-read —
       drops the entry so the next call retries instead of replaying the rejection. */
    const fresh: NonNullable<RepoHandle["logIndex"]> = {
      key,
      hashes: r.git(["rev-list", "--date-order", ...ALL_REFS, ...stashes.map((s) => s.h)]).catch((e: unknown) => {
        if (r.logIndex === fresh) r.logIndex = null
        throw e
      }),
    }
    r.logIndex = entry = fresh
  }
  return { hashes: await entry.hashes, stashes }
}

export async function logPage(r: RepoHandle, skip: number, count: number, signal?: AbortSignal): Promise<Commit[]> {
  const page = hashListSlice((await orderedHashes(r)).hashes, skip, count)
  /* a blank page must never reach `git log --stdin`: with nothing on stdin, git falls back
     to the default HEAD revision and would resurrect commits out of thin air */
  if (!page) return []
  /* --decorate=full: `%D` then outputs `refs/heads/x` / `refs/remotes/origin/x` / `refs/tags/x`.
     In its short form, `origin/x` and a local branch named `origin/x` are indistinguishable.
     Decorations are re-read here on every page, so the cached hash order never serves a
     stale ref name — only tips (which key the cache) affect the order itself. */
  const out = await r.git(
    [
      "log",
      "--no-walk=unsorted", // keep the slice's order; git would otherwise re-sort by date
      "--stdin",
      "--date=short",
      "--decorate=full",
      "--pretty=format:%H%x1f%P%x1f%ad%x1f%an%x1f%ae%x1f%D%x1f%s%x1e",
    ],
    { signal, input: page }
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
   in the same second share the same index commit (same tree, same parent, same date).
   Derived from the same cached hash list as logPage — the `rev-list --count` full-history
   walk this used to spawn on every `git:changed` is now O(1) once the list is built. */
export async function total(r: RepoHandle): Promise<number> {
  const { hashes, stashes } = await orderedHashes(r)
  const plumbing = new Set(stashes.flatMap((s) => s.p.slice(1)))
  return hashListCount(hashes) - plumbing.size
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

  /* The verdict only depends on the branch's own reflog (which only grows when its tip
     moves) and on the remote names it's matched against: cached per (branch, tip), reset
     wholesale when the remote set changes. 150 stale branches used to cost 150 spawns on
     every refresh; now only the branches whose tip actually moved are re-probed. Entries
     for deleted branches linger in the map — bounded by branch-name count, not worth
     sweeping. (A reflog expired by gc can flip a cached verdict without moving the tip —
     the same staleness the heuristic above already accepts for its 90-day window.) */
  if (r.goneCache?.remotes !== remoteNames.join(" "))
    r.goneCache = { remotes: remoteNames.join(" "), verdicts: new Map() }
  const verdicts = r.goneCache.verdicts

  const candidates: GitRef[] = remoteNames.length
    ? refs.filter((ref) => {
        if (ref.kind !== "head" || ref.gone || present.has(ref.name)) return false
        const known = verdicts.get(ref.name)
        if (known && known.tip === ref.tip) {
          ref.gone = known.gone
          return false
        }
        return true
      })
    : []
  await Promise.all(
    Array.from({ length: Math.min(REFLOG_POOL, candidates.length) }, async () => {
      for (let ref: GitRef | undefined; (ref = candidates.shift()) !== undefined;) {
        const reflog = await r.git(["reflog", "show", "--format=%gs", ref.name]).catch(() => "")
        ref.gone = remoteNames.some((remote) => reflog.includes(`${remote}/${ref.name}`))
        verdicts.set(ref.name, { tip: ref.tip, gone: ref.gone })
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

/* Truncated main-side like wtdiff (cf. the comment there): the abort/timeout/output-cap
   plumbing of the git call itself is untouched — truncateDiff only trims what crosses IPC. */
export function diff(
  r: RepoHandle,
  hash: string,
  parent: string | null,
  path: string,
  oldPath: string | null,
  signal?: AbortSignal
): Promise<DiffText> {
  assertHash(hash, parent)
  if (typeof path !== "string" || (oldPath != null && typeof oldPath !== "string"))
    throw new AppError("BAD_ARG", "path")
  const paths = oldPath ? [oldPath, path] : [path]
  const args = parent ? ["diff", parent, hash, "--", ...paths] : ["show", "--format=", hash, "--", ...paths]
  return r.git(args, { signal }).then(truncateDiff)
}

/* --- Binary preview (image viewer) ---
   diff2html can only render text; a binary path (png, gif, an image…) collapses to git's
   "Binary files differ" line. `blob` ships the raw bytes of one side of the change so the
   renderer can show a real preview. The Buffer travels as-is — Electron's structured clone
   carries it as binary; the old base64 re-encode built a ~33 MB string on the main thread
   for a 25 MB image, blocking every other IPC handler while it serialized (audit finding
   9a). `cat-file -s` gates on size first: an over-cap or absent object never has its bytes
   read into memory. */
const BLOB_MAX = 25 * 1024 * 1024

/** A rev accepted in a `<rev>:<path>` object spec: a commit hash, or the literal `HEAD` (the
    "before" side of a staged working-tree change). Nothing else — the spec never reaches a shell,
    but keeping the surface tight is cheap. */
function assertRev(rev: string): string {
  if (rev !== "HEAD" && !HASH.test(rev)) throw new AppError("BAD_ARG", "rev")
  return rev
}

export async function blob(r: RepoHandle, path: string, ref: BlobRef): Promise<BlobData | null> {
  if (typeof path !== "string" || !path) throw new AppError("BAD_ARG", "path")

  if (ref.kind === "worktree") {
    const full = inRepo(r, path) // confines to the repo (symlink-safe) before touching disk
    let size: number
    try {
      size = (await stat(full)).size
    } catch {
      return null // gone from disk (staged deletion still shown as a working-tree row)
    }
    if (size > BLOB_MAX) return { size, bytes: null }
    const buf = await readFile(full).catch(() => null)
    return buf ? { size, bytes: buf } : null
  }

  /* `:path` = the staged blob; `<rev>:path` = a committed one. A missing side (added file has
     no parent blob, deleted file no child) makes cat-file exit non-zero → we surface it as null. */
  const spec = ref.kind === "index" ? `:${path}` : `${assertRev(ref.rev)}:${path}`
  let size: number
  try {
    size = parseInt((await r.git(["cat-file", "-s", spec])).trim(), 10)
  } catch {
    return null
  }
  if (!Number.isFinite(size)) return null
  if (size > BLOB_MAX) return { size, bytes: null }
  const buf = await r.gitBuffer(["cat-file", "blob", spec])
  return { size, bytes: buf }
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
