import { api, type Commit, type FileChange } from "@/lib/git"
import { parseSubject, typeColor } from "@/lib/commit-message"
import type { GraphHandle } from "@/components/graph-canvas"
import { useAsync } from "@/hooks/use-async"
import { Badge } from "@/components/ui/badge"
import { FileList } from "@/components/file-list"
import { Spinner } from "@/components/ui/primitives/spinner"

export type SelMode = "multi" | "branch"

type Props = {
  graph: GraphHandle
  /** indices de lignes, triés croissant */
  selection: number[]
  selMode: SelMode
  activePath?: string
  onOpenDiff(commits: { hash: string; parent: string | null }, file: FileChange): void
  onJump(hash: string): void
  children?: React.ReactNode
}

const Loading = () => (
  <p className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
    <Spinner className="size-3" /> fichiers…
  </p>
)

const Hint = ({ children }: { children: React.ReactNode }) => (
  <p className="text-xs text-muted-foreground">{children}</p>
)

function TypeChip({ commit }: { commit: Commit }) {
  const ps = parseSubject(commit.s)
  if (!ps.label) return null
  return (
    <Badge color={typeColor(ps.type!)} shape="squared" className="me-1.5 font-semibold">
      {ps.label}
    </Badge>
  )
}

/** Diff net entre le plus ancien sélectionné (son parent) et le plus récent. */
const spanCtx = (graph: GraphHandle, selection: number[]) => ({
  hash: graph.commit(selection[0])!.h,
  parent: graph.commit(selection[selection.length - 1])!.p[0] || null,
})

function Files({
  load, cacheKey, ctx, activePath, onOpenDiff,
}: {
  load(): Promise<FileChange[]>
  cacheKey: string
  ctx: { hash: string; parent: string | null }
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
}) {
  const { data, error } = useAsync(load, cacheKey)
  if (error) return <div className="mt-4 border-t pt-3"><Hint>Diff indisponible.</Hint></div>
  if (!data) return <div className="mt-4 border-t pt-3"><Loading /></div>
  return <FileList files={data} activePath={activePath} onOpen={(f) => onOpenDiff(ctx, f)} />
}

function Single({ graph, row, activePath, onOpenDiff, onJump }: {
  graph: GraphHandle; row: number; activePath?: string
  onOpenDiff: Props["onOpenDiff"]; onJump(hash: string): void
}) {
  const c = graph.commit(row)!
  const ps = parseSubject(c.s)
  const ctx = { hash: c.h, parent: c.p[0] || null }

  return (
    <>
      <h2 className="text-sm leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]">
        <TypeChip commit={c} />
        {ps.text}
      </h2>

      <dl className="mt-3.5 grid grid-cols-[66px_1fr] gap-x-3 gap-y-2">
        <Dt>commit</Dt>
        <dd className="font-mono text-xs">{c.h}</dd>
        <Dt>auteur</Dt>
        <dd className="text-xs">{c.a}</dd>
        <Dt>date</Dt>
        <dd className="font-mono text-xs">{c.d}</dd>
        <Dt>{c.p.length > 1 ? "parents" : "parent"}</Dt>
        <dd className="text-xs">
          {!c.p.length && "(racine)"}
          {c.p.map((p, k) => (
            <button
              key={p}
              type="button"
              onClick={() => onJump(p)}
              className="block cursor-pointer font-mono text-primary hover:underline"
            >
              {p}
              {c.p.length > 1 && (k === 0 ? "  (first-parent)" : "  (mergé)")}
            </button>
          ))}
        </dd>
      </dl>

      {c.r && (
        <div className="mt-3 flex flex-wrap gap-1">
          {c.r.split(", ").filter(Boolean).map((ref) => (
            <Badge
              key={ref}
              shape="squared"
              color={ref.startsWith("HEAD") ? "primary" : ref.startsWith("tag: ") ? "warning" : "neutral"}
            >
              {ref.replace("HEAD -> ", "").replace("tag: ", "")}
            </Badge>
          ))}
        </div>
      )}

      <Files
        load={() => api.files(ctx.hash, ctx.parent)}
        cacheKey={`single:${c.h}`}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

function Branch({ graph, selection, activePath, onOpenDiff }: {
  graph: GraphHandle; selection: number[]; activePath?: string; onOpenDiff: Props["onOpenDiff"]
}) {
  const ctx = spanCtx(graph, selection)
  const n = selection.length
  return (
    <>
      <h2 className="text-sm leading-snug font-semibold tracking-tight">
        Branche · {n} commit{n > 1 ? "s" : ""}
      </h2>
      <Hint>{graph.chainInfo(selection)}</Hint>
      {/* une seule commande git entre les extrémités */}
      <Files
        load={() => api.files(ctx.hash, ctx.parent)}
        cacheKey={`branch:${ctx.hash}:${ctx.parent}`}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

function Multi({ graph, selection, activePath, onOpenDiff }: {
  graph: GraphHandle; selection: number[]; activePath?: string; onOpenDiff: Props["onOpenDiff"]
}) {
  const ctx = spanCtx(graph, selection)

  /* fusion : une entrée par fichier ; DATA va du plus récent au plus ancien,
     on rejoue du plus ancien au plus récent → le statut le plus récent gagne. */
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
      <h2 className="text-sm leading-snug font-semibold tracking-tight">{selection.length} commits sélectionnés</h2>
      <div className="mt-3 flex flex-col gap-0.5">
        {selection.map((i) => {
          const c = graph.commit(i)!
          return (
            <div key={c.h} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted-foreground">{c.h}</span>
              <span className="truncate" title={c.s}>{parseSubject(c.s).text}</span>
            </div>
          )
        })}
      </div>
      <Files
        load={load}
        cacheKey={`multi:${selection.join(",")}`}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

const Dt = ({ children }: { children: React.ReactNode }) => (
  <dt className="pt-0.5 text-[0.625rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase">{children}</dt>
)

export function DetailPanel({ graph, selection, selMode, activePath, onOpenDiff, onJump, children }: Props) {
  if (!selection.length) return <Hint>Clique un commit pour le détail.</Hint>

  return (
    <>
      {selection.length === 1 ? (
        <Single graph={graph} row={selection[0]} activePath={activePath} onOpenDiff={onOpenDiff} onJump={onJump} />
      ) : selMode === "branch" ? (
        <Branch graph={graph} selection={selection} activePath={activePath} onOpenDiff={onOpenDiff} />
      ) : (
        <Multi graph={graph} selection={selection} activePath={activePath} onOpenDiff={onOpenDiff} />
      )}
      {children}
    </>
  )
}
