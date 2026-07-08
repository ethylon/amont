import type { Commit, FileChange, RepoApi } from "@/lib/git"
import { parseRefs, parseSubject, refColor, typeColor } from "@/lib/commit-message"
import type { GraphHandle } from "@/components/graph-canvas"
import { useAsync } from "@/hooks/use-async"
import { Badge } from "@/components/ui/badge"
import { Tip } from "@/components/ui/tip"
import { FileList } from "@/components/file-list"
import { Spinner } from "@/components/ui/primitives/spinner"

export type SelMode = "multi" | "branch"

type Props = {
  api: RepoApi
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
  <p className="shrink-0 text-xs text-muted-foreground">{children}</p>
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
  api, load, cacheKey, ctx, activePath, onOpenDiff,
}: {
  api: RepoApi
  load(): Promise<FileChange[]>
  cacheKey: string
  ctx: { hash: string; parent: string | null }
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
}) {
  const { data, error } = useAsync(load, cacheKey)
  if (error) return <div className="mt-4 shrink-0 border-t pt-3"><Hint>Diff indisponible.</Hint></div>
  if (!data) return <div className="mt-4 shrink-0 border-t pt-3"><Loading /></div>
  return <FileList files={data} api={api} activePath={activePath} onOpen={(f) => onOpenDiff(ctx, f)} />
}

function Single({ api, graph, row, activePath, onOpenDiff, onJump }: {
  api: RepoApi; graph: GraphHandle; row: number; activePath?: string
  onOpenDiff: Props["onOpenDiff"]; onJump(hash: string): void
}) {
  const c = graph.commit(row)!
  const ps = parseSubject(c.s)
  const ctx = { hash: c.h, parent: c.p[0] || null }

  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight [overflow-wrap:anywhere]">
        <TypeChip commit={c} />
        {ps.text}
      </h2>

      <dl className="mt-3.5 grid shrink-0 grid-cols-[66px_1fr] gap-x-3 gap-y-2">
        <Dt>commit</Dt>
        <dd className="font-mono text-xs">{c.h}</dd>
        <Dt>auteur</Dt>
        <dd className="text-xs">{c.a}</dd>
        <Dt>date</Dt>
        <dd className="text-xs tabular-nums">{c.d}</dd>
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

      {/* le panneau ne rationne pas : c'est ici qu'on retrouve ce que le "+N" du graphe replie */}
      {c.r && (
        <div className="mt-3 flex shrink-0 flex-wrap gap-1">
          {parseRefs(c.r).map((r) => (
            <Badge
              key={`${r.kind}:${r.name}`}
              shape="squared"
              color={refColor(r.kind)}
              title={r.remotes.length ? `${r.name} = ${r.remotes.join(", ")}` : undefined}
            >
              {r.name}
              {r.remotes.length > 0 && <span className="size-1 shrink-0 rounded-full bg-current opacity-60" />}
            </Badge>
          ))}
        </div>
      )}

      <Files
        api={api}
        load={() => api.files(ctx.hash, ctx.parent)}
        cacheKey={`single:${c.h}`}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

function Branch({ api, graph, selection, activePath, onOpenDiff }: {
  api: RepoApi; graph: GraphHandle; selection: number[]; activePath?: string; onOpenDiff: Props["onOpenDiff"]
}) {
  const ctx = spanCtx(graph, selection)
  const n = selection.length
  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight">
        Branche · {n} commit{n > 1 ? "s" : ""}
      </h2>
      <Hint>{graph.chainInfo(selection)}</Hint>
      {/* une seule commande git entre les extrémités */}
      <Files
        api={api}
        load={() => api.files(ctx.hash, ctx.parent)}
        cacheKey={`branch:${ctx.hash}:${ctx.parent}`}
        ctx={ctx}
        activePath={activePath}
        onOpenDiff={onOpenDiff}
      />
    </>
  )
}

function Multi({ api, graph, selection, activePath, onOpenDiff }: {
  api: RepoApi; graph: GraphHandle; selection: number[]; activePath?: string; onOpenDiff: Props["onOpenDiff"]
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
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight">{selection.length} commits sélectionnés</h2>
      {/* l'en-tête ne pousse pas la liste des fichiers hors de l'écran : au-delà, il scrolle */}
      <div className="mt-3 flex max-h-40 shrink-0 flex-col gap-0.5 overflow-y-auto">
        {selection.map((i) => {
          const c = graph.commit(i)!
          return (
            <div key={c.h} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted-foreground">{c.h}</span>
              <Tip text={c.s}>
                <span className="truncate">{parseSubject(c.s).text}</span>
              </Tip>
            </div>
          )
        })}
      </div>
      <Files
        api={api}
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

export function DetailPanel({ api, graph, selection, selMode, activePath, onOpenDiff, onJump, children }: Props) {
  if (!selection.length) return <Hint>Clique un commit pour le détail.</Hint>

  return (
    <>
      {selection.length === 1 ? (
        <Single api={api} graph={graph} row={selection[0]} activePath={activePath} onOpenDiff={onOpenDiff} onJump={onJump} />
      ) : selMode === "branch" ? (
        <Branch api={api} graph={graph} selection={selection} activePath={activePath} onOpenDiff={onOpenDiff} />
      ) : (
        <Multi api={api} graph={graph} selection={selection} activePath={activePath} onOpenDiff={onOpenDiff} />
      )}
      {children}
    </>
  )
}
