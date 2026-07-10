import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { Button } from "@/components/ui/primitives/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/primitives/tooltip"
import { cn } from "@/lib/utils"

type Props = Omit<React.ComponentProps<typeof Button>, "children"> & {
  label: string
  icon: IconSvgElement
  /** icône du second état d'une bascule : le passage se fond au lieu de claquer */
  swapIcon?: IconSvgElement
  /** `true` : `swapIcon` est visible, `icon` s'efface */
  swapped?: boolean
}

/* Fondu opacité + échelle + flou, même courbe que les transitions d'onglet (cf. app.css). */
const FADE =
  "transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
const ON = "scale-100 opacity-100 blur-none"
const OFF = "scale-25 opacity-0 blur-xs"

/** Bouton sans libellé visible : l'infobulle porte le sens, aria-label l'accessibilité. */
export function IconButton({
  label,
  icon,
  swapIcon,
  swapped = false,
  variant = "ghost",
  size = "icon",
  className,
  ...props
}: Props) {
  return (
    <Tooltip>
      {/* l'infobulle est le seul libellé du bouton : elle ne se fait pas attendre */}
      <TooltipTrigger
        delay={0}
        render={
          <Button
            variant={variant}
            size={size}
            aria-label={label}
            className={cn(swapIcon && "relative", className)}
            {...props}
          />
        }
      >
        {swapIcon ? (
          <>
            <HugeiconsIcon icon={icon} strokeWidth={2} className={cn(FADE, swapped ? OFF : ON)} />
            {/* les deux icônes restent montées, superposées : le fondu est interruptible */}
            <HugeiconsIcon
              icon={swapIcon}
              strokeWidth={2}
              className={cn("absolute inset-0 m-auto", FADE, swapped ? ON : OFF)}
            />
          </>
        ) : (
          <HugeiconsIcon icon={icon} strokeWidth={2} />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
