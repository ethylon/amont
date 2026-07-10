import { Button as ButtonPrimitive } from "@/components/ui/primitives/button"
import { cn } from "@/lib/utils"

/* Surcharge du primitive : default h-7 → h-6, icon size-7 → size-6. */
function Button({ className, size = "default", ...props }: React.ComponentProps<typeof ButtonPrimitive>) {
  return (
    <ButtonPrimitive
      size={size}
      className={cn(size === "default" && "h-6", size === "icon" && "size-6", className)}
      {...props}
    />
  )
}

export { Button }
