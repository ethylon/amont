import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem as CommandItemPrimitive,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/primitives/command"
import { cn } from "@/lib/utils"

/* Surcharge du primitive : min-h-7 → min-h-6 sur les items. */
function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandItemPrimitive>) {
  return <CommandItemPrimitive className={cn("min-h-6", className)} {...props} />
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
