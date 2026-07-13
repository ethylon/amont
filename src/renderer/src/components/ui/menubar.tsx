import {
  Menubar as MenubarPrimitive,
  MenubarCheckboxItem as MenubarCheckboxItemPrimitive,
  MenubarContent as MenubarContentPrimitive,
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
function Menubar({ className, ...props }: React.ComponentProps<typeof MenubarPrimitive>) {
  return <MenubarPrimitive className={cn("border-none", className)} {...props} />
}

/* w-auto : le primitive fige la largeur sur --anchor-width (base-ui) — les menus doivent
   suivre leur contenu. */
function MenubarContent({ className, ...props }: React.ComponentProps<typeof MenubarContentPrimitive>) {
  return <MenubarContentPrimitive className={cn("w-auto", className)} {...props} />
}

function MenubarItem({ className, ...props }: React.ComponentProps<typeof MenubarItemPrimitive>) {
  return <MenubarItemPrimitive className={cn("min-h-6", className)} {...props} />
}

/* size-3.5 : le primitive omet la contrainte svg que MenubarItem et MenubarRadioItem ont. */
function MenubarCheckboxItem({ className, ...props }: React.ComponentProps<typeof MenubarCheckboxItemPrimitive>) {
  return (
    <MenubarCheckboxItemPrimitive
      className={cn("min-h-6 [&_svg:not([class*='size-'])]:size-3.5", className)}
      {...props}
    />
  )
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
