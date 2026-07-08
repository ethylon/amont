import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/primitives/tooltip"

/* Un contenu survolé au passage (chemin, ligne de fichier, onglet) n'a pas à clignoter : il
   garde la latence de l'attribut `title` qu'il remplace. Les boutons d'icône, eux, ouvrent
   tout de suite (cf. `IconButton`).
   Le provider ne doit pas être à 0 : base-ui y voit un groupe « instantané » et ignore alors
   le `delay` de chaque trigger. */
const DELAY = 1000

type Props = {
  /** rien à dire : l'enfant est rendu tel quel, sans infobulle */
  text: React.ReactNode
  children: React.ReactElement
} & Pick<React.ComponentProps<typeof TooltipContent>, "side" | "align">

/** Remplace `title=` sur un élément non interactif ou déjà libellé. */
export function Tip({ text, children, ...position }: Props) {
  if (!text) return children
  return (
    <Tooltip>
      <TooltipTrigger delay={DELAY} render={children} />
      <TooltipContent {...position}>{text}</TooltipContent>
    </Tooltip>
  )
}
