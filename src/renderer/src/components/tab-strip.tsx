import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Home01Icon, Moon02Icon, PlusSignIcon, Search01Icon, Sun03Icon } from "@hugeicons/core-free-icons"

import { isDark, setDark } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Mark } from "@/components/mark"
import { Tip } from "@/components/ui/tip"
import { Button } from "@/components/ui/primitives/button"
import { Kbd, KbdGroup } from "@/components/ui/primitives/kbd"
import { IconButton } from "@/components/ui/icon-button"

/** L'écran d'accueil vit dans un onglet épinglé, jamais fermé. Les autres portent l'id du repo. */
export const HOME = 0

export type Tab = { key: number; name: string; path: string }

type Props = {
  tabs: Tab[]
  active: number
  hasRepo: boolean
  onSelect(key: number): void
  onClose(key: number): void
  onOpenPalette(): void
}

const tabClass =
  "group/tab flex h-7.5 shrink-0 cursor-pointer items-center rounded-md border text-xs focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none aria-selected:border-border aria-selected:bg-muted aria-selected:font-medium aria-selected:text-foreground"

export function TabStrip({ tabs, active, hasRepo, onSelect, onClose, onOpenPalette }: Props) {
  const [dark, setDarkState] = useState(isDark)

  const toggleTheme = () => {
    setDark(!dark)
    setDarkState(!dark)
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b pr-3 pl-3.5">
      <Mark className="me-1.5 size-5" />

      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <Tip text="Accueil" side="bottom">
          <div
            role="tab"
            tabIndex={0}
            aria-selected={active === HOME}
            aria-label="Accueil"
            onClick={() => onSelect(HOME)}
            onKeyDown={(e) => e.key === "Enter" && onSelect(HOME)}
            className={cn(tabClass, "w-9 justify-center border-transparent text-muted-foreground hover:bg-muted/60")}
          >
            <HugeiconsIcon icon={Home01Icon} strokeWidth={2} className="size-3.5" />
          </div>
        </Tip>

        {tabs.map((t) => (
          <Tip key={t.key} text={t.path} side="bottom">
            <div
              role="tab"
              tabIndex={0}
              aria-selected={t.key === active}
              onClick={() => onSelect(t.key)}
              onKeyDown={(e) => e.key === "Enter" && onSelect(t.key)}
              /* clic molette : ferme, comme un navigateur */
              onAuxClick={(e) => e.button === 1 && onClose(t.key)}
              className={cn(tabClass, "max-w-44 gap-1.5 border-transparent px-2.5 text-muted-foreground hover:bg-muted/60")}
            >
              <span className="truncate">{t.name}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Fermer ${t.name}`}
                className="-me-1.5 shrink-0 opacity-0 group-aria-selected/tab:opacity-100 group-hover/tab:opacity-100 focus-visible:opacity-100"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.key)
                }}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
              </Button>
            </div>
          </Tip>
        ))}

        <IconButton label="Nouvel onglet" icon={PlusSignIcon} onClick={() => onSelect(HOME)} className="shrink-0" />
      </div>

      <Button
        variant="ghost"
        size="sm"
        disabled={!hasRepo}
        className="shrink-0 text-muted-foreground"
        onClick={onOpenPalette}
      >
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} data-icon="inline-start" />
        Rechercher
        <KbdGroup className="ms-auto ps-2.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </Button>

      <IconButton
        label={dark ? "Thème clair" : "Thème sombre"}
        icon={dark ? Sun03Icon : Moon02Icon}
        onClick={toggleTheme}
        className="shrink-0"
      />
    </header>
  )
}
