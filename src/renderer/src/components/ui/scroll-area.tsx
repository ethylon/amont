/* No override: plain passthrough of the primitive. The ui/ boundary remains the only import
   surface (AUDIT.md §7, phase 5) — features never import ui/primitives/* directly. */
export { ScrollArea, ScrollBar } from "@/components/ui/primitives/scroll-area"
