import { cva, type VariantProps } from "class-variance-authority"

import { Checkbox as CheckboxPrimitive } from "@/components/ui/primitives/checkbox"
import { cn } from "@/lib/utils"

/* Overrides the primitive with a hue axis, same principle as ui/button (--btn-color): the
   primitive only knows primary for the checked box. `color` retints it via --checkbox-color so
   it can follow the flow banner's hue, the tick in `text-background` like the button label
   (light tick on dark tint in light theme, dark tick on vivid tint in dark). The extra
   dark:data-checked:bg-* is required: the primitive re-asserts bg-primary under dark:, out of
   reach of the unprefixed override. */
const checkboxColorVariants = cva(
  "data-checked:border-(--checkbox-color) data-checked:bg-(--checkbox-color) data-checked:text-background focus-visible:border-(--checkbox-color) focus-visible:ring-(--checkbox-color)/30 dark:data-checked:bg-(--checkbox-color)",
  {
    variants: {
      color: {
        success: "[--checkbox-color:var(--success)]",
        warning: "[--checkbox-color:var(--warning)]",
        release: "[--checkbox-color:var(--release)]",
        destructive: "[--checkbox-color:var(--destructive)]",
      },
    },
  }
)

/* Without `color`, plain passthrough of the primitive (AUDIT.md §7, phase 5 — ui/ boundary). */
function Checkbox({
  className,
  color,
  ...props
}: Omit<React.ComponentProps<typeof CheckboxPrimitive>, "color"> & VariantProps<typeof checkboxColorVariants>) {
  return <CheckboxPrimitive className={cn(color && checkboxColorVariants({ color }), className)} {...props} />
}

export { Checkbox }
