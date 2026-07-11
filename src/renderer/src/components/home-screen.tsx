import { useCallback, useEffect, useState } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { Clock01Icon, Folder01Icon, FolderLibraryIcon } from "@hugeicons/core-free-icons"

import { host, type Repo, type RepoRef } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { Mark } from "@/components/mark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/primitives/empty"
import { Spinner } from "@/components/ui/primitives/spinner"

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

function Section({ icon, title, action, children }: {
  icon: IconSvgElement
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0">
      <h3 className="mb-1 flex items-center gap-2 px-2.5 text-[0.625rem] font-semibold tracking-[0.07em] text-muted-foreground uppercase">
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />
        {title}
        {action && <span className="ms-auto">{action}</span>}
      </h3>
      {children}
    </section>
  )
}

export function HomeScreen({ active, onOpened }: Props) {
  const [root, setRoot] = useState<string | null>(null)
  const [recents, setRecents] = useState<RepoRef[]>([])
  const [found, setFound] = useState<RepoRef[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /* l'accueil ne démonte jamais : on rafraîchit les récents à chaque retour dessus */
  useEffect(() => {
    if (!active) return
    host.repos().then((s) => {
      setRoot(s.root)
      setRecents(s.recents)
    })
  }, [active])

  /* le scan traverse le disque : il ne part qu'une fois la racine connue */
  useEffect(() => {
    if (!root) return
    let stale = false
    setFound(null)
    host.scanRoot().then((r) => !stale && setFound(r))
    return () => {
      stale = true
    }
  }, [root])

  /* main renvoie null (dialogue annulé) ou le repo ouvert ; un échec throw désormais une
     erreur structurée (fix chantier « erreurs », AUDIT.md §4) plutôt qu'un `{ error }`. */
  const opened = useCallback(
    (res: Repo | null) => {
      if (!res) return
      setError(null)
      onOpened(res)
    },
    [onOpened]
  )
  const failed = useCallback((e: unknown) => setError(describeError(e)), [])

  const chooseRoot = useCallback(() => host.chooseRoot().then(setRoot), [])
  const openPath = useCallback((path: string) => host.openPath(path).then(opened, failed), [failed, opened])
  const openDialog = useCallback(() => host.openDialog().then(opened, failed), [failed, opened])

  if (!root && !recents.length) {
    return (
      /* le halo radial ne relève d'aucune primitive : il vit sur le conteneur, pas sur Empty */
      <div className="relative grid flex-1 place-items-center overflow-hidden before:pointer-events-none before:absolute before:top-1/2 before:left-1/2 before:size-[min(70vw,620px)] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-radial before:from-primary/12 before:to-transparent before:to-66%">
        <Empty className="relative">
          <EmptyHeader>
            <EmptyMedia>
              <Mark className="size-11" />
            </EmptyMedia>
            <EmptyTitle className="text-base">Aucun dépôt</EmptyTitle>
            <EmptyDescription className="text-pretty">
              Choisis un dossier racine pour lister les dépôts qu'il contient, ou ouvre un dépôt
              directement.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={chooseRoot}>Choisir un dossier racine…</Button>
            <Button variant="ghost" size="sm" onClick={openDialog}>
              Ouvrir un dépôt…
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
            <p className="text-xs text-muted-foreground">Ouvre un dépôt dans un nouvel onglet.</p>
          </div>
          <Button variant="outline" size="sm" onClick={openDialog}>
            Ouvrir un dépôt…
          </Button>
        </div>

        {error && (
          <Badge color="danger" shape="squared" className="mx-2.5 self-start">
            {error}
          </Badge>
        )}

        {!!recents.length && (
          <Section icon={Clock01Icon} title="Récents">
            {recents.map((r) => (
              <RepoButton key={r.path} repo={r} onClick={() => openPath(r.path)} />
            ))}
          </Section>
        )}

        <Section
          icon={FolderLibraryIcon}
          title="Dossier racine"
          action={
            <Button variant="ghost" size="xs" className="normal-case" onClick={chooseRoot}>
              {root ? "Changer…" : "Choisir…"}
            </Button>
          }
        >
          {root && <p className="truncate px-2.5 pb-1.5 text-[0.625rem] text-muted-foreground">{root}</p>}
          {!root ? (
            <p className="px-2.5 py-2 text-xs text-pretty text-muted-foreground">
              Aucun dossier racine. Choisis-en un pour lister ses dépôts.
            </p>
          ) : found === null ? (
            <p className="flex items-center gap-2 px-2.5 py-2 text-xs text-muted-foreground">
              <Spinner className="size-3" /> recherche des dépôts…
            </p>
          ) : !found.length ? (
            <p className="px-2.5 py-2 text-xs text-pretty text-muted-foreground">Aucun dépôt trouvé sous cette racine.</p>
          ) : (
            found.map((r) => <RepoButton key={r.path} repo={r} onClick={() => openPath(r.path)} />)
          )}
        </Section>
      </div>
    </div>
  )
}
