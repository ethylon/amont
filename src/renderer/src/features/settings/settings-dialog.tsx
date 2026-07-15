import { useCallback, useState, type CSSProperties } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import { ArrowDown01Icon, CloudDownloadIcon, PaintBoardIcon, RefreshIcon, SlidersHorizontalIcon } from "@hugeicons/core-free-icons"

import { host, SETTINGS, type Settings } from "@/lib/git"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { setTheme, useThemeMode, isDark } from "@/lib/theme"
import { setLocale, useLocale } from "@/lib/i18n"
import {
  colorHex,
  COLOR_ROLES,
  listFonts,
  resetColor,
  resetCustomization,
  setColor,
  setCustomization,
  useCustomization,
  type ColorRole,
  type ThemeKey,
} from "@/lib/customization"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCrashReports } from "./use-crash-reports"

/* App-wide settings, opened from the toolbar's fetch button-group (the cog). A left nav splits it
   into three sections that each write straight to their own store — no Save button, only Close:

   - Customization / Colors are renderer prefs (localStorage, cf. lib/customization.ts) plus the
     theme and language runtime switches (lib/theme.ts, lib/i18n.ts) and the crash-reports opt-out.
   - Fetch is the main-process settings the modal originally held (cf. shared/settings.ts): every
     value and choice still comes from the SETTINGS registry, written through host.setSettings, which
     persists it and re-arms the open repos' autofetch timers live. */

type Section = "customization" | "colors" | "fetch"

const SECTIONS: { id: Section; icon: IconSvgElement; label: () => string }[] = [
  { id: "customization", icon: SlidersHorizontalIcon, label: () => messages.settings.sectionCustomization },
  { id: "colors", icon: PaintBoardIcon, label: () => messages.settings.sectionColors },
  { id: "fetch", icon: CloudDownloadIcon, label: () => messages.settings.sectionFetch },
]

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<Section>("customization")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{messages.settings.title}</DialogTitle>
          <DialogDescription>{messages.settings.intro}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-80 gap-4">
          <nav className="flex w-36 shrink-0 flex-col gap-0.5 border-e border-border/60 pe-2">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSection(s.id)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                  section === s.id
                    ? "bg-primary/20 font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <HugeiconsIcon icon={s.icon} strokeWidth={2} className="size-3.5 shrink-0" />
                {s.label()}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1">
            {section === "customization" && <CustomizationSection />}
            {section === "colors" && <ColorsSection />}
            {section === "fetch" && <FetchSection />}
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

/* --- shared row primitives --- */

function CheckRow({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-xs">
      <Checkbox checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-[0.625rem] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

/** A labelled single-select segmented control (controlled group: an empty selection is ignored). */
function SegRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium">{label}</span>
      <ToggleGroup
        spacing={0}
        variant="outline"
        size="sm"
        value={[value]}
        onValueChange={(v) => v[0] && onChange(v[0])}
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value}>
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/* --- Customization --- */

function CustomizationSection() {
  const theme = useThemeMode()
  const locale = useLocale()
  const custom = useCustomization()
  const crash = useCrashReports()

  return (
    <div className="grid gap-4">
      <SegRow
        label={messages.menu.theme}
        value={theme}
        onChange={(v) => setTheme(v as "light" | "dark" | "system")}
        options={[
          { value: "light", label: messages.menu.themeLight },
          { value: "dark", label: messages.menu.themeDark },
          { value: "system", label: messages.menu.themeSystem },
        ]}
      />
      <SegRow
        label={messages.menu.language}
        value={locale}
        onChange={(v) => setLocale(v as "en" | "fr")}
        options={[
          { value: "en", label: messages.menu.english },
          { value: "fr", label: messages.menu.french },
        ]}
      />

      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{messages.customization.fontUi}</span>
        <FontSelect value={custom.fontUi} monoOnly={false} onChange={(v) => setCustomization({ fontUi: v })} />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium">{messages.customization.fontMono}</span>
        <FontSelect value={custom.fontMono} monoOnly={custom.monoOnly} onChange={(v) => setCustomization({ fontMono: v })} />
      </div>
      <CheckRow
        checked={custom.monoOnly}
        onChange={(v) => setCustomization({ monoOnly: v })}
        label={messages.customization.monoOnly}
      />

      <CheckRow
        checked={custom.showPrefixColumn}
        onChange={(v) => setCustomization({ showPrefixColumn: v })}
        label={messages.customization.showPrefixColumn}
        hint={messages.customization.showPrefixColumnHint}
      />
      <CheckRow
        checked={custom.showGitCommands}
        onChange={(v) => setCustomization({ showGitCommands: v })}
        label={messages.customization.showGitCommands}
        hint={messages.customization.showGitCommandsHint}
      />

      {crash.state?.available && (
        <CheckRow
          checked={crash.state.enabled}
          onChange={crash.setEnabled}
          label={messages.settings.crashReports}
          hint={messages.settings.crashReportsHint}
        />
      )}

      <div className="flex justify-end">
        <ResetButton onClick={resetCustomization} />
      </div>
    </div>
  )
}

/** Font picker over the installed families (Local Font Access API, cf. lib/customization.ts).
    Enumeration is deferred to the moment the menu opens: `queryLocalFonts()` needs transient user
    activation, and opening the menu is a fresh click that provides it (also avoids listing hundreds
    of families until the picker is actually used). A muted note stands in when the list comes back
    empty (denied, or the mock browser harness). */
function FontSelect({
  value,
  monoOnly,
  onChange,
}: {
  value: string | null
  monoOnly: boolean
  onChange: (v: string | null) => void
}) {
  const [fonts, setFonts] = useState<string[] | null>(null)

  const loadFonts = useCallback(() => {
    setFonts(null)
    void listFonts(monoOnly).then(setFonts)
  }, [monoOnly])

  return (
    <DropdownMenu onOpenChange={(open) => open && loadFonts()}>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="w-52 justify-between font-normal" />}
      >
        <span className="truncate" style={{ fontFamily: value ? `"${value}"` : undefined }}>
          {value ?? messages.customization.fontDefault}
        </span>
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 w-52">
        <DropdownMenuRadioGroup
          value={value ?? ""}
          onValueChange={(v) => onChange(typeof v === "string" && v ? v : null)}
        >
          <DropdownMenuRadioItem value="">{messages.customization.fontDefault}</DropdownMenuRadioItem>
          {fonts?.map((f) => (
            <DropdownMenuRadioItem key={f} value={f} style={{ fontFamily: `"${f}"` }}>
              {f}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {fonts !== null && fonts.length === 0 && (
          <p className="px-2 py-1.5 text-[0.625rem] text-muted-foreground">
            {messages.customization.fontsUnavailable}
          </p>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/* --- Colors --- */

/** ColorRole → its user-facing work-type label and the Badge hue used for the preview chip.
    The role names double as BadgeColor values (cf. components/ui/badge), so the chip is literal. */
const roleLabel = (role: ColorRole): string =>
  ({
    success: messages.colors.feature,
    warning: messages.colors.bugfix,
    danger: messages.colors.hotfix,
    release: messages.colors.release,
    info: messages.colors.info,
    refactor: messages.colors.refactor,
    polish: messages.colors.polish,
  })[role]

function ColorsSection() {
  const [tk, setTk] = useState<ThemeKey>(isDark() ? "dark" : "light")
  /* re-render on any color change so the swatches and hex labels stay in sync */
  useCustomization()

  return (
    <div className="grid gap-3">
      <p className="text-[0.625rem] text-muted-foreground">{messages.colors.intro}</p>

      <div className="flex items-center justify-between">
        <ToggleGroup
          spacing={0}
          variant="outline"
          size="sm"
          value={[tk]}
          onValueChange={(v) => v[0] && setTk(v[0] as ThemeKey)}
        >
          <ToggleGroupItem value="light">{messages.menu.themeLight}</ToggleGroupItem>
          <ToggleGroupItem value="dark">{messages.menu.themeDark}</ToggleGroupItem>
        </ToggleGroup>
        <ResetButton onClick={() => resetColor(tk)} />
      </div>

      <div className="grid gap-2">
        {COLOR_ROLES.map((role) => (
          <ColorRow key={role} theme={tk} role={role} />
        ))}
      </div>
    </div>
  )
}

function ColorRow({ theme, role }: { theme: ThemeKey; role: ColorRole }) {
  const hex = colorHex(theme, role)
  const label = roleLabel(role)
  return (
    <div className="flex items-center gap-2.5">
      {/* `lane` derives both hue and text from `--badge-color`; driving it with the edited hex makes
          the chip preview the theme being edited, even when it isn't the one on screen. */}
      <Badge
        color="lane"
        shape="squared"
        className="w-20 justify-center"
        style={{ "--badge-color": hex } as CSSProperties}
      >
        {label}
      </Badge>
      <input
        type="color"
        value={hex}
        onChange={(e) => setColor(theme, role, e.target.value)}
        aria-label={label}
        className="h-6 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
      />
      <span className="font-mono text-[0.625rem] tabular-nums text-muted-foreground">{hex}</span>
      <button
        type="button"
        onClick={() => resetColor(theme, role)}
        className="ms-auto cursor-pointer text-[0.625rem] text-muted-foreground hover:text-foreground"
      >
        {messages.colors.reset}
      </button>
    </div>
  )
}

/* --- Fetch (the original main-process settings) --- */

function FetchSection() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => host.getSettings(),
    staleTime: Infinity,
  })

  /* optimistic: write the query cache at once (the modal and toolbar reflect it), then persist.
     A failed write is harmless — the cache reloads from the persisted truth next open. */
  const patch = useCallback(
    (p: Partial<Settings>) => {
      queryClient.setQueryData(queryKeys.settings(), (s: Settings | undefined) => (s ? { ...s, ...p } : s))
      void host.setSettings(p)
    },
    [queryClient]
  )

  if (!settings) return null

  return (
    <div className="grid gap-4">
      {/* Auto-fetch on/off */}
      <CheckRow
        checked={settings.autoFetch}
        onChange={(v) => patch({ autoFetch: v })}
        label={messages.settings.autoFetch}
        hint={messages.settings.autoFetchHint}
      />

      {/* Interval — only meaningful while auto-fetch is on, so it dims and locks with it */}
      <div className={cn("flex items-center justify-between gap-3", !settings.autoFetch && "opacity-50")}>
        <span className="text-xs font-medium">{messages.settings.interval}</span>
        <div className="flex items-center gap-1.5">
          <ToggleGroup
            spacing={0}
            variant="outline"
            size="sm"
            disabled={!settings.autoFetch}
            value={[String(settings.autoFetchIntervalMin)]}
            onValueChange={(v) => {
              const n = Number(v[0])
              if (Number.isFinite(n)) patch({ autoFetchIntervalMin: n })
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
      </div>

      {/* Prune on fetch */}
      <CheckRow
        checked={settings.prune}
        onChange={(v) => patch({ prune: v })}
        label={messages.settings.prune}
        hint={messages.settings.pruneHint}
      />
    </div>
  )
}

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="text-muted-foreground">
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
      {messages.settings.resetDefaults}
    </Button>
  )
}
