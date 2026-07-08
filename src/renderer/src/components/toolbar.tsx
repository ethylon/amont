import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Search01Icon } from "@hugeicons/core-free-icons"

import type { LogMode } from "@/lib/git"
import { Button } from "@/components/ui/primitives/button"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/primitives/input-group"
import { Toggle } from "@/components/ui/primitives/toggle"

type Props = {
  mode: LogMode
  onModeChange(mode: LogMode): void
  onLoadAll(): void
}

export function Toolbar({ mode, onModeChange, onLoadAll }: Props) {
  return (
    <div className="flex h-11.5 shrink-0 items-center gap-2 border-b px-3.5">
      <InputGroup className="max-w-100">
        <InputGroupAddon>
          <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
        </InputGroupAddon>
        <InputGroupInput type="search" placeholder="Filtrer les commits — message, auteur, hash" />
      </InputGroup>

      {/* ponytail: filtres inertes — le shell fixe la forme, pas le comportement */}
      {["Auteur", "Période"].map((label) => (
        <Button key={label} variant="outline" size="sm" className="shrink-0">
          {label}
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} data-icon="inline-end" className="size-2.5 text-muted-foreground" />
        </Button>
      ))}

      <span className="flex-1" />

      <Toggle
        variant="outline"
        size="sm"
        pressed={mode === "mainline"}
        onPressedChange={(pressed) => onModeChange(pressed ? "mainline" : "all")}
        className="shrink-0"
      >
        Mainline
      </Toggle>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onLoadAll}>
        Tout charger
      </Button>
    </div>
  )
}
