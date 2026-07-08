import { Mark } from "@/components/mark"
import { Button } from "@/components/ui/primitives/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/primitives/empty"

export function EmptyState({ onOpenRepo }: { onOpenRepo(): void }) {
  return (
    /* le halo radial ne relève d'aucune primitive : il vit sur le conteneur, pas sur Empty */
    <div className="relative grid flex-1 place-items-center overflow-hidden before:pointer-events-none before:absolute before:top-1/2 before:left-1/2 before:size-[min(70vw,620px)] before:-translate-x-1/2 before:-translate-y-1/2 before:rounded-full before:bg-radial before:from-primary/12 before:to-transparent before:to-66%">
      <Empty className="relative">
        <EmptyHeader>
          <EmptyMedia>
            <Mark className="size-11" />
          </EmptyMedia>
          <EmptyTitle className="text-base">Aucun repo ouvert</EmptyTitle>
          <EmptyDescription>
            Choisis un dossier versionné avec Git pour explorer son graphe de commits, ses branches et ses diffs.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={onOpenRepo}>Ouvrir un repo…</Button>
        </EmptyContent>
      </Empty>
    </div>
  )
}
