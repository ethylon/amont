import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { TerminalIcon, Delete02Icon, Cancel01Icon } from "@hugeicons/core-free-icons"

import { onTrace, type TraceLine } from "@/lib/git"
import { messages } from "@/lib/messages"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/* `key`: lines have no identity of their own on the main side; a local counter is enough for React. */
type Entry = TraceLine & { key: number }

/* Bounded buffer: a debug console, not a log. Beyond that, the oldest lines drop. */
const CAP = 500

/** Read-only git console: last line in the status bar, full history on click.

    Base UI Popover rather than a hand-rolled popover (AUDIT.md §8): role="dialog" set on the Popup by
    the primitive, initial focus in the panel and returned to the trigger on close, Escape and
    click outside the panel handled natively — the old `fixed inset-0` button that simulated a click
    outside the panel goes away with it. */
export function GitConsole({ repoId }: { repoId: number }) {
  const [lines, setLines] = useState<Entry[]>([])
  const [open, setOpen] = useState(false)
  const keyRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(
    () =>
      onTrace((p) => {
        if (p.id !== repoId) return
        setLines((prev) => {
          const next = [...prev, { ...p, key: keyRef.current++ }]
          return next.length > CAP ? next.slice(next.length - CAP) : next
        })
      }),
    [repoId]
  )

  /* high priority, in addition to the primitive's native Escape: the console is a floating overlay
     above everything else, its Escape must never fall through to the one that closes the diff (see
     app/shortcuts.ts) — explicit guard, regardless of the order of Base UI's internal listeners. */
  useShortcut(open, PRIORITY.OVERLAY, (e) => {
    if (e.key !== "Escape") return false
    setOpen(false)
    return true
  })

  /* on open: show the most recent */
  useLayoutEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [open])

  /* new line: follow the bottom, unless the user has scrolled up to read the history */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!open || !el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) el.scrollTop = el.scrollHeight
  }, [lines, open])

  const clear = useCallback(() => {
    setLines([])
    keyRef.current = 0
  }, [])

  /* last "spoken" line: neither the outcome (exit) nor an operation header */
  let last: Extract<Entry, { kind: "cmd" | "out" }> | undefined
  for (let i = lines.length - 1; i >= 0 && !last; i--) {
    const l = lines[i]
    if (l.kind === "cmd" || l.kind === "out") last = l
  }
  const busy = lines.length > 0 && lines[lines.length - 1].kind !== "exit"

  /* last failed command, announced to screen readers (AUDIT.md §8) — independent of
     whether the panel is open or not, like the status bar's operation feed (opState). */
  let lastFailure: string | null = null
  for (let i = lines.length - 1; i >= 0 && lastFailure === null; i--) {
    const l = lines[i]
    if (l.kind !== "exit" || l.ok) continue
    lastFailure = "commande"
    for (let j = i - 1; j >= 0; j--) {
      const p = lines[j]
      if (p.kind === "cmd") {
        lastFailure = p.text
        break
      }
    }
  }

  return (
    <div className="flex min-w-0">
      <span aria-live="polite" className="sr-only">
        {lastFailure ? messages.console.commandFailed(lastFailure) : ""}
      </span>

      <Popover open={open} onOpenChange={setOpen} modal="trap-focus">
        <PopoverTrigger
          aria-busy={busy}
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          )}
        >
          <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} className="size-3 shrink-0" />
          <span className="max-w-[52ch] truncate">{last?.text ?? messages.console.ready}</span>
          {busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
        </PopoverTrigger>

        <PopoverContent aria-label={messages.console.gitConsole} className="flex w-[min(90vw,44rem)] flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
            <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} className="size-3 text-muted-foreground" />
            <span className="text-[0.6875rem] font-medium">{messages.console.gitConsole}</span>
            <span className="text-[0.625rem] text-muted-foreground tabular-nums">{lines.length}</span>
            <div className="ms-auto flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={clear} disabled={!lines.length}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                {messages.console.clear}
              </Button>
              <PopoverClose
                render={<Button variant="ghost" size="icon-xs" className="relative after:absolute after:-inset-1" />}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                <span className="sr-only">{messages.console.close}</span>
              </PopoverClose>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 max-h-[min(60vh,24rem)] flex-1 overflow-auto px-2.5 py-2 font-mono text-[0.6875rem] leading-relaxed"
          >
            {lines.length === 0 ? (
              <p className="text-muted-foreground">{messages.console.noCommandsYet}</p>
            ) : (
              lines.map((l) => <Line key={l.key} line={l} />)
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour12: false })

function Line({ line }: { line: Entry }) {
  if (line.kind === "group")
    return (
      <div className="mt-3 mb-1 flex items-center gap-2 first:mt-0">
        <span className="shrink-0 text-[0.625rem] font-semibold tracking-wide text-foreground uppercase">
          {line.text}
        </span>
        <span className="shrink-0 text-[0.5625rem] tabular-nums text-muted-foreground">{fmtTime(line.ts)}</span>
        <span className="h-px flex-1 bg-border" />
      </div>
    )
  if (line.kind === "cmd")
    return (
      <div className="mt-2 flex gap-1.5 text-foreground first:mt-0">
        <span className="shrink-0 text-primary select-none">$</span>
        <span className="break-all whitespace-pre-wrap">{line.text}</span>
      </div>
    )
  if (line.kind === "out")
    return <div className="ps-3 break-all whitespace-pre-wrap text-muted-foreground">{line.text}</div>
  /* success: the output speaks for itself, we only flag the failure */
  if (line.ok) return null
  return <div className="ps-3 text-destructive">{messages.console.failed}</div>
}
