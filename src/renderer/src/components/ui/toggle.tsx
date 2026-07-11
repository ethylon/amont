import { Toggle as TogglePrimitive } from "@/components/ui/primitives/toggle"
import { cn } from "@/lib/utils"

/* Overrides the primitive: the default size goes from h-7/min-w-7 to h-6/min-w-6. */
function Toggle({ className, size = "default", ...props }: React.ComponentProps<typeof TogglePrimitive>) {
  return <TogglePrimitive size={size} className={cn(size === "default" && "h-6 min-w-6", className)} {...props} />
}

export { Toggle }
