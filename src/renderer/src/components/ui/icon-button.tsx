import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { Button } from "@/components/ui/primitives/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/primitives/tooltip"

type Props = Omit<React.ComponentProps<typeof Button>, "children"> & {
  label: string
  icon: IconSvgElement
}

/** Bouton sans libellé visible : l'infobulle porte le sens, aria-label l'accessibilité. */
export function IconButton({ label, icon, variant = "ghost", size = "icon", ...props }: Props) {
  return (
    <Tooltip>
      {/* l'infobulle est le seul libellé du bouton : elle ne se fait pas attendre */}
      <TooltipTrigger delay={0} render={<Button variant={variant} size={size} aria-label={label} {...props} />}>
        <HugeiconsIcon icon={icon} strokeWidth={2} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
