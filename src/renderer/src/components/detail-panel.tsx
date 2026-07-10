import { HugeiconsIcon } from "@hugeicons/react"
import { CloudIcon } from "@hugeicons/core-free-icons"

import type { Commit, FileChange, RepoApi } from "@/lib/git"
import { parseBody, parseMarkdown, parseRefs, parseSubject, refColor, typeColor, type MdToken, type RefChip } from "@/lib/commit-message"
import { cn } from "@/lib/utils"
import type { GraphHandle } from "@/components/graph-canvas"
import { SCROLL_TEXT_CLASS, scrollTextHover, scrollTextStop } from "@/components/scroll-text"
import { useAsync } from "@/hooks/use-async"
import { Avatar } from "@/components/ui/avatar"
import { Badge, badgeSeparator } from "@/components/ui/badge"
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
    <Badge color={typeColor(ps.type!)} shape="squared" className="me-1.5">
      {ps.label}
    </Badge>
  )
}

const Cloud = () => <HugeiconsIcon icon={CloudIcon} strokeWidth={2} className="shrink-0" />

/* jumeau React de scrollText() : le nom défile au survol au lieu de déborder du panneau */
const ScrollName = ({ text }: { text: string }) => (
  <span
    className={SCROLL_TEXT_CLASS}
    onMouseEnter={(e) => scrollTextHover(e.currentTarget)}
    onMouseLeave={() => scrollTextStop()}
  >
    <span>{text}</span>
  </span>
)

/* Même grammaire que le graphe : nuage détaché par un filet = la distante est sur ce commit ;
   nuage collé à `origin/develop` = la branche locale est ailleurs. */
function RefBadge({ r }: { r: RefChip }) {
  const synced = r.remotes.length > 0
  const badge = (
    <Badge shape="squared" color={refColor(r.kind)} className={cn("max-w-full", (r.kind === "remote" || synced) && "ps-1.5")}>
      {(r.kind === "remote" || synced) && <Cloud />}
      {synced && <span className={badgeSeparator} />}
      <ScrollName text={r.name} />
    </Badge>
  )
  return badge
}

function PersonChip({ name, email }: { name: string; email: string }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Avatar name={name} email={email} />
      <span className="truncate">{name}</span>
    </span>
  )
}

/* Les URLs partent au navigateur : `setWindowOpenHandler` refuse la navigation dans la fenêtre. */
const Inline = ({ tokens }: { tokens: MdToken[] }) => (
  <>
    {tokens.map((k, i) =>
      k.t === "code" ? <code key={i} className="rounded-sm bg-muted px-1 font-mono">{k.v}</code>
        : k.t === "bold" ? <strong key={i} className="font-medium text-foreground">{k.v}</strong>
          : k.t === "em" ? <em key={i}>{k.v}</em>
            : k.t === "link" ? <a key={i} href={k.v} target="_blank" rel="noreferrer" className="text-primary hover:underline">{k.v}</a>
              : k.v
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
            <li key={j}><Inline tokens={it} /></li>
          ))}
        </ul>
      )
    )}
  </>
)

/** Diff net entre le plus ancien sélectionné (son parent) et le plus récent. */
const spanCtx = (graph: GraphHandle, selection: number[]) => ({
  hash: graph.commit(selection[0])!.h,
  parent: graph.commit(selection[selection.length - 1])!.p[0] || null,
})

function Files({
  api, load, cacheKey, ctx, ctxOf, activePath, onOpenDiff,
}: {
  api: RepoApi
  load(): Promise<FileChange[]>
  cacheKey: string
  ctx: { hash: string; parent: string | null }
  /** contexte de diff propre à un fichier : les non suivis d'un stash vivent dans un autre commit */
  ctxOf?(f: FileChange): { hash: string; parent: string | null }
  activePath?: string
  onOpenDiff: Props["onOpenDiff"]
}) {
  const { data, error } = useAsync(load, cacheKey)
  if (error) return <div className="mt-4 shrink-0 border-t pt-3"><Hint>Diff indisponible.</Hint></div>
  if (!data) return <div className="mt-4 shrink-0 border-t pt-3"><Loading /></div>
  return <FileList files={data} api={api} activePath={activePath} onOpen={(f) => onOpenDiff(ctxOf?.(f) ?? ctx, f)} />
}

function Single({ api, graph, row, activePath, onOpenDiff, onJump }: {
  api: RepoApi; graph: GraphHandle; row: number; activePath?: string
  onOpenDiff: Props["onOpenDiff"]; onJump(hash: string): void
}) {
  const c = graph.commit(row)!
  const ps = parseSubject(c.s)
  const ctx = { hash: c.h, parent: c.p[0] || null }
  /* le corps ne voyage pas avec le log : il est relu pour la seule ligne sélectionnée */
  const { data: raw } = useAsync(() => api.body(c.h), `body:${c.h}`)
  const body = raw === undefined ? null : parseBody(raw)

  /* Un stash montre tout ce qu'il remise : les changements suivis (diff contre sa base) et
     les fichiers non suivis, remisés dans un commit à part (3e parent), rendus en `?` comme
     dans l'arbre de travail. Leur diff se lit dans ce commit-là, pas contre la base. */
  const untracked = c.stash?.untracked ?? null
  const loadFiles = untracked
    ? async () => {
        const [tracked, extra] = await Promise.all([
          api.files(ctx.hash, ctx.parent),
          api.files(untracked, null),
        ])
        /* un fichier supprimé puis recréé non suivi apparaîtrait deux fois : le `?` gagne,
           c'est l'état que le stash restaurerait */
        const seen = new Set(extra.map((f) => f.path))
        return [...tracked.filter((f) => !seen.has(f.path)), ...extra.map((f) => ({ ...f, st: "?" }))]
      }
    : () => api.files(ctx.hash, ctx.parent)
  const ctxFor = untracked
    ? (f: FileChange) => (f.st === "?" ? { hash: untracked, parent: null } : ctx)
    : undefined

  return (
    <>
      <h2 className="shrink-0 text-sm leading-snug tracking-tight text-balance [overflow-wrap:anywhere]">
        <TypeChip commit={c} />
        {ps.text}
      </h2>

      {/* un corps de cinquante lignes ne pousse pas la liste des fichiers hors de l'écran */}
      {body?.text && (
        <div className="mt-2 max-h-32 shrink-0 space-y-2 overflow-y-auto text-xs/5 text-muted-foreground [overflow-wrap:anywhere]">
          <Markdown text={body.text} />
        </div>
      )}

      {/* 76px : la piste tient "CO-AUTEURS" sur une ligne, interlettrage compris */}
      <dl className="mt-3.5 grid shrink-0 grid-cols-[76px_1fr] gap-x-3 gap-y-2">
        {c.stash && (
          <>
            <Dt>stash</Dt>
            <dd className="font-mono text-xs">{c.stash.name}</dd>
          </>
        )}
        <Dt>commit</Dt>
        <dd className="font-mono text-xs">{c.h}</dd>
        <Dt>auteur</Dt>
        <dd className="text-xs"><PersonChip name={c.a} email={c.e} /></dd>
        {!!body?.coAuthors.length && (
          <>
            <Dt>co-auteurs</Dt>
            <dd className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {body.coAuthors.map((a) => (
                <PersonChip key={a.email + a.name} name={a.name} email={a.email} />
              ))}
            </dd>
          </>
        )}
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

      {/* le panneau ne rationne pas : c'est ici qu'on retrouve ce que le "+N" du graphe replie.
          `--badge-color` descend sur les chips `lane`, comme sur la ligne du graphe. */}
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
        load={loadFiles}
        cacheKey={`single:${c.h}`}
        ctx={ctx}
        ctxOf={ctxFor}
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
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight text-balance">
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
      <h2 className="shrink-0 text-sm leading-snug font-semibold tracking-tight text-balance">{selection.length} commits sélectionnés</h2>
      {/* l'en-tête ne pousse pas la liste des fichiers hors de l'écran : au-delà, il scrolle */}
      <div className="mt-3 flex max-h-40 shrink-0 flex-col gap-0.5 overflow-y-auto">
        {selection.map((i) => {
          const c = graph.commit(i)!
          return (
            <div key={c.h} className="flex min-w-0 items-baseline gap-2 text-xs">
              <span className="shrink-0 font-mono text-muted-foreground">{c.h}</span>
              <span className="truncate">{parseSubject(c.s).text}</span>
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

export function DetailPanel({ api, graph, selection, selMode, activePath, onOpenDiff, onJump }: Props) {
  if (!selection.length) return <Hint>Clique un commit pour le détail.</Hint>

  return selection.length === 1 ? (
    <Single api={api} graph={graph} row={selection[0]} activePath={activePath} onOpenDiff={onOpenDiff} onJump={onJump} />
  ) : selMode === "branch" ? (
    <Branch api={api} graph={graph} selection={selection} activePath={activePath} onOpenDiff={onOpenDiff} />
  ) : (
    <Multi api={api} graph={graph} selection={selection} activePath={activePath} onOpenDiff={onOpenDiff} />
  )
}
