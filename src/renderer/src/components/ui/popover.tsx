/* Mostly a passthrough of the primitive. The ui/ boundary remains the only import
   surface (AUDIT.md §7, phase 5) — features never import ui/primitives/* directly
   anymore, even when this layer has nothing to add.

   Close and Portal disappeared from the rebuilt shadcn primitive but are still consumed
   (git-console): thin Base UI passthroughs added HERE so the primitive stays pristine. */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"

export { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/primitives/popover"

function PopoverClose({ ...props }: PopoverPrimitive.Close.Props) {
  return <PopoverPrimitive.Close data-slot="popover-close" {...props} />
}

const PopoverPortal = PopoverPrimitive.Portal

export { PopoverClose, PopoverPortal }
