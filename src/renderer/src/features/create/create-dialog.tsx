import { useCallback, useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { CloudServerIcon, FolderAddIcon, FolderDownloadIcon, FolderLibraryIcon } from "@hugeicons/core-free-icons"

import { host, type Repo } from "@/lib/git"
import { describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { AsyncHint } from "@/components/ui/async-hint"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { LABEL_CLS } from "@/components/ui/typography"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { homeKeys } from "@/features/home/keys"

type Props = {
  open: boolean
  onOpenChange(open: boolean): void
  onOpened(repo: Repo): void
}

type Kind = "local" | "bare" | "clone"

/** Same shape as the home screen sections: small-caps header, icon, hint line. */
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
      <h3 className={cn("mb-1 flex items-center gap-2", LABEL_CLS)}>
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3" />
        {title}
      </h3>
      <p className="pb-2 text-xs text-pretty text-muted-foreground">{hint}</p>
      {children}
    </section>
  )
}

/** Proposed folder name for a clone: last URL segment, `.git` and trailing slashes stripped. */
function nameFromUrl(url: string): string {
  const last = url.trim().replace(/\/+$/, "").split(/[/:]/).pop()
  return (last ?? "").replace(/\.git$/, "")
}

/** Repository creation, opened from the tab strip's "+" and File ▸ New repository. Clone / local /
    bare share one destination folder; a clone or local init opens as a tab (which closes the dialog,
    via `onOpened`), while a bare repo — no working tree — stays put behind a success confirmation. */
export function CreateDialog({ open, onOpenChange, onOpened }: Props) {
  const queryClient = useQueryClient()

  /* same query as the home screen (shared key): the configured root is the default
     destination, refreshed every time the dialog opens */
  const { data: repos } = useQuery({ queryKey: homeKeys.repos, queryFn: () => host.repos() })
  useEffect(() => {
    if (open) void queryClient.invalidateQueries({ queryKey: homeKeys.repos })
  }, [open, queryClient])

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

  /* full path preview ("C:\Users\me\Documents\" + name): the separator is inferred from the
     destination itself — the renderer has no path module, and main only ever hands native paths */
  const destPrefix = dest ? dest + (dest.includes("\\") ? "\\" : "/") : null

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] sm:max-w-lg">
        {/* max-h relayed onto the viewport, minus DialogContent's p-4: the stock viewport
            (size-full) would otherwise resolve against an auto height and never scroll */}
        <ScrollArea className="[&>[data-slot=scroll-area-viewport]]:max-h-[calc(85vh-2rem)]">
          <div className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{messages.create.title}</DialogTitle>
              <DialogDescription>{messages.create.intro}</DialogDescription>
            </DialogHeader>

            <Section
              icon={FolderLibraryIcon}
              title={messages.create.destination}
              hint={dest ? messages.create.destinationHint : messages.create.noDestination}
            >
              <div className={rowCls}>
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{dest ?? "—"}</p>
                <Button variant="outline" size="xs" onClick={() => void chooseDir()}>
                  {messages.home.choose}
                </Button>
              </div>
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
                {/* the addon spells out the exact path the clone will create: destination
                prefix frozen, only the final folder name stays editable */}
                <label className={rowCls}>
                  <span className={labelCls}>{messages.create.name}</span>
                  <InputGroup>
                    {destPrefix && (
                      <InputGroupAddon>
                        {/* start-truncated (rtl + ltr override): a long destination keeps its tail
                        visible — the part the name visually attaches to */}
                        <InputGroupText className="max-w-64">
                          <span dir="rtl" className="max-w-full truncate">
                            <span dir="ltr" className="[unicode-bidi:bidi-override]">
                              {destPrefix}
                            </span>
                          </span>
                        </InputGroupText>
                      </InputGroupAddon>
                    )}
                    <InputGroupInput
                      value={cloneName}
                      onChange={(e) => {
                        setCloneName(e.target.value)
                        setCloneNameEdited(true)
                      }}
                    />
                  </InputGroup>
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
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}
