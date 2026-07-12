import {
  Menubar,
  MenubarCheckboxItem as MenubarCheckboxItemPrimitive,
  MenubarContent,
  MenubarGroup,
  MenubarItem as MenubarItemPrimitive,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem as MenubarRadioItemPrimitive,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger as MenubarSubTriggerPrimitive,
  MenubarTrigger,
} from "@/components/ui/primitives/menubar"
import { cn } from "@/lib/utils"

/* Overrides the primitive: min-h-7 → min-h-6 on items and sub-triggers (see context-menu). */
function MenubarItem({ className, ...props }: React.ComponentProps<typeof MenubarItemPrimitive>) {
  return <MenubarItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function MenubarCheckboxItem({ className, ...props }: React.ComponentProps<typeof MenubarCheckboxItemPrimitive>) {
  return <MenubarCheckboxItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function MenubarRadioItem({ className, ...props }: React.ComponentProps<typeof MenubarRadioItemPrimitive>) {
  return <MenubarRadioItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function MenubarSubTrigger({ className, ...props }: React.ComponentProps<typeof MenubarSubTriggerPrimitive>) {
  return <MenubarSubTriggerPrimitive className={cn("min-h-6", className)} {...props} />
}

export {
  Menubar,
  MenubarCheckboxItem,
  MenubarContent,
  MenubarGroup,
  MenubarItem,
  MenubarLabel,
  MenubarMenu,
  MenubarPortal,
  MenubarRadioGroup,
  MenubarRadioItem,
  MenubarSeparator,
  MenubarShortcut,
  MenubarSub,
  MenubarSubContent,
  MenubarSubTrigger,
  MenubarTrigger,
}
