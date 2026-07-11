import { ToggleGroup, ToggleGroupItem as ToggleGroupItemPrimitive } from "@/components/ui/primitives/toggle-group"
import { cn } from "@/lib/utils"

/* Overrides the primitive: items at the default size go from h-7/min-w-7 to h-6/min-w-6.
   The effective size (prop or group context) is only known inside the primitive:
   we target its data-size attribute rather than the prop. */
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupItemPrimitive>) {
  return (
    <ToggleGroupItemPrimitive
      className={cn("data-[size=default]:h-6 data-[size=default]:min-w-6", className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
