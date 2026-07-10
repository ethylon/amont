import { useRef, useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Home01Icon, Moon02Icon, PlusSignIcon, Search01Icon, Sun03Icon } from "@hugeicons/core-free-icons"

import { isDark, setDark } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Mark } from "@/components/mark"
import { Button } from "@/components/ui/primitives/button"
import { Kbd, KbdGroup } from "@/components/ui/primitives/kbd"
import { IconButton } from "@/components/ui/icon-button"

/** L'écran d'accueil vit dans un onglet épinglé, jamais fermé. Les autres portent l'id du repo. */
export const HOME = 0

/** Lient l'onglet à son panneau (aria-controls / aria-labelledby), cf. `App`. */
export const tabId = (key: number) => `gg-tab-${key}`
export const panelId = (key: number) => `gg-panel-${key}`

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

  /* Pattern ARIA « tabs » : un seul onglet dans l'ordre de tabulation (roving tabindex), les
     flèches déplacent le focus d'onglet en onglet et l'activent au passage. */
  const order = [HOME, ...tabs.map((t) => t.key)]
  const tabEls = useRef(new Map<number, HTMLDivElement>())
  const tabRef = (key: number) => (el: HTMLDivElement | null) => {
    el ? tabEls.current.set(key, el) : tabEls.current.delete(key)
  }

  const onTabKey = (e: React.KeyboardEvent, key: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      return onSelect(key)
    }
    const i = order.indexOf(active)
    const j =
      e.key === "ArrowRight" ? (i + 1) % order.length
      : e.key === "ArrowLeft" ? (i - 1 + order.length) % order.length
      : e.key === "Home" ? 0
      : e.key === "End" ? order.length - 1
      : -1
    if (j < 0) return
    e.preventDefault()
    onSelect(order[j])
    tabEls.current.get(order[j])?.focus()
  }

  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b pr-3 pl-3.5">
      <Mark className="me-1.5 size-5" />

      <div role="tablist" className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
        <div
          ref={tabRef(HOME)}
          role="tab"
          id={tabId(HOME)}
          aria-controls={panelId(HOME)}
          tabIndex={active === HOME ? 0 : -1}
          aria-selected={active === HOME}
          aria-label="Accueil"
          onClick={() => onSelect(HOME)}
          onKeyDown={(e) => onTabKey(e, HOME)}
          className={cn(tabClass, "w-9 justify-center border-transparent text-muted-foreground hover:bg-muted/60")}
        >
          <HugeiconsIcon icon={Home01Icon} strokeWidth={2} className="size-3.5" />
        </div>

        {tabs.map((t) => (
          <div
            key={t.key}
            ref={tabRef(t.key)}
            role="tab"
            id={tabId(t.key)}
            aria-controls={panelId(t.key)}
            tabIndex={t.key === active ? 0 : -1}
            aria-selected={t.key === active}
            onClick={() => onSelect(t.key)}
            onKeyDown={(e) => onTabKey(e, t.key)}
            /* clic molette : ferme, comme un navigateur */
            onAuxClick={(e) => e.button === 1 && onClose(t.key)}
            className={cn(tabClass, "max-w-44 gap-1.5 border-transparent px-2.5 text-muted-foreground hover:bg-muted/60")}
          >
            <span className="truncate">{t.name}</span>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Fermer ${t.name}`}
              /* after : la cible de clic passe de 20 à 28px sans grossir l'icône (cf. checkbox) */
              className="relative -me-1.5 shrink-0 opacity-0 group-aria-selected/tab:opacity-100 group-hover/tab:opacity-100 focus-visible:opacity-100 after:absolute after:-inset-1"
              onClick={(e) => {
                e.stopPropagation()
                onClose(t.key)
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
            </Button>
          </div>
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
        icon={Moon02Icon}
        swapIcon={Sun03Icon}
        swapped={dark}
        onClick={toggleTheme}
        className="shrink-0"
      />
    </header>
  )
}
