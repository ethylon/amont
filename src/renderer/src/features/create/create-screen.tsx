import { useCallback, useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { CloudServerIcon, FolderAddIcon, FolderDownloadIcon, FolderLibraryIcon } from "@hugeicons/core-free-icons"

import { host, type Repo } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Mark } from "@/components/ui/mark"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LABEL_CLS } from "@/components/ui/typography"
import { homeKeys } from "@/features/home/keys"

type Props = {
  active: boolean
  onOpened(repo: Repo): void
}

type Kind = "local" | "bare" | "clone"

/** Same shape as the home screen sections: small-caps header, optional action on the right. */
function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: IconSvgElement
  title: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <section className="min-w-0">
      <h3 className={cn("mb-1 flex items-center gap-2 px-2.5", LABEL_CLS)}>
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />
        {title}
      </h3>
      <p className="px-2.5 pb-2 text-xs text-pretty text-muted-foreground">{hint}</p>
      {children}
    </section>
  )
}

/** Proposed folder name for a clone: last URL segment, `.git` and trailing slashes stripped. */
function nameFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, "").split(/[/:]/).pop()
  return (last ?? "").replace(/\.git$/, "")
}

export function CreateScreen({ active, onOpened }: Props) {
  const queryClient = useQueryClient()

  /* same query as the home screen (shared key): the configured root is the default
     destination, refreshed on every return to this page */
  const { data: repos } = useQuery({ queryKey: homeKeys.repos, queryFn: () => host.repos() })
  useEffect(() => {
    if (active) void queryClient.invalidateQueries({ queryKey: homeKeys.repos })
  }, [active, queryClient])

  const [dir, setDir] = useState<string | null>(null)
  const dest = dir ?? repos?.root ?? null

  const [localName, setLocalName] = useState("")
  const [bareName, setBareName] = useState("")
  const [url, setUrl] = useState("")
  const [cloneName, setCloneName] = useState("")
  /* the clone name follows the URL until the user takes it over */
  const [cloneNameEdited, setCloneNameEdited] = useState(false)

  const [busy, setBusy] = useState<Kind | null>(null)
  const [errors, setErrors] = useState<Partial<Record<Kind, string>>>({})
  /* bare repos don't open as a tab (no working tree): a confirmation replaces the navigation */
  const [barePath, setBarePath] = useState<string | null>(null)

  const chooseDir = useCallback(async () => {
    const picked = await host.chooseCreateDir()
    if (picked) setDir(picked)
  }, [])

  const run = useCallback(async (kind: Kind, fn: () => Promise<void>) => {
    setBusy(kind)
    setErrors((e) => ({ ...e, [kind]: undefined }))
    try {
      await fn()
    } catch (e) {
      setErrors((prev) => ({ ...prev, [kind]: describeError(e) }))
    } finally {
      setBusy(null)
    }
  }, [])

  const createLocal = () =>
    run("local", async () => {
      const repo = await host.initRepo(dest!, localName.trim())
      setLocalName("")
      onOpened(repo)
    })

  const createBare = () =>
    run("bare", async () => {
      setBarePath(null)
      setBarePath(await host.initBare(dest!, bareName.trim()))
      setBareName("")
    })

  const clone = () =>
    run("clone", async () => {
      const repo = await host.cloneRepo(dest!, url.trim(), cloneName.trim())
      setUrl("")
      setCloneName("")
      setCloneNameEdited(false)
      onOpened(repo)
    })

  const setUrlAndName = (value: string) => {
    setUrl(value)
    if (!cloneNameEdited) setCloneName(nameFromUrl(value))
  }

  const formCls = "flex flex-col gap-2 rounded-md border px-2.5 py-2.5"
  const rowCls = "flex items-center gap-2"
  const labelCls = "w-24 shrink-0 text-xs text-muted-foreground"

  const failure = (kind: Kind) =>
    errors[kind] && (
      <Badge color="danger" shape="squared" className="self-start">
        {errors[kind]}
      </Badge>
    )

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-6 py-10">
        <div className="flex items-center gap-3 px-2.5">
          <Mark className="size-7" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold tracking-tight">{messages.create.title}</h2>
            <p className="text-xs text-muted-foreground">{messages.create.intro}</p>
          </div>
        </div>

        <Section
          icon={FolderLibraryIcon}
          title={messages.create.destination}
          hint={dest ? messages.create.destinationHint : messages.create.noDestination}
        >
          <div className={cn(rowCls, "px-2.5")}>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dest ?? "—"}</p>
            <Button variant="outline" size="xs" onClick={() => void chooseDir()}>
              {messages.home.choose}
            </Button>
          </div>
        </Section>

        <Section icon={FolderAddIcon} title={messages.create.localTitle} hint={messages.create.localHint}>
          <form
            className={formCls}
            onSubmit={(e) => {
              e.preventDefault()
              void createLocal()
            }}
          >
            <label className={rowCls}>
              <span className={labelCls}>{messages.create.name}</span>
              <Input value={localName} onChange={(e) => setLocalName(e.target.value)} />
            </label>
            <div className={rowCls}>
              <span className={labelCls} />
              <Button type="submit" size="sm" disabled={!dest || !localName.trim() || busy !== null}>
                {messages.create.create}
              </Button>
              {busy === "local" && <AsyncHint>{messages.create.creating}</AsyncHint>}
            </div>
            {failure("local")}
          </form>
        </Section>

        <Section icon={CloudServerIcon} title={messages.create.bareTitle} hint={messages.create.bareHint}>
          <form
            className={formCls}
            onSubmit={(e) => {
              e.preventDefault()
              void createBare()
            }}
          >
            <label className={rowCls}>
              <span className={labelCls}>{messages.create.name}</span>
              <Input value={bareName} onChange={(e) => setBareName(e.target.value)} />
            </label>
            <div className={rowCls}>
              <span className={labelCls} />
              <Button type="submit" size="sm" disabled={!dest || !bareName.trim() || busy !== null}>
                {messages.create.create}
              </Button>
              {busy === "bare" && <AsyncHint>{messages.create.creating}</AsyncHint>}
            </div>
            {failure("bare")}
            {barePath && (
              <Badge color="success" shape="squared" className="self-start">
                {messages.create.createdAt(barePath)}
              </Badge>
            )}
          </form>
        </Section>

        <Section icon={FolderDownloadIcon} title={messages.create.cloneTitle} hint={messages.create.cloneHint}>
          <form
            className={formCls}
            onSubmit={(e) => {
              e.preventDefault()
              void clone()
            }}
          >
            <label className={rowCls}>
              <span className={labelCls}>{messages.create.url}</span>
              <Input
                value={url}
                onChange={(e) => setUrlAndName(e.target.value)}
                placeholder={messages.create.urlPlaceholder}
              />
            </label>
            <label className={rowCls}>
              <span className={labelCls}>{messages.create.name}</span>
              <Input
                value={cloneName}
                onChange={(e) => {
                  setCloneName(e.target.value)
                  setCloneNameEdited(true)
                }}
              />
            </label>
            <div className={rowCls}>
              <span className={labelCls} />
              <Button type="submit" size="sm" disabled={!dest || !url.trim() || !cloneName.trim() || busy !== null}>
                {messages.create.clone}
              </Button>
              {busy === "clone" && <AsyncHint>{messages.create.cloning}</AsyncHint>}
            </div>
            {failure("clone")}
          </form>
        </Section>
      </div>
    </div>
  )
}
