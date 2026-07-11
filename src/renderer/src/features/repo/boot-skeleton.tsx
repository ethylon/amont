import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/* Squelette du boot d'un onglet : recouvre bandeau, sidebar et corps le temps que status, flow,
   worktree et graphe arrivent (cf. RepoView), puis se fond en croix avec le contenu révélé.
   Il n'apparaît qu'après 150 ms — un dépôt local rapide passe du fond nu au contenu sans
   flash de fantômes. */

/* Largeurs figées, pseudo-aléatoires : un squelette stable d'un rendu à l'autre. */
const ROWS = ["w-40", "w-24", "w-36", "w-28", "w-44", "w-32", "w-24", "w-36", "w-28", "w-40", "w-32", "w-24", "w-36", "w-28"]
const REFS = ["w-28", "w-20", "w-24", "w-32", "w-16", "w-24", "w-20"]

export function BootSkeleton({ out, sidebar }: { out: boolean; sidebar: boolean }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShow(true), 150)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      aria-hidden
      className={cn(
        "absolute inset-0 z-10 flex bg-background transition-opacity duration-200 ease-out motion-reduce:transition-none",
        show && !out ? "opacity-100" : "opacity-0",
        out && "pointer-events-none"
      )}
    >
      {sidebar && (
        <div className="w-59 shrink-0 border-r">
          <div className="border-b p-2.5">
            <div className="h-9 rounded-md bg-muted/60" />
          </div>
          <div className="animate-pulse space-y-2.5 px-3.5 py-3 motion-reduce:animate-none">
            {REFS.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="size-3.5 shrink-0 rounded bg-muted" />
                <div className={cn("h-2.5 rounded-full bg-muted", w)} />
              </div>
            ))}
          </div>
        </div>
      )}
      {/* même grille que le contenu réel : le bord du panneau détail ne saute pas au fondu */}
      <div className="grid min-w-0 flex-1 grid-cols-[minmax(280px,1fr)_minmax(240px,320px)]">
        <div className="animate-pulse overflow-hidden motion-reduce:animate-none">
          {ROWS.map((w, i) => (
            <div key={i} className="flex h-7 items-center gap-3 px-4">
              <div className="size-2.5 shrink-0 rounded-full bg-muted" />
              <div className={cn("h-2.5 rounded-full bg-muted", w)} />
              <div className="ms-auto h-2.5 w-16 rounded-full bg-muted" />
              <div className="h-2.5 w-10 rounded-full bg-muted" />
            </div>
          ))}
        </div>
        <div className="border-l px-4.5 py-4">
          <div className="h-2.5 w-32 animate-pulse rounded-full bg-muted motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  )
}
