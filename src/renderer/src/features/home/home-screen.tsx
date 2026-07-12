import { useCallback, useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Clock01Icon, Folder01Icon, FolderLibraryIcon } from "@hugeicons/core-free-icons"

import { host, type Repo, type RepoRef } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Mark } from "@/components/ui/mark"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { LABEL_CLS } from "@/components/ui/typography"
import { homeKeys } from "@/features/home/keys"

type Props = {
  active: boolean
  onOpened(repo: Repo): void
}

function RepoButton({ repo, onClick }: { repo: RepoRef; onClick(): void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full min-w-0 cursor-pointer items-center gap-2.5 rounded-md border border-transparent px-2.5 py-2 text-left hover:border-border hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none"
    >
      <HugeiconsIcon icon={Folder01Icon} strokeWidth={2} className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{repo.name}</span>
        <span className="block truncate text-[0.625rem] text-muted-foreground">{repo.path}</span>
      </span>
    </button>
  )
}

function Section({
  icon,
  title,
  action,
  children,
}: {
  icon: IconSvgElement
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0">
      <h3 className={cn("mb-1 flex items-center gap-2 px-2.5", LABEL_CLS)}>
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />
        {title}
        {action && <span className="ms-auto">{action}</span>}
      </h3>
      {children}
    </section>
  )
}

export function HomeScreen({ active, onOpened }: Props) {
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  /* the home screen never unmounts: we refresh the recents on every return to it. TanStack
     Query absorbs the case where two close-together visits overlap (unmount/resubscribe
     of in-flight queries) without a `stale` flag to copy by hand. */
  const { data: repos } = useQuery({ queryKey: homeKeys.repos, queryFn: () => host.repos() })
  useEffect(() => {
    if (active) void queryClient.invalidateQueries({ queryKey: homeKeys.repos })
  }, [active, queryClient])

  const root = repos?.root ?? null
  const recents = repos?.recents ?? []

  /* the scan walks the disk: it only starts once the root is known */
  const { data: found = null } = useQuery({
    queryKey: homeKeys.scan(root),
    queryFn: () => host.scanRoot(),
    enabled: !!root,
  })

  /* main returns null (dialog cancelled) or the opened repo; a failure now throws a
     structured error (error-handling overhaul fix, AUDIT.md §4) rather than a `{ error }`. */
  const opened = useCallback(
    (res: Repo | null) => {
      if (!res) return
      setError(null)
      onOpened(res)
    },
    [onOpened]
  )
  const failed = useCallback((e: unknown) => setError(describeError(e)), [])

  const chooseRoot = useCallback(async () => {
    const newRoot = await host.chooseRoot()
    queryClient.setQueryData(homeKeys.repos, (prev) =>
      prev ? { ...prev, root: newRoot } : { root: newRoot, recents: [] }
    )
  }, [queryClient])
  const openPath = useCallback((path: string) => host.openPath(path).then(opened, failed), [failed, opened])
  const openDialog = useCallback(() => host.openDialog().then(opened, failed), [failed, opened])

  if (!root && !recents.length) {
    return (
      /* the radial halo isn't part of any primitive: it lives on the container, not on Empty */
      <div className="relative grid flex-1 place-items-center overflow-hidden before:pointer-events-none before:absolute before:top-1/2 before:left-1/2 before:size-[min(70vw,620px)] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-radial before:from-primary/12 before:to-transparent before:to-66%">
        <Empty className="relative">
          <EmptyHeader>
            <EmptyMedia>
              <Mark className="size-11" />
            </EmptyMedia>
            <EmptyTitle className="text-base">{messages.home.noRepos}</EmptyTitle>
            <EmptyDescription className="text-pretty">{messages.home.chooseRootHint}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={chooseRoot}>{messages.home.chooseRoot}</Button>
            <Button variant="ghost" size="sm" onClick={openDialog}>
              {messages.home.openRepo}
            </Button>
            {error && (
              <Badge color="danger" shape="squared">
                {error}
              </Badge>
            )}
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-6 py-10">
        <div className="flex items-center gap-3 px-2.5">
          <Mark className="size-7" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold tracking-tight">Amont</h2>
            <p className="text-xs text-muted-foreground">{messages.home.openInNewTab}</p>
          </div>
          <Button variant="outline" size="sm" onClick={openDialog}>
            {messages.home.openRepo}
          </Button>
        </div>

        {error && (
          <Badge color="danger" shape="squared" className="mx-2.5 self-start">
            {error}
          </Badge>
        )}

        {!!recents.length && (
          <Section icon={Clock01Icon} title={messages.home.recents}>
            {recents.map((r) => (
              <RepoButton key={r.path} repo={r} onClick={() => openPath(r.path)} />
            ))}
          </Section>
        )}

        <Section
          icon={FolderLibraryIcon}
          title={messages.home.rootFolder}
          action={
            <Button variant="ghost" size="xs" className="normal-case" onClick={chooseRoot}>
              {root ? messages.home.change : messages.home.choose}
            </Button>
          }
        >
          {root && <p className="truncate px-2.5 pb-1.5 text-[0.625rem] text-muted-foreground">{root}</p>}
          {!root ? (
            <p className="px-2.5 py-2 text-xs text-pretty text-muted-foreground">{messages.home.noRootFolder}</p>
          ) : found === null ? (
            <AsyncHint className="px-2.5 py-2">{messages.home.scanningRepos}</AsyncHint>
          ) : !found.length ? (
            <p className="px-2.5 py-2 text-xs text-pretty text-muted-foreground">
              {messages.home.noReposFoundUnderRoot}
            </p>
          ) : (
            found.map((r) => <RepoButton key={r.path} repo={r} onClick={() => openPath(r.path)} />)
          )}
        </Section>
      </div>
    </div>
  )
}
