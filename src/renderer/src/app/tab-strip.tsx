import { Tabs } from "@base-ui/react/tabs"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon, Home01Icon, Moon02Icon, PlusSignIcon, Sun03Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import { setDark, useTheme } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { Mark } from "@/components/ui/mark"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"

/** The home screen lives in a pinned tab, never closed. The others carry the repo id. */
export const HOME = 0

/** Link the tab to its panel (aria-controls / aria-labelledby), see `App`. */
export const tabId = (key: number) => `amont-tab-${key}`
export const panelId = (key: number) => `amont-panel-${key}`

export type Tab = { key: number; name: string; path: string }

type Props = {
  tabs: Tab[]
  active: number
  onSelect(key: number): void
  onClose(key: number): void
  /** The "+" at the end of the tab row: opens the repository-creation dialog (see App). */
  onNew(): void
  /** The application menu bar (File/View/Repository/Git Flow/Help), rendered in the top row
      beside the mark; the repository tabs sit on their own row below. */
  menu?: React.ReactNode
}

const tabClass =
  "group/tab flex h-7.5 shrink-0 cursor-pointer items-center rounded-md border text-xs focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:outline-none aria-selected:border-border aria-selected:bg-muted aria-selected:font-medium aria-selected:text-foreground"

/* Chrome tabs, pas des tabs de contenu : Base UI fournit le pattern ARIA (roving tabindex,
   flèches/Home/End, activation au focus), le styling reste celui de la barre d'app — d'où
   l'import direct du primitive nu plutôt que du tabs stylé de ui/primitives. Les panels
   keep-alive restent dans App (ids câblés à la main via tabId/panelId), hors de tout
   Tabs.Panel : Base UI n'a pas à monter/démonter le canvas du graphe. */
export function TabStrip({ tabs, active, onSelect, onClose, onNew, menu }: Props) {
  /* subscribed to the theme rather than a local copy: an OS flip (without an explicit
     choice saved) must flip the icon too */
  const dark = useTheme()

  const toggleTheme = () => setDark(!dark)

  return (
    <header className="flex shrink-0 flex-col border-b">
      {/* top row: brand, application menu, quick theme toggle */}
      <div className="flex h-9 items-center gap-1.5 pr-3 pl-3.5">
        <Mark className="me-1.5 size-5" />

        {menu}

        <div className="flex-1" />

        <IconButton
          label={dark ? messages.theme.light : messages.theme.dark}
          icon={Moon02Icon}
          swapIcon={Sun03Icon}
          swapped={dark}
          aria-pressed={dark}
          onClick={toggleTheme}
          className="shrink-0"
        />
      </div>

      {/* second row: the repository tabs, on their own line (see two-menu bar). The row scrolls;
          the tablist holds the actual tabs and the "+" rides along at its end as a plain action
          (reachable by Tab, like any button — it stays out of the arrow-key order). */}
      <Tabs.Root
        value={active}
        onValueChange={(key) => onSelect(key as number)}
        className="flex items-center gap-1 overflow-x-auto border-t px-2.5 py-1"
      >
        {/* activateOnFocus : les flèches activent l'onglet en passant, comme l'ancien roving manuel */}
        <Tabs.List activateOnFocus className="flex shrink-0 items-center gap-1">
          <Tabs.Tab
            value={HOME}
            render={<div />}
            id={tabId(HOME)}
            aria-controls={panelId(HOME)}
            aria-label={messages.app.home}
            className={cn(tabClass, "w-9 justify-center border-transparent text-muted-foreground hover:bg-muted/60")}
          >
            <HugeiconsIcon icon={Home01Icon} strokeWidth={2} className="size-3.5" />
          </Tabs.Tab>

          {tabs.map((t) => (
            <Tabs.Tab
              key={t.key}
              value={t.key}
              /* div, pas button : le bouton de fermeture vit dedans, un button imbriqué serait invalide */
              render={<div />}
              id={tabId(t.key)}
              aria-controls={panelId(t.key)}
              /* middle click: closes, like a browser */
              onAuxClick={(e) => e.button === 1 && onClose(t.key)}
              className={cn(
                tabClass,
                "max-w-44 gap-1.5 border-transparent px-2.5 text-muted-foreground hover:bg-muted/60"
              )}
            >
              <span className="truncate">{t.name}</span>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={messages.app.closeTab(t.name)}
                /* after: the click target goes from 20 to 28px without growing the icon (see checkbox) */
                className="relative -me-1.5 shrink-0 opacity-0 group-aria-selected/tab:opacity-100 group-hover/tab:opacity-100 focus-visible:opacity-100 after:absolute after:-inset-1"
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(t.key)
                }}
              >
                <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-2.5" />
              </Button>
            </Tabs.Tab>
          ))}
        </Tabs.List>

        {/* the "+" is no longer a tab: it opens the repository-creation dialog (see App) */}
        <button
          type="button"
          aria-label={messages.app.newTab}
          onClick={onNew}
          className={cn(
            tabClass,
            "w-9 shrink-0 justify-center border-transparent text-muted-foreground hover:bg-muted/60"
          )}
        >
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} className="size-3.5" />
        </button>
      </Tabs.Root>
    </header>
  )
}
