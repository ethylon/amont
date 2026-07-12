import {
  ContextMenu,
  ContextMenuCheckboxItem as ContextMenuCheckboxItemPrimitive,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem as ContextMenuItemPrimitive,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem as ContextMenuRadioItemPrimitive,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger as ContextMenuSubTriggerPrimitive,
  ContextMenuTrigger,
} from "@/components/ui/primitives/context-menu"
import { cn } from "@/lib/utils"

/* Overrides the primitive: min-h-7 → min-h-6 on items and sub-triggers. */
function ContextMenuItem({ className, ...props }: React.ComponentProps<typeof ContextMenuItemPrimitive>) {
  return <ContextMenuItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function ContextMenuCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof ContextMenuCheckboxItemPrimitive>) {
  return <ContextMenuCheckboxItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function ContextMenuRadioItem({ className, ...props }: React.ComponentProps<typeof ContextMenuRadioItemPrimitive>) {
  return <ContextMenuRadioItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function ContextMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof ContextMenuSubTriggerPrimitive>) {
  return <ContextMenuSubTriggerPrimitive className={cn("min-h-6", className)} {...props} />
}

export {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuPortal,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
}
