import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Alert02Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import { useRepoStore } from "@/features/repo/repo-store"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { GitCmd } from "@/components/ui/git-cmd"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

/* Inline reword of the selected commit — HEAD only, the one commit an amend reaches without
   a rebase. `--only` keeps the staged tree out of it: editing words must never silently
   commit whatever happens to be staged. Failure stays inline (like the flow banners) so the
   message can be corrected without retyping it. */
export function RewordForm({
  initial,
  pushed,
  onClose,
}: {
  initial: { subject: string; description: string }
  /** the commit is already on its upstream: amending will call for a force push (warn, don't block) */
  pushed: boolean
  onClose(): void
}) {
  const reword = useRepoStore((s) => s.rewordHead)
  const [subject, setSubject] = useState(initial.subject)
  const [description, setDescription] = useState(initial.description)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = subject.trim().length > 0

  const submit = async () => {
    if (!ready || busy) return
    setBusy(true)
    const err = await reword(subject, description)
    setBusy(false)
    if (err) setError(err)
    else onClose() // success: the store re-anchors the selection on the new HEAD
  }

  return (
    <FieldGroup
      className="shrink-0"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onClose()
      }}
    >
      <Field data-invalid={!!error || undefined}>
        {error && <FieldError>{error}</FieldError>}
        <Input
          name="subject"
          aria-label={messages.worktree.commitMessage}
          placeholder={messages.worktree.commitMessage}
          value={subject}
          autoFocus
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
          }}
        />
        <Textarea
          name="description"
          aria-label={messages.worktree.description}
          placeholder={messages.worktree.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-16 resize-y text-xs"
        />
        {pushed && (
          <p className="flex items-start gap-1.5 text-xs text-warning">
            <HugeiconsIcon icon={Alert02Icon} strokeWidth={2} className="mt-0.5 size-3.5 shrink-0" />
            {messages.detail.pushedWarning}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            /* busy ≠ greyed out, same convention as the staging panel's commit button */
            className="h-auto min-h-6 flex-1 flex-col gap-0 py-1 aria-busy:opacity-100!"
            disabled={!ready || busy}
            aria-busy={busy}
            onClick={() => void submit()}
          >
            <span className={cn("max-w-full truncate", busy && "shimmer")}>{messages.worktree.amend}</span>
            <GitCmd cmd='git commit --amend --only -m "…"' running={busy} className="text-primary-foreground/70" />
          </Button>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            {messages.detail.cancel}
          </Button>
        </div>
      </Field>
    </FieldGroup>
  )
}
