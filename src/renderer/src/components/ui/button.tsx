import { cva, type VariantProps } from "class-variance-authority"

import { Button as ButtonPrimitive } from "@/components/ui/primitives/button"
import { cn } from "@/lib/utils"

/* Axe de teinte, séparé de l'axe `variant` du primitive (même principe que ui/badge) : le primitive
   ne connaît que primary et destructive. `color` réinjecte une teinte sémantique via --btn-color et
   repeint un bouton plein — lisible sur la bannière flow de même teinte. `text-background` suit le
   thème : texte clair sur teinte foncée en clair, texte foncé sur teinte vive en sombre. */
const buttonColorVariants = cva(
  "bg-(--btn-color) text-background hover:bg-(--btn-color)/90 focus-visible:border-(--btn-color) focus-visible:ring-(--btn-color)/30",
  {
    variants: {
      color: {
        success: "[--btn-color:var(--success)]",
        warning: "[--btn-color:var(--warning)]",
        release: "[--btn-color:var(--release)]",
        destructive: "[--btn-color:var(--destructive)]",
      },
    },
  }
)

export type ButtonColor = NonNullable<VariantProps<typeof buttonColorVariants>["color"]>

/* Surcharge du primitive : default h-7 → h-6, icon size-7 → size-6, plus l'axe `color`. */
function Button({
  className,
  color,
  size = "default",
  ...props
}: Omit<React.ComponentProps<typeof ButtonPrimitive>, "color"> & VariantProps<typeof buttonColorVariants>) {
  return (
    <ButtonPrimitive
      size={size}
      className={cn(
        size === "default" && "h-6",
        size === "icon" && "size-6",
        color && buttonColorVariants({ color }),
        className
      )}
      {...props}
    />
  )
}

export { Button }
