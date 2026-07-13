import { useEffect, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"

import { host, onUpdate, type UpdateStatus } from "@/lib/git"
import { messages } from "@/lib/messages"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"

/* La carte de mise à jour (coin bas-droit). Pilotée par l'événement `update:status`
   (main/updater.ts) : le check silencieux du démarrage ne fait apparaître la carte qu'à
   l'état "ready" — un check manuel (Help ▸ Check for updates) montre aussi les états
   intermédiaires (checking, up to date, téléchargement, erreur).

   "Restart now" installe tout de suite (quitAndInstall) ; "Later" referme la carte,
   l'installation se fera au prochain quit (autoInstallOnAppQuit). Le rejet par `kind`
   plutôt qu'un booléen : les événements de progression répétés ne rouvrent pas une carte
   fermée en plein téléchargement, mais l'arrivée de "ready" la rouvre. */
export function UpdateCard() {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [dismissedKind, setDismissedKind] = useState<UpdateStatus["kind"] | null>(null)

  useEffect(
    () =>
      onUpdate((s) => {
        setStatus(s)
        setDismissedKind((k) => (k === s.kind ? k : null))
      }),
    []
  )

  /* "up to date" (check manuel) : confirmation transitoire, la carte se referme seule */
  useEffect(() => {
    if (status?.kind !== "none") return
    const t = setTimeout(() => setStatus(null), 4000)
    return () => clearTimeout(t)
  }, [status])

  if (!status || status.kind === dismissedKind) return null
  if (status.origin === "auto" && status.kind !== "ready") return null

  const dismiss = () => setDismissedKind(status.kind)

  return (
    <div
      role="status"
      className="absolute right-3 bottom-3 z-50 w-72 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md"
    >
      <div className="flex items-start gap-2">
        {(status.kind === "checking" || status.kind === "downloading") && (
          <Spinner className="mt-0.5 size-3.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          {status.kind === "checking" && <p>{messages.updater.checking}</p>}
          {status.kind === "none" && <p>{messages.updater.upToDate}</p>}
          {status.kind === "downloading" && (
            <>
              <p className="truncate">{messages.updater.downloading(status.version)}</p>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${status.percent}%` }} />
              </div>
            </>
          )}
          {status.kind === "ready" && <p className="font-medium">{messages.updater.ready(status.version)}</p>}
          {status.kind === "error" && <p className="text-destructive">{messages.updater.failed}</p>}
          {status.kind === "unavailable" && <p className="text-muted-foreground">{messages.updater.unavailable}</p>}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-1"
          onClick={dismiss}
          aria-label={messages.updater.dismiss}
        >
          <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
        </Button>
      </div>
      {status.kind === "ready" && (
        <div className="mt-2.5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={dismiss}>
            {messages.updater.later}
          </Button>
          <Button size="sm" onClick={() => void host.installUpdate()}>
            {messages.updater.restartNow}
          </Button>
        </div>
      )}
    </div>
  )
}
