import { useEffect, useMemo, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { useRepoStore } from "@/features/repo/repo-store"
import { useRefsQuery } from "@/features/refs/refs-queries"
import { suggestedFlowVersion, type BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { traceCommand, useTraceStep } from "@/lib/use-trace-step"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { RollingText } from "@/components/ui/rolling-text"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { FLOW_META } from "@/features/flow/flow-context"

type Props = {
  kind: BranchFlow
  /** the configured prefix for this type, e.g. "feature/" — shown as the frozen chip */
  prefix: string
  /** pre-selected start point (the promoted moves pass the trunk HEAD sits on);
      falls back to `defaultBase` when absent or gone */
  initialBase?: string
  /** clear the start intent (submitted, or cancelled) */
  onDone: () => void
}

/* Default start point per kind, mirroring git-flow's own (a hotfix branches off production,
   everything else off integration) and overridable in the selector. Falls through the usual
   trunk names, then any local branch, so the selector is never empty. */
function defaultBase(kind: BranchFlow, branches: string[]): string {
  const has = (n: string) => branches.includes(n)
  const develop = (["develop", "main", "master"] as const).find(has)
  const master = (["master", "main"] as const).find(has)
  return (kind === "hotfix" ? master : develop) ?? branches[0] ?? ""
}

/* The inline start surface (chosen over a modal for start: a quick, single-field, in-context
   action). Lives in the banner strip like FlowBanner; Enter submits, Esc cancels. A failure stays
   inline and keeps the row open so the name can be corrected. */
export function FlowStartBanner({ kind, prefix, initialBase, onDone }: Props) {
  const api = useRepoStore((s) => s.api)
  const repoId = useRepoStore((s) => s.repoId)
  const runFlow = useRepoStore((s) => s.runFlow)
  const [value, setValue] = useState("")
  const [base, setBase] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const { data: refs = [] } = useRefsQuery(api, repoId)
  const branches = useMemo(() => refs.filter((r) => r.kind === "head").map((r) => r.name), [refs])
  /* Seed (and re-seed on kind change) with the requested base — else the default trunk — once
     the branches load; a base the user already picked is kept as long as it still exists. */
  useEffect(() => {
    if (branches.length && !branches.includes(base))
      setBase(initialBase && branches.includes(initialBase) ? initialBase : defaultBase(kind, branches))
  }, [branches, kind, base, initialBase])

  const versioned = kind === "release" || kind === "hotfix"
  /* Prefill the version from the latest semver tag (patch bump for a hotfix, minor for a
     release — see suggestedFlowVersion). The banner is remounted per kind (key= in repo-view),
     and any manual edit freezes the field: the suggestion never overwrites typing. */
  const tags = useMemo(() => refs.filter((r) => r.kind === "tag").map((r) => r.name), [refs])
  const suggested = versioned ? suggestedFlowVersion(kind, tags) : null
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched && suggested) setValue(suggested)
  }, [suggested, touched])
  const m = FLOW_META[kind]

  /* while the start runs, the kind icon gives way to a spinner and the traced git commands
     roll in the banner's free space (same ticker as the commit button). `flowBusy` scopes the
     subscription to the flow commands themselves — `busy` alone would drag the reload's read
     commands into the ticker (cf. repo-store runFlow). */
  const flowBusy = useRepoStore((s) => s.ops.flowBusy)
  const cmd = useTraceStep(repoId, busy && flowBusy, traceCommand)

  async function submit() {
    const name = value.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    const err = await runFlow(() => api.flowStart(kind, name, base || undefined))
    setBusy(false)
    if (err) setError(err)
    else onDone()
  }

  return (
    <div
      className={cn(
        "amont-drop flex h-8 shrink-0 items-center gap-2 border-b px-3.5 text-xs whitespace-nowrap",
        m.bg,
        m.text
      )}
    >
      <HugeiconsIcon icon={m.icon} strokeWidth={2} className="size-3.5 shrink-0" />
      <span className="font-medium">{prefix}</span>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setTouched(true)
          setValue(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            void submit()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onDone()
          }
        }}
        disabled={busy}
        placeholder={versioned ? messages.gitflow.versionPlaceholder : messages.gitflow.namePlaceholder}
        aria-label={messages.gitflow.startLabel(kind)}
        className="h-6 w-56 min-w-0 rounded-sm border border-border bg-background px-1.5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <span className="text-muted-foreground">{messages.gitflow.from}</span>
      <Select value={base} onValueChange={(v) => setBase(v ?? "")} disabled={busy || branches.length === 0}>
        <SelectTrigger
          size="sm"
          aria-label={messages.gitflow.baseLabel(kind)}
          className="max-w-40 min-w-0 text-foreground"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {branches.map((b) => (
            <SelectItem key={b} value={b}>
              {b}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <span className="min-w-0 flex-1 truncate text-destructive">{error}</span>}
      {busy ? (
        /* the expected command seeds the ticker until the first traced one rolls in */
        <RollingText
          text={cmd ?? `git flow ${kind} start ${value.trim()}`}
          shimmer
          className="min-w-0 flex-1 font-mono text-[0.625rem] opacity-80"
        />
      ) : (
        <span className="flex-1" />
      )}
      <Button size="sm" color={m.btn} onClick={() => void submit()} disabled={!value.trim() || busy}>
        {busy ? messages.gitflow.starting : messages.gitflow.start}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDone} aria-label={messages.gitflow.cancelStart}>
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}
