import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { TerminalIcon, Delete02Icon, Cancel01Icon } from "@hugeicons/core-free-icons"

import { onTrace, type TraceLine } from "@/lib/git"
import { PRIORITY, useShortcut } from "@/app/shortcuts"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/* `key` : les lignes n'ont pas d'identité propre côté main ; un compteur local suffit à React. */
type Entry = TraceLine & { key: number }

/* Tampon borné : une console de debug, pas un journal. Au-delà, les plus vieilles tombent. */
const CAP = 500

/** Console git en lecture seule : dernière ligne dans la barre de statut, tout l'historique au clic.

    Popover Base UI plutôt que popover fait main (AUDIT.md §8) : role="dialog" de la Popup posé par
    la primitive, focus initial dans le panneau et rendu au déclencheur à la fermeture, Escape et
    clic hors du panneau gérés nativement — l'ancien bouton `fixed inset-0` qui simulait un clic
    hors-panneau disparaît avec. */
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

  /* priorité haute, en plus de l'Escape natif de la primitive : la console est un overlay flottant
     au-dessus du reste, son Escape ne doit jamais descendre jusqu'à celui qui ferme le diff (cf.
     app/shortcuts.ts) — garde explicite, quel que soit l'ordre des listeners internes de Base UI. */
  useShortcut(open, PRIORITY.OVERLAY, (e) => {
    if (e.key !== "Escape") return false
    setOpen(false)
    return true
  })

  /* à l'ouverture : montrer le plus récent */
  useLayoutEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [open])

  /* nouvelle ligne : suivre le bas, sauf si l'utilisateur a remonté lire l'historique */
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!open || !el) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 40) el.scrollTop = el.scrollHeight
  }, [lines, open])

  const clear = useCallback(() => {
    setLines([])
    keyRef.current = 0
  }, [])

  /* dernière ligne « dite » : ni l'issue (exit), ni un en-tête d'opération */
  let last: Extract<Entry, { kind: "cmd" | "out" }> | undefined
  for (let i = lines.length - 1; i >= 0 && !last; i--) {
    const l = lines[i]
    if (l.kind === "cmd" || l.kind === "out") last = l
  }
  const busy = lines.length > 0 && lines[lines.length - 1].kind !== "exit"

  /* dernière commande en échec, annoncée aux lecteurs d'écran (AUDIT.md §8) — indépendant du
     panneau ouvert ou non, comme le fil d'opérations de la barre de statut (opState). */
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
        {lastFailure ? `Commande échouée : ${lastFailure}` : ""}
      </span>

      <Popover open={open} onOpenChange={setOpen} modal="trap-focus">
        <PopoverTrigger
          aria-busy={busy}
          className={cn(
            "flex min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-0.5 font-mono text-[0.625rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground"
          )}
        >
          <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} className="size-3 shrink-0" />
          <span className="max-w-[52ch] truncate">{last?.text ?? "Prêt"}</span>
          {busy && <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />}
        </PopoverTrigger>

        <PopoverContent aria-label="Console git" className="flex w-[min(90vw,44rem)] flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5">
            <HugeiconsIcon icon={TerminalIcon} strokeWidth={2} className="size-3 text-muted-foreground" />
            <span className="text-[0.6875rem] font-medium">Console git</span>
            <span className="text-[0.625rem] text-muted-foreground tabular-nums">{lines.length}</span>
            <div className="ms-auto flex items-center gap-1">
              <Button variant="ghost" size="xs" onClick={clear} disabled={!lines.length}>
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
                Effacer
              </Button>
              <PopoverClose
                render={<Button variant="ghost" size="icon-xs" className="relative after:absolute after:-inset-1" />}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
                <span className="sr-only">Fermer</span>
              </PopoverClose>
            </div>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 max-h-[min(60vh,24rem)] flex-1 overflow-auto px-2.5 py-2 font-mono text-[0.6875rem] leading-relaxed"
          >
            {lines.length === 0 ? (
              <p className="text-muted-foreground">Aucune commande pour l'instant.</p>
            ) : (
              lines.map((l) => <Line key={l.key} line={l} />)
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}

const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString("fr", { hour12: false })

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
  /* succès : la sortie parle d'elle-même, on ne marque que l'échec */
  if (line.ok) return null
  return <div className="ps-3 text-destructive">✗ échec</div>
}
