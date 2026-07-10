import {
  InputGroup as InputGroupPrimitive,
  InputGroupAddon,
  InputGroupButton as InputGroupButtonPrimitive,
  InputGroupInput as InputGroupInputPrimitive,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/primitives/input-group"
import { cn } from "@/lib/utils"

/* Surcharge du primitive : h-7 → h-6 sur le conteneur et sur l'input
   (qui hérite sinon du h-7 du primitive Input). */
function InputGroup({ className, ...props }: React.ComponentProps<typeof InputGroupPrimitive>) {
  return <InputGroupPrimitive className={cn("h-6", className)} {...props} />
}

function InputGroupInput({ className, ...props }: React.ComponentProps<typeof InputGroupInputPrimitive>) {
  return <InputGroupInputPrimitive className={cn("h-6", className)} {...props} />
}

/* icon-sm : size-7 → size-6. */
function InputGroupButton({
  className,
  size = "xs",
  ...props
}: React.ComponentProps<typeof InputGroupButtonPrimitive>) {
  return (
    <InputGroupButtonPrimitive
      size={size}
      className={cn(size === "icon-sm" && "size-6", className)}
      {...props}
    />
  )
}

export { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput, InputGroupText, InputGroupTextarea }
