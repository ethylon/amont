import { ToggleGroup, ToggleGroupItem as ToggleGroupItemPrimitive } from "@/components/ui/primitives/toggle-group"
import { cn } from "@/lib/utils"

/* Surcharge du primitive : les items en taille default passent de h-7/min-w-7 à h-6/min-w-6.
   La taille effective (prop ou contexte du groupe) n'est connue que dans le primitive :
   on cible son attribut data-size plutôt que la prop. */
function ToggleGroupItem({ className, ...props }: React.ComponentProps<typeof ToggleGroupItemPrimitive>) {
  return (
    <ToggleGroupItemPrimitive
      className={cn("data-[size=default]:h-6 data-[size=default]:min-w-6", className)}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
