/* "Create a release" modal, opened from the sidebar's multi-selection menu: composes a
   release out of the selected branches and previews each merge before anything runs.

   The form reuses the FlowStartBanner grammar (frozen prefix, version suggested from the
   latest semver tag, selectable start point); what earns the modal over the banner strip is
   the merge list — orderable, uncheckable, annotated with a real dry-run per branch
   (`git merge-tree` cascade, cf. main/git/merge-preview.ts — the worktree never moves).

   Submitting creates the release (`git flow release start`) and arms the merge queue with
   the checked branches, in the list's order: the modal never merges anything itself — the
   queue banner drives the merges one explicit click at a time (cf. merge-queue-banner.tsx). */

import { useEffect, useMemo, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Alert02Icon,
  ArrowDown02Icon,
  ArrowUp02Icon,
  CheckmarkCircle02Icon,
  GitMergeIcon,
  RocketIcon,
} from "@hugeicons/core-free-icons"

import type { MergePreview } from "@/lib/git"
import { suggestedFlowVersion } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { GitCmd } from "@/components/ui/git-cmd"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useFlowQuery } from "@/features/flow/flow-queries"
import { useRefsQuery } from "@/features/refs/refs-queries"
import { useRepoStore } from "@/features/repo/repo-store"

/** Default start point of a release: the integration trunk (same fallbacks as the banner). */
const defaultBase = (branches: string[]): string =>
  (["develop", "main", "master"] as const).find((b) => branches.includes(b)) ?? branches[0] ?? ""

/** How many conflicted paths a row details before folding into "…". */
const FILES_SHOWN = 6

type Item = { branch: string; included: boolean }

export function ReleaseCreateDialog({ branches, onClose }: { branches: string[]; onClose(): void }) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const runFlow = useRepoStore((s) => s.runFlow)
  const armMergeQueue = useRepoStore((s) => s.armMergeQueue)
  const clearFocus = useRepoStore((s) => s.clearFocus)

  const { data: flow = null } = useFlowQuery(api, repoId)
  const prefix = flow?.release ?? "release/"

  const { data: refs = [] } = useRefsQuery(api, repoId)
  const locals = useMemo(() => refs.filter((r) => r.kind === "head").map((r) => r.name), [refs])
  const tags = useMemo(() => refs.filter((r) => r.kind === "tag").map((r) => r.name), [refs])

  const [items, setItems] = useState<Item[]>(() => branches.map((branch) => ({ branch, included: true })))
  const [base, setBase] = useState("")
  useEffect(() => {
    if (locals.length && !locals.includes(base)) setBase(defaultBase(locals))
  }, [locals, base])

  /* version prefilled from the latest semver tag; any manual edit freezes the field */
  const suggested = suggestedFlowVersion("release", tags)
  const [version, setVersion] = useState("")
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched && suggested) setVersion(suggested)
  }, [suggested, touched])

  const included = useMemo(() => items.filter((i) => i.included).map((i) => i.branch), [items])

  /* --- Dry-run: one preview per [base, included order], latest response wins --- */
  const [preview, setPreview] = useState<Map<string, MergePreview>>(new Map())
  const [previewing, setPreviewing] = useState(false)
  const seq = useRef(0)
  useEffect(() => {
    if (!base || !included.length) {
      setPreview(new Map())
      return
    }
    const mine = ++seq.current
    setPreviewing(true)
    api
      .mergePreview(base, included)
      .then(
        (res) => {
          if (seq.current === mine) setPreview(new Map(res.map((p) => [p.branch, p])))
        },
        () => {
          if (seq.current === mine) setPreview(new Map())
        }
      )
      .finally(() => {
        if (seq.current === mine) setPreviewing(false)
      })
  }, [api, base, included])

  /* a branch the base already holds has nothing to merge: unchecked once, automatically —
     re-checking it stays the user's call (autoExcluded remembers who was already handled) */
  const autoExcluded = useRef(new Set<string>())
  useEffect(() => {
    setItems((prev) =>
      prev.map((i) => {
        if (!i.included || preview.get(i.branch)?.status !== "merged" || autoExcluded.current.has(i.branch)) return i
        autoExcluded.current.add(i.branch)
        return { ...i, included: false }
      })
    )
  }, [preview])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* same focus pattern as FlowStartBanner: the version field takes the keyboard on open */
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const move = (branch: string, dir: -1 | 1) =>
    setItems((prev) => {
      const at = prev.findIndex((i) => i.branch === branch)
      const to = at + dir
      if (at < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[at], next[to]] = [next[to], next[at]]
      return next
    })

  async function submit() {
    const v = version.trim()
    if (!v || busy) return
    setBusy(true)
    setError(null)
    const err = await runFlow(() => api.flowStart("release", v, base || undefined))
    setBusy(false)
    if (err) {
      setError(err)
      return
    }
    if (included.length) armMergeQueue(prefix + v, included)
    clearFocus()
    onClose()
  }

  const name = prefix + (version.trim() || "…")

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={RocketIcon} strokeWidth={2} className="size-4 text-release" />
            {messages.release.title}
          </DialogTitle>
          <DialogDescription>{messages.release.intro}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <span className="flex">
            <span className="flex h-7 items-center rounded-l-md border border-r-0 bg-muted px-2 text-xs font-medium text-muted-foreground">
              {prefix}
            </span>
            <input
              value={version}
              onChange={(e) => {
                setTouched(true)
                setVersion(e.target.value)
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void submit())}
              ref={inputRef}
              disabled={busy}
              placeholder={messages.gitflow.versionPlaceholder}
              aria-label={messages.gitflow.startLabel("release")}
              className="h-7 w-28 min-w-0 rounded-r-md border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </span>
          <span className="text-xs text-muted-foreground">{messages.gitflow.from}</span>
          <Select value={base} onValueChange={(v) => setBase(v ?? "")} disabled={busy || locals.length === 0}>
            <SelectTrigger size="sm" aria-label={messages.gitflow.baseLabel("release")} className="max-w-40 min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {locals.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-md border">
          <div className="flex items-center justify-between border-b bg-muted/60 px-2.5 py-1.5">
            <span className="text-[0.625rem] font-medium tracking-wide text-muted-foreground uppercase">
              {messages.release.branchCount(items.length)} · {messages.release.reorderHint}
            </span>
            <Badge color="release" className="h-4 px-1.5">
              {previewing ? <Spinner className="size-2.5" /> : <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} />}
              {messages.release.toMerge(included.length)}
            </Badge>
          </div>
          <ul className="flex max-h-56 flex-col overflow-y-auto">
            {items.map(({ branch, included: on }, at) => {
              const p = preview.get(branch)
              return (
                <li key={branch} className={cn("border-b px-2.5 py-1.5 last:border-b-0", !on && "opacity-60")}>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={on}
                      disabled={busy}
                      onCheckedChange={(v) =>
                        setItems((prev) => prev.map((i) => (i.branch === branch ? { ...i, included: v === true } : i)))
                      }
                      aria-label={messages.release.include(branch)}
                    />
                    <span className={cn("min-w-0 truncate text-xs", on ? "font-medium" : "text-muted-foreground")}>
                      {branch}
                    </span>
                    <span className="ms-auto flex shrink-0 items-center gap-1.5">
                      {on && <PreviewBadge p={p} base={base} />}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-5"
                        disabled={busy || at === 0}
                        onClick={() => move(branch, -1)}
                        aria-label={messages.release.moveUp(branch)}
                      >
                        <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={2} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-5"
                        disabled={busy || at === items.length - 1}
                        onClick={() => move(branch, 1)}
                        aria-label={messages.release.moveDown(branch)}
                      >
                        <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={2} />
                      </Button>
                    </span>
                  </div>
                  {on && p?.status === "conflicts" && (
                    <ul className="mt-1 ml-6 flex flex-col gap-0.5 font-mono text-[0.625rem] text-muted-foreground">
                      {p.files.slice(0, FILES_SHOWN).map((f) => (
                        <li key={f} className="truncate">
                          {f}
                        </li>
                      ))}
                      {p.files.length > FILES_SHOWN && <li>…</li>}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <p className="text-xs text-pretty text-muted-foreground">{messages.release.orderHint}</p>

        <div className="flex flex-col">
          <GitCmd cmd={`git flow release start ${version.trim() || "<version>"}${base ? ` ${base}` : ""}`} />
          {included.map((b) => (
            <GitCmd key={b} cmd={`git merge --no-ff ${b}`} />
          ))}
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            {messages.gitflow.cancel}
          </Button>
          <Button color="release" onClick={() => void submit()} disabled={!version.trim() || busy}>
            {busy ? messages.release.creating : messages.release.create(name)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Predicted outcome of one branch: quiet green when clean, amber with the conflicted paths
    underneath, muted when there is nothing to merge (or nothing to predict). */
function PreviewBadge({ p, base }: { p: MergePreview | undefined; base: string }) {
  if (!p) return null
  if (p.status === "clean")
    return (
      <Badge color="success" className="h-4 px-1.5">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} />
        {messages.release.statusClean}
      </Badge>
    )
  if (p.status === "conflicts")
    return (
      <Badge color="warning" className="h-4 px-1.5">
        <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} />
        {messages.release.conflictedFiles(p.files.length)}
      </Badge>
    )
  if (p.status === "merged")
    return (
      <Badge className="h-4 px-1.5">
        <HugeiconsIcon icon={GitMergeIcon} strokeWidth={2} />
        {messages.release.alreadyIn(base)}
      </Badge>
    )
  return <Badge className="h-4 px-1.5">{messages.release.previewUnavailable}</Badge>
}
