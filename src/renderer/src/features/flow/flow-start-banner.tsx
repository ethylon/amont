import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { useRepoStore } from "@/features/repo/repo-store"
import type { BranchFlow } from "@/lib/gitflow"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FLOW_META } from "@/features/flow/flow-context"

type Props = {
  kind: BranchFlow
  /** the configured prefix for this type, e.g. "feature/" — shown as the frozen chip */
  prefix: string
  /** clear the start intent (submitted, or cancelled) */
  onDone: () => void
}

/* The inline start surface (chosen over a modal for start: a quick, single-field, in-context
   action). Lives in the banner strip like FlowBanner; Enter submits, Esc cancels. A failure stays
   inline and keeps the row open so the name can be corrected. */
export function FlowStartBanner({ kind, prefix, onDone }: Props) {
  const api = useRepoStore((s) => s.api)
  const runFlow = useRepoStore((s) => s.runFlow)
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const versioned = kind === "release" || kind === "hotfix"
  const m = FLOW_META[kind]

  async function submit() {
    const name = value.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    const err = await runFlow(() => api.flowStart(kind, name))
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
        onChange={(e) => setValue(e.target.value)}
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
      {error && <span className="min-w-0 flex-1 truncate text-destructive">{error}</span>}
      <span className="flex-1" />
      <Button size="sm" color={m.btn} onClick={() => void submit()} disabled={!value.trim() || busy}>
        {busy ? messages.gitflow.starting : messages.gitflow.start}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDone} aria-label={messages.gitflow.cancelStart}>
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}
