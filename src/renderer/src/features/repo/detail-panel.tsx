import { useQuery } from "@tanstack/react-query"
import { HugeiconsIcon } from "@hugeicons/react"
import { CloudIcon } from "@hugeicons/core-free-icons"

import type { Commit, FileChange, RepoApi } from "@/lib/git"
import { parseBody, parseRefs, parseSubject, refColor, typeColor, typeIcon, type RefChip } from "@/lib/commit-parse"
import { parseMarkdown, type MdToken } from "@/lib/markdown"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { useBodyQuery } from "@/features/repo/repo-queries"
import type { SelMode } from "@/features/repo/repo-store"
import { cn } from "@/lib/utils"
import type { ChainInfo, GraphHandle } from "@/features/graph/controller"
import { shortHash } from "@/features/graph/ids"
import { ScrollText } from "@/features/graph/interactions/scroll-text"
import { Avatar } from "@/components/ui/avatar"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge, badgeSeparator } from "@/components/ui/badge"
import { LABEL_CLS } from "@/components/ui/typography"
import { FileList } from "@/features/repo/file-list"

type Props = {
  api: RepoApi
  repoId: number
  graph: GraphHandle
  /** line indices, sorted ascending */
  selection: number[]
  selMode: SelMode
  activePath?: string
  onOpenDiff(commits: { hash: string; parent: string | null }, file: FileChange): void
  onJump(hash: string): void
}

const Loading = () => <AsyncHint className="py-1">{messages.detail.loadingFiles}</AsyncHint>

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="shrink-0 text-xs text-muted-foreground">{children}</p>
)

function TypeChip({ commit }: { commit: Commit }) {
  const ps = parseSubject(commit.s)
  if (!ps.label) return null
  const icon = typeIcon(ps.type!)
  return (
    <Badge color={typeColor(ps.type!)} shape="squared" className="me-1.5">
      {icon && <HugeiconsIcon icon={icon} strokeWidth={2} data-icon="inline-start" />}
      {ps.label}
    </Badge>
  )
}

const Cloud = () => <HugeiconsIcon icon={CloudIcon} strokeWidth={2} className="shrink-0" />

/* Same grammar as the graph: cloud detached by a divider = the remote is on this commit;
   cloud stuck to `origin/develop` = the local branch is elsewhere. */
function RefBadge({ r }: { r: RefChip }) {
  const synced = r.remotes.length > 0
  return (
    <Badge
      shape="squared"
      color={refColor(r.kind)}
      className={cn("max-w-full", (r.kind === "remote" || synced) && "ps-1.5")}
    >
      {(r.kind === "remote" || synced) && <Cloud />}
      {synced && <span className={badgeSeparator} />}
      <ScrollText text={r.name} />
    </Badge>
  )
}

function PersonChip({ name, email }: { name: string; email: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar name={name} email={email} />
      <span className="truncate">{name}</span>
    </span>
  )
}

/* URLs go out to the browser: `setWindowOpenHandler` refuses navigation within the window. */
const Inline = ({ tokens }: { tokens: MdToken[] }) => (
  <>
    {tokens.map((k, i) =>
      k.t === "code" ? (
        <code key={i} className="rounded-sm bg-muted px-1 font-mono">
          {k.v}
        </code>
      ) : k.t === "bold" ? (
        <strong key={i} className="font-medium text-foreground">
          {k.v}
        </strong>
      ) : k.t === "em" ? (
        <em key={i}>{k.v}</em>
      ) : k.t === "link" ? (
        <a key={i} href={k.v} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {k.v}
        </a>
      ) : (
        k.v
      )
    )}
  </>
)

const Markdown = ({ text }: { text: string }) => (
  <>
    {parseMarkdown(text).map((b, i) =>
      b.kind === "p" ? (
        <p key={i} className="whitespace-pre-wrap text-pretty">
          <Inline tokens={b.tokens} />
        </p>
      ) : (
        <ul key={i} className="list-disc space-y-0.5 ps-4 text-pretty">
          {b.items.map((it, j) => (
            <li key={j}>
              <Inline tokens={it} />
            </li>
          ))}
        </ul>
      )
    )}
  </>
)

/** Net diff between the oldest selected commit (its parent) and the most recent one. */
const spanCtx = (graph: GraphHandle, selection: number[]) => ({
  hash: graph.commit(selection[0])!.h,
  parent: graph.commit(selection[selection.length - 1])!.p[0] || null,
})

function Files({
  api,
  queryKey,
  queryFn,
  ctx,
  ctxOf,
  activePath,
  onOpenDiff,
}: {
  api: RepoApi
  queryKey: readonly unknown[]
  queryFn(): Promise<FileChange[]>
  ctx: { hash: string; parent: string | null }
  /** diff context specific to a file: a stash's untracked files live in another commit */
  ctxOf?(f: FileChange): { hash: string; parent: string | null }
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
}) {
  /* content-addressed (hash + parent in the key): a commit's file list never changes —
     no refetch on remount (perf audit, finding 5) */
  const { data, isError } = useQuery({ queryKey, queryFn, staleTime: Infinity })
  if (isError)
    return (
      <div className="mt-4 shrink-0 border-t pt-3">
        <Hint>{messages.diff.unavailable}</Hint>
      </div>
    )
  if (!data)
    return (
      <div className="mt-4 shrink-0 border-t pt-3">
        <Loading />
      </div>
    )
  /* keyed by the diff span: the panel now updates in place across selection changes (the
     ErrorBoundary in repo-view is keyed by its reset nonce alone), so the list's per-selection
     state — collapsed folders, scroll position — resets here, on the smallest component that
     used to rely on the remount. */
  return (
    <FileList
      key={`${ctx.hash}:${ctx.parent}`}
      files={data}
      api={api}
      activePath={activePath}
      onOpen={(f) => onOpenDiff(ctxOf?.(f) ?? ctx, f)}
    />
  )
}

function Single({
  api,
  repoId,
  graph,
  row,
  activePath,
  onOpenDiff,
  onJump,
}: {
  api: RepoApi
  repoId: number
  graph: GraphHandle
  row: number
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
  onJump(hash: string): void
}) {
  const c = graph.commit(row)!
  const ps = parseSubject(c.s)
  const ctx = { hash: c.h, parent: c.p[0] || null }
  /* the body doesn't travel with the log: it's re-fetched only for the selected line */
  const { data: raw } = useBodyQuery(api, repoId, c.h)
  const body = raw === undefined ? null : parseBody(raw)

  /* A stash shows everything it stashed away: tracked changes (diff against its base) and
     untracked files, stashed in a separate commit (3rd parent), rendered as `?` like
     in the working tree. Their diff is read from that commit, not against the base. */
  const untracked = c.stash?.untracked ?? null
  const filesQueryKey = untracked
    ? (["files", "stash", repoId, ctx.hash, untracked] as const)
    : queryKeys.files(repoId, ctx.hash, ctx.parent)
  const loadFiles = untracked
    ? async () => {
        const [tracked, extra] = await Promise.all([api.files(ctx.hash, ctx.parent), api.files(untracked, null)])
        /* a file deleted then recreated untracked would appear twice: the `?` wins,
           that's the state the stash would restore */
        const seen = new Set(extra.map((f) => f.path))
        return [...tracked.filter((f) => !seen.has(f.path)), ...extra.map((f) => ({ ...f, st: "?" }))]
      }
    : () => api.files(ctx.hash, ctx.parent)
  const ctxFor = untracked ? (f: FileChange) => (f.st === "?" ? { hash: untracked, parent: null } : ctx) : undefined

  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug tracking-tight text-balance [overflow-wrap:anywhere]">
        <TypeChip commit={c} />
        {ps.text}
      </h2>

      {/* a fifty-line body doesn't push the file list off-screen; keyed on the hash so the
          scroll position resets per commit (the panel updates in place, no remount) */}
      {body?.text && (
        <div
          key={c.h}
          className="mt-2 max-h-32 shrink-0 space-y-2 overflow-y-auto text-xs/5 text-muted-foreground [overflow-wrap:anywhere]"
        >
          <Markdown text={body.text} />
        </div>
      )}

      {/* 76px: the track fits "CO-AUTHORS" on one line, letter-spacing included */}
      <dl className="mt-3.5 grid shrink-0 grid-cols-[76px_1fr] gap-x-3 gap-y-2">
        {c.stash && (
          <>
            <Dt>stash</Dt>
            <dd className="font-mono text-xs">{c.stash.name}</dd>
          </>
        )}
        <Dt>{messages.detail.commit}</Dt>
        <dd className="font-mono text-xs" title={c.h}>
          {shortHash(c.h)}
        </dd>
        <Dt>{messages.detail.author}</Dt>
        <dd className="text-xs">
          <PersonChip name={c.a} email={c.e} />
        </dd>
        {!!body?.coAuthors.length && (
          <>
            <Dt>{messages.detail.coAuthors}</Dt>
            <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {body.coAuthors.map((a) => (
                <PersonChip key={a.email + a.name} name={a.name} email={a.email} />
              ))}
            </dd>
          </>
        )}
        <Dt>{messages.detail.date}</Dt>
        <dd className="text-xs tabular-nums">{c.d}</dd>
        <Dt>{c.p.length > 1 ? messages.detail.parents : messages.detail.parent}</Dt>
        <dd className="text-xs">
          {!c.p.length && messages.detail.root}
          {c.p.map((p, k) => (
            <button
              key={p}
              type="button"
              onClick={() => onJump(p)}
              title={p}
              className="block cursor-pointer font-mono text-primary hover:underline"
            >
              {shortHash(p)}
              {c.p.length > 1 && (k === 0 ? messages.detail.firstParent : messages.detail.mergeParent)}
            </button>
          ))}
        </dd>
      </dl>

      {/* the panel doesn't ration: this is where you find what the graph's "+N" collapses.
          `--badge-color` cascades down to the `lane` chips, just like on the graph row. */}
      {c.r && (
        <div
          className="mt-3 flex shrink-0 flex-wrap gap-1"
          style={{ "--badge-color": graph.laneColor(row) } as React.CSSProperties}
        >
          {parseRefs(c.r).map((r) => (
            <RefBadge key={`${r.kind}:${r.name}`} r={r} />
          ))}
        </div>
      )}

      <Files
        api={api}
        queryKey={filesQueryKey}
        queryFn={loadFiles}
        ctx={ctx}
        ctxOf={ctxFor}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

/* Composes the displayed text from `chainInfo`'s structured data (AUDIT.md §6, item 3):
   presentation strings are out of the algorithm module, React shapes them here. */
function formatChainInfo(info: ChainInfo): string {
  if (!info.merged) return info.refs ? messages.detail.unmergedSuffix(info.refs) : messages.detail.unmergedSegment
  return messages.detail.merged(info.refs, info.mergedInto, shortHash(info.mergeHash))
}

function Branch({
  api,
  repoId,
  graph,
  selection,
  activePath,
  onOpenDiff,
}: {
  api: RepoApi
  repoId: number
  graph: GraphHandle
  selection: number[]
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
}) {
  const ctx = spanCtx(graph, selection)
  const n = selection.length
  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight text-balance">
        {messages.detail.branchHeading(n)}
      </h2>
      <Hint>{formatChainInfo(graph.chainInfo(selection))}</Hint>
      {/* a single git command between the endpoints */}
      <Files
        api={api}
        queryKey={queryKeys.files(repoId, ctx.hash, ctx.parent)}
        queryFn={() => api.files(ctx.hash, ctx.parent)}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

function Multi({
  api,
  repoId,
  graph,
  selection,
  activePath,
  onOpenDiff,
}: {
  api: RepoApi
  repoId: number
  graph: GraphHandle
  selection: number[]
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
}) {
  const ctx = spanCtx(graph, selection)

  /* merge: one entry per file; DATA goes from most recent to oldest,
     we replay from oldest to most recent → the most recent status wins. */
  const load = async () => {
    const results = await Promise.all(
      selection.map((i) => {
        const c = graph.commit(i)!
        return api.files(c.h, c.p[0] || null).then((l) => ({ i, l }))
      })
    )
    const byPath = new Map<string, FileChange>()
    results.sort((a, b) => b.i - a.i).forEach(({ l }) => l.forEach((f) => byPath.set(f.path, f)))
    return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  }

  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight text-balance">
        {messages.detail.commitsSelected(selection.length)}
      </h2>
      {/* the header doesn't push the file list off-screen: beyond that, it scrolls.
          Keyed on a cheap selection fingerprint (not join(",") — selections can be huge) so
          the scroll resets when the selection changes, like the old per-selection remount did */}
      <div
        key={`${selection.length}:${selection[0]}:${selection[selection.length - 1]}`}
        className="mt-3 flex max-h-40 shrink-0 flex-col gap-0.5 overflow-y-auto"
      >
        {selection.map((i) => {
          const c = graph.commit(i)!
          return (
            <div key={c.h} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted-foreground" title={c.h}>
                {shortHash(c.h)}
              </span>
              <span className="truncate">{parseSubject(c.s).text}</span>
            </div>
          )
        })}
      </div>
      <Files
        api={api}
        queryKey={["files", "multi", repoId, selection.map((i) => graph.commit(i)!.h).join(",")]}
        queryFn={load}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

const Dt = ({ children }: { children: React.ReactNode }) => <dt className={cn("pt-0.5", LABEL_CLS)}>{children}</dt>

export function DetailPanel({ api, repoId, graph, selection, selMode, activePath, onOpenDiff, onJump }: Props) {
  if (!selection.length) return <Hint>{messages.repo.clickCommitForDetail}</Hint>

  return selection.length === 1 ? (
    <Single
      api={api}
      repoId={repoId}
      graph={graph}
      row={selection[0]}
      activePath={activePath}
      onOpenDiff={onOpenDiff}
      onJump={onJump}
    />
  ) : selMode === "branch" ? (
    <Branch
      api={api}
      repoId={repoId}
      graph={graph}
      selection={selection}
      activePath={activePath}
      onOpenDiff={onOpenDiff}
    />
  ) : (
    <Multi
      api={api}
      repoId={repoId}
      graph={graph}
      selection={selection}
      activePath={activePath}
      onOpenDiff={onOpenDiff}
    />
  )
}
