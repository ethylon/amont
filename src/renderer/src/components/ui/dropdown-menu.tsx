import {
  DropdownMenu,
  DropdownMenuCheckboxItem as DropdownMenuCheckboxItemPrimitive,
  DropdownMenuContent as DropdownMenuContentPrimitive,
  DropdownMenuGroup,
  DropdownMenuItem as DropdownMenuItemPrimitive,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem as DropdownMenuRadioItemPrimitive,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger as DropdownMenuSubTriggerPrimitive,
  DropdownMenuTrigger,
} from "@/components/ui/primitives/dropdown-menu"
import { cn } from "@/lib/utils"

/* Même correctif que context-menu.tsx : le preset inverted-translucent (rebuild 8fad3df)
   neutralise la variante destructive en accent-foreground!important sur le popup. */
function DropdownMenuContent({ className, ...props }: React.ComponentProps<typeof DropdownMenuContentPrimitive>) {
  return (
    <DropdownMenuContentPrimitive
      className={cn(
        "**:data-[variant=destructive]:text-destructive! **:data-[variant=destructive]:**:text-destructive! **:data-[variant=destructive]:focus:bg-destructive/10!",
        className
      )}
      {...props}
    />
  )
}

/* Overrides the primitive: min-h-7 → min-h-6 on items and sub-triggers. */
function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuItemPrimitive>) {
  return <DropdownMenuItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function DropdownMenuCheckboxItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuCheckboxItemPrimitive>) {
  return <DropdownMenuCheckboxItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function DropdownMenuRadioItem({ className, ...props }: React.ComponentProps<typeof DropdownMenuRadioItemPrimitive>) {
  return <DropdownMenuRadioItemPrimitive className={cn("min-h-6", className)} {...props} />
}

function DropdownMenuSubTrigger({ className, ...props }: React.ComponentProps<typeof DropdownMenuSubTriggerPrimitive>) {
  return <DropdownMenuSubTriggerPrimitive className={cn("min-h-6", className)} {...props} />
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}
