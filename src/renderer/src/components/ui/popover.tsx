/* No override: plain passthrough of the primitive. The ui/ boundary remains the only import
   surface (AUDIT.md §7, phase 5) — features never import ui/primitives/* directly
   anymore, even when this layer has nothing to add. */
export {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverPortal,
  PopoverTrigger,
} from "@/components/ui/primitives/popover"
