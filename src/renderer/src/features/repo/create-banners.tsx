/* Inline creation banners opened by the graph's commit context menu: a branch or a worktree
   anchored on a right-clicked commit. Same surface as the git-flow start banner (a quick,
   single-field, in-context action — cf. flow-start-banner.tsx): the strip lives above the
   graph, Enter submits, Esc cancels, and a failure stays inline so the name can be corrected. */

import { useEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, FolderAddIcon, GitBranchIcon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import { shortHash } from "@/features/graph/ids"
import { useRepoStore } from "@/features/repo/repo-store"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { RollingText } from "@/components/ui/rolling-text"
import { Spinner } from "@/components/ui/spinner"

/** Shared strip: icon (spinner while busy), name input, the anchoring "at <hash>" chip,
    optional extras, and the submit/cancel pair with the expected command rolling while busy. */
function CreateBanner({
  icon,
  label,
  from,
  cmd,
  extra,
  onSubmit,
  onDone,
}: {
  icon: typeof GitBranchIcon
  label: string
  /** full SHA of the anchoring commit */
  from: string
  /** expected git command for the busy ticker, from the current name */
  cmd(name: string): string
  extra?: React.ReactNode
  /** runs the creation; resolves to the error text, `null` on success */
  onSubmit(name: string): Promise<string | null>
  onDone(): void
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  async function submit() {
    const name = value.trim()
    if (!name || busy) return
    setBusy(true)
    setError(null)
    const err = await onSubmit(name)
    setBusy(false)
    if (err) setError(err)
    else onDone()
  }

  return (
    <div className="amont-drop flex h-8 shrink-0 items-center gap-2 border-b px-3.5 text-xs whitespace-nowrap">
      {busy ? (
        <Spinner className="size-3.5 shrink-0" />
      ) : (
        <HugeiconsIcon icon={icon} strokeWidth={2} className="size-3.5 shrink-0" />
      )}
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
        placeholder={messages.commit.branchPlaceholder}
        aria-label={label}
        className="h-6 w-56 min-w-0 rounded-sm border border-border bg-background px-1.5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      <span className="text-muted-foreground">{messages.commit.at}</span>
      <span className="font-mono text-muted-foreground">{shortHash(from)}</span>
      {extra}
      {error && <span className="min-w-0 flex-1 truncate text-destructive">{error}</span>}
      {busy ? (
        <RollingText text={cmd(value.trim())} className="shimmer min-w-0 flex-1 font-mono text-[0.625rem] opacity-80" />
      ) : (
        <span className="flex-1" />
      )}
      <Button size="sm" onClick={() => void submit()} disabled={!value.trim() || busy}>
        {busy ? messages.commit.creating : messages.commit.create}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onDone} aria-label={messages.commit.cancel}>
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  )
}

export function BranchCreateBanner({ from, onDone }: { from: string; onDone(): void }) {
  const createBranch = useRepoStore((s) => s.createBranch)
  /* checked out right away by default: creating a branch here usually means working on it */
  const [checkout, setCheckout] = useState(true)
  const checkoutId = `branch-checkout-${from.slice(0, 8)}`

  return (
    <CreateBanner
      icon={GitBranchIcon}
      label={messages.commit.branchBannerLabel(shortHash(from))}
      from={from}
      cmd={(name) => `git branch ${name} ${shortHash(from)}`}
      extra={
        <span className="flex items-center gap-1.5">
          <Checkbox id={checkoutId} checked={checkout} onCheckedChange={(v) => setCheckout(v)} />
          <label htmlFor={checkoutId} className="cursor-pointer text-muted-foreground select-none">
            {messages.commit.checkoutAfterCreate}
          </label>
        </span>
      }
      onSubmit={(name) => createBranch(name, from, checkout)}
      onDone={onDone}
    />
  )
}

export function WorktreeCreateBanner({ from, onDone }: { from: string; onDone(): void }) {
  const addWorktreeFrom = useRepoStore((s) => s.addWorktreeFrom)
  return (
    <CreateBanner
      icon={FolderAddIcon}
      label={messages.commit.worktreeBannerLabel(shortHash(from))}
      from={from}
      cmd={(name) => `git worktree add -b ${name} <dir> ${shortHash(from)}`}
      onSubmit={(name) => addWorktreeFrom(name, from)}
      onDone={onDone}
    />
  )
}
