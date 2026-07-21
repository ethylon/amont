import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"

import { SETTINGS, type PullMode, type Settings } from "@/lib/git"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { CheckRow } from "@/components/ui/check-row"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

/* The Fetch and Pull options cards: each network button of the toolbar carries a split chevron
   (ButtonGroup, cf. toolbar.tsx) opening the settings that shape its command, right under the
   button that fires it.

   - Fetch holds the rows the settings modal used to have (auto-fetch + its interval, prune).
   - Pull picks the integration mode as radios: `--ff`, `--ff-only`, or `--rebase`.

   Both write through useSettings (lib/use-settings.ts): the cache updates at once — the button's
   command label tracks the card live — and git/ops.ts reads the persisted value at call time, so
   the choice applies from the very next run. The chevron stays clickable while the op runs or is
   queued: editing here only affects later runs, never the one in flight. */

type Props = {
  settings: Settings
  onPatch: (p: Partial<Settings>) => void
}

/** The split chevron and its card shell: a narrow ghost strip closing the ButtonGroup, opening
    the options as a popover under the button. `align="end"` pins the card's right edge to the
    chevron — the group's own right edge — so it hangs under the whole split button.

    Même robe que les menus du preset inverted-translucent (rebuild 8fad3df, cf. le Popup de
    primitives/dropdown-menu.tsx) : `dark` inverse les tokens de la carte, `bg-popover/70` +
    flou en `before:` (pas sur le popup lui-même : le ring et l'ombre resteraient nets mais le
    contenu baverait) rendent le fond translucide, et `animate-none!` coupe le zoom d'ouverture
    — le backdrop-filter ré-échantillonne à chaque frame du scale et scintille. tailwind-merge
    évince le `bg-popover` opaque du primitive. */
function OptionsPopover({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button variant="ghost" size="sm" aria-label={label} className="h-auto min-h-6 px-1" />}>
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="dark animate-none! relative gap-3.5 bg-popover/70 p-3 before:pointer-events-none before:absolute before:inset-0 before:-z-1 before:rounded-[inherit] before:backdrop-blur-2xl before:backdrop-saturate-150"
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function FetchOptions({ settings, onPatch }: Props) {
  return (
    <OptionsPopover label={messages.settings.fetchOptions}>
      <CheckRow
        checked={settings.autoFetch}
        onChange={(v) => onPatch({ autoFetch: v })}
        label={messages.settings.autoFetch}
        hint={messages.settings.autoFetchHint}
      />

      {/* Interval — nested under auto-fetch, aligned with its label (ps = checkbox + gap);
          only meaningful while auto-fetch is on, so it dims and locks with it */}
      <div className={cn("-mt-2 flex items-center gap-1.5 ps-6.5", !settings.autoFetch && "opacity-50")}>
        <ToggleGroup
          spacing={0}
          variant="outline"
          size="sm"
          aria-label={messages.settings.interval}
          disabled={!settings.autoFetch}
          value={[String(settings.autoFetchIntervalMin)]}
          onValueChange={(v) => {
            const n = Number(v[0])
            if (Number.isFinite(n)) onPatch({ autoFetchIntervalMin: n })
          }}
        >
          {SETTINGS.autoFetchIntervalMin.options.map((n) => (
            <ToggleGroupItem key={n} value={String(n)} className="tabular-nums">
              {n}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="text-[0.625rem] text-muted-foreground">{messages.settings.minutesUnit}</span>
      </div>

      <CheckRow
        checked={settings.prune}
        onChange={(v) => onPatch({ prune: v })}
        label={messages.settings.prune}
        hint={messages.settings.pruneHint}
      />
    </OptionsPopover>
  )
}

/* Thunks, not values: reading messages.* at module scope would run `t` during import,
   before setupI18n() has activated a locale (cf. toolbar.tsx). */
const PULL_MODES: { mode: PullMode; label: () => string; hint: () => string }[] = [
  { mode: "ff", label: () => messages.settings.pullFf, hint: () => messages.settings.pullFfHint },
  { mode: "ff-only", label: () => messages.settings.pullFfOnly, hint: () => messages.settings.pullFfOnlyHint },
  { mode: "rebase", label: () => messages.settings.pullRebase, hint: () => messages.settings.pullRebaseHint },
]

export function PullOptions({ settings, onPatch }: Props) {
  return (
    <OptionsPopover label={messages.settings.pullOptions}>
      <RadioGroup
        value={settings.pullMode}
        onValueChange={(mode: PullMode) => onPatch({ pullMode: mode })}
        className="gap-3.5"
      >
        {PULL_MODES.map(({ mode, label, hint }) => (
          /* same implicit-label layout as CheckRow: the radio is the row's only labelable
             element, so clicking anywhere on the row selects it */
          <label key={mode} className="flex cursor-pointer items-start gap-2.5 text-xs">
            <RadioGroupItem value={mode} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block font-medium">{label()}</span>
              <span className="block text-[0.625rem] text-muted-foreground">{hint()}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </OptionsPopover>
  )
}
