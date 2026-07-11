import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Props = Omit<React.ComponentProps<typeof Button>, "children"> & {
  label: string
  icon: IconSvgElement
  /** icon for a toggle's second state: the transition fades instead of snapping */
  swapIcon?: IconSvgElement
  /** `true`: `swapIcon` is visible, `icon` fades out */
  swapped?: boolean
}

/* Opacity + scale + blur fade, same curve as tab transitions (see app.css). */
const FADE =
  "transition-[opacity,scale,filter] duration-200 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
const ON = "scale-100 opacity-100 blur-none"
const OFF = "scale-25 opacity-0 blur-xs"

/** Button with no visible label: aria-label carries the accessibility. */
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
    <Button
      variant={variant}
      size={size}
      aria-label={label}
      className={cn(swapIcon && "relative", className)}
      {...props}
    >
      {swapIcon ? (
        <>
          <HugeiconsIcon icon={icon} strokeWidth={2} className={cn(FADE, swapped ? OFF : ON)} />
          {/* both icons stay mounted, stacked: the fade is interruptible */}
          <HugeiconsIcon
            icon={swapIcon}
            strokeWidth={2}
            className={cn("absolute inset-0 m-auto", FADE, swapped ? ON : OFF)}
          />
        </>
      ) : (
        <HugeiconsIcon icon={icon} strokeWidth={2} />
      )}
    </Button>
  )
}
