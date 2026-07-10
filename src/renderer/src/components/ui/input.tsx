import { Input as InputPrimitive } from "@/components/ui/primitives/input"
import { cn } from "@/lib/utils"

/* Surcharge du primitive : h-7 → h-6. */
function Input({ className, ...props }: React.ComponentProps<typeof InputPrimitive>) {
  return <InputPrimitive className={cn("h-6", className)} {...props} />
}

export { Input }
