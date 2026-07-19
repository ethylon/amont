import { useCallback, useState, type CSSProperties } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  CloudDownloadIcon,
  Delete02Icon,
  PaintBoardIcon,
  PlusSignIcon,
  RefreshIcon,
  SlidersHorizontalIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"

import { host, SETTINGS, type Settings } from "@/lib/git"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import { cn } from "@/lib/utils"
import { setTheme, useThemeMode, useTheme } from "@/lib/theme"
import { setLocale, useLocale } from "@/lib/i18n"
import {
  colorHex,
  COLOR_ROLES,
  listFonts,
  neutralPrefixHexes,
  resetColor,
  resetCustomization,
  resetLangAliases,
  setColor,
  setCustomization,
  setLangAliases,
  setPrefixRules,
  useCustomization,
  type ColorRole,
  type LangAlias,
  type PrefixRule,
  type ThemeKey,
} from "@/lib/customization"
import { SHIKI_LANGS } from "@/features/diff/shiki-langs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { IconButton } from "@/components/ui/icon-button"
import { Input } from "@/components/ui/input"
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

/* App-wide settings, opened from File ▸ Settings. A left nav splits it into three sections that
   each write straight to their own store — no Save button, only Close:

   - Customization / Colors are renderer prefs (localStorage, cf. lib/customization.ts) plus the
     theme and language runtime switches (lib/theme.ts, lib/i18n.ts) and the crash-reports opt-out.
   - Fetch is the main-process settings the modal originally held (cf. shared/settings.ts): every
     value and choice still comes from the SETTINGS registry, written through host.setSettings, which
     persists it and re-arms the open repos' autofetch timers live. */

type Section = "customization" | "colors" | "diff" | "fetch"

const SECTIONS: { id: Section; icon: IconSvgElement; label: () => string }[] = [
  { id: "customization", icon: SlidersHorizontalIcon, label: () => messages.settings.sectionCustomization },
  { id: "colors", icon: PaintBoardIcon, label: () => messages.settings.sectionColors },
  { id: "diff", icon: SourceCodeIcon, label: () => messages.settings.sectionDiff },
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
            {section === "diff" && <DiffSection />}
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
        <FontSelect
          value={custom.fontMono}
          monoOnly={custom.monoOnly}
          onChange={(v) => setCustomization({ fontMono: v })}
        />
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
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="w-52 justify-between font-normal" />}>
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
          <p className="px-2 py-1.5 text-[0.625rem] text-muted-foreground">{messages.customization.fontsUnavailable}</p>
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
  const dark = useTheme() // re-render on theme flip so the preview badge tracks the active theme
  useCustomization() // and on any color change so the swatches stay in sync
  const active: ThemeKey = dark ? "dark" : "light"

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.625rem] text-muted-foreground">{messages.colors.intro}</p>
        <ResetButton
          onClick={() => {
            resetColor("light")
            resetColor("dark")
          }}
        />
      </div>

      <div className="grid gap-2">
        {/* column headers over the two swatch columns */}
        <div className="flex items-center gap-2.5 text-[0.625rem] text-muted-foreground">
          <span className="w-20 shrink-0" />
          <span className="w-9 shrink-0 text-center">{messages.menu.themeLight}</span>
          <span className="w-9 shrink-0 text-center">{messages.menu.themeDark}</span>
        </div>
        {COLOR_ROLES.map((role) => (
          <ColorRow key={role} role={role} active={active} />
        ))}
      </div>

      <hr className="border-border/60" />
      <PrefixRulesEditor />
    </div>
  )
}

/** A native color input styled as a compact swatch. */
function Swatch({ value, onChange, label }: { value: string; onChange: (hex: string) => void; label: string }) {
  return (
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-6 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
    />
  )
}

/** One work-type role: a live preview chip (in the active theme) plus a light and a dark swatch. */
function ColorRow({ role, active }: { role: ColorRole; active: ThemeKey }) {
  const label = roleLabel(role)
  return (
    <div className="flex items-center gap-2.5">
      {/* `lane` derives both hue and text from `--badge-color`; driving it with the active theme's
          hex previews how the badge reads on screen right now. */}
      <Badge
        color="lane"
        shape="squared"
        className="w-20 justify-center"
        style={{ "--badge-color": colorHex(active, role) } as CSSProperties}
      >
        {label}
      </Badge>
      <Swatch
        value={colorHex("light", role)}
        onChange={(hex) => setColor("light", role, hex)}
        label={`${label} — ${messages.menu.themeLight}`}
      />
      <Swatch
        value={colorHex("dark", role)}
        onChange={(hex) => setColor("dark", role, hex)}
        label={`${label} — ${messages.menu.themeDark}`}
      />
      <button
        type="button"
        onClick={() => {
          resetColor("light", role)
          resetColor("dark", role)
        }}
        className="ms-auto cursor-pointer text-[0.625rem] text-muted-foreground hover:text-foreground"
      >
        {messages.colors.reset}
      </button>
    </div>
  )
}

/* --- Colors ▸ Custom prefixes ---
   User-defined `PREFIX:` / `[PREFIX]` rules, each with its own light/dark badge color (starting from
   the neutral gray a `chore` uses). Written straight to the store on every edit, like the rest of
   the modal; a blank row is kept while editing and ignored by the matcher (lib/commit-parse) until a
   prefix is typed. */
function PrefixRulesEditor() {
  const { prefixRules } = useCustomization()
  const setAt = (i: number, rule: PrefixRule) => setPrefixRules(prefixRules.map((r, k) => (k === i ? rule : r)))
  const removeAt = (i: number) => setPrefixRules(prefixRules.filter((_, k) => k !== i))
  const setHex = (i: number, theme: ThemeKey, hex: string) =>
    setAt(i, { ...prefixRules[i], colors: { ...prefixRules[i].colors, [theme]: hex } })

  return (
    <div className="grid gap-2">
      <div>
        <p className="text-xs font-medium">{messages.colors.customPrefixes}</p>
        <p className="text-[0.625rem] text-muted-foreground">{messages.colors.customPrefixesHint}</p>
      </div>

      {prefixRules.map((rule, i) => {
        const name = rule.prefix || messages.colors.prefixPlaceholder
        return (
          <div key={i} className="flex items-center gap-2.5">
            <Input
              value={rule.prefix}
              onChange={(e) => setAt(i, { ...rule, prefix: e.target.value })}
              placeholder={messages.colors.prefixPlaceholder}
              className="flex-1 font-mono text-xs"
            />
            <Swatch
              value={rule.colors.light}
              onChange={(hex) => setHex(i, "light", hex)}
              label={`${name} — ${messages.menu.themeLight}`}
            />
            <Swatch
              value={rule.colors.dark}
              onChange={(hex) => setHex(i, "dark", hex)}
              label={`${name} — ${messages.menu.themeDark}`}
            />
            <IconButton label={messages.settings.remove} icon={Delete02Icon} onClick={() => removeAt(i)} />
          </div>
        )
      })}

      <Button
        variant="outline"
        size="sm"
        onClick={() => setPrefixRules([...prefixRules, { prefix: "", colors: neutralPrefixHexes() }])}
        className="justify-self-start"
      >
        <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
        {messages.colors.addPrefix}
      </Button>
    </div>
  )
}

/* --- Diff (syntax highlighting) ---
   The extension → shiki-grammar map. Ships empty — no mappings are imposed by default; the user adds
   their own. Same write-through store model; a blank extension is ignored by the highlighter until
   filled, and "Reset to defaults" clears the list back to empty. */
function DiffSection() {
  const { langAliases } = useCustomization()
  const setAt = (i: number, alias: LangAlias) => setLangAliases(langAliases.map((a, k) => (k === i ? alias : a)))
  const removeAt = (i: number) => setLangAliases(langAliases.filter((_, k) => k !== i))

  return (
    <div className="grid gap-3">
      <p className="text-[0.625rem] text-muted-foreground">{messages.settings.langAliasesIntro}</p>

      {langAliases.length > 0 && (
        <div className="grid gap-2">
          <div className="flex items-center gap-2 text-[0.625rem] text-muted-foreground">
            <span className="flex-1">{messages.settings.extensionLabel}</span>
            <span className="w-32">{messages.settings.languageLabel}</span>
            <span className="w-7 shrink-0" />
          </div>
          {langAliases.map((alias, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-1">
                <span className="font-mono text-xs text-muted-foreground">.</span>
                <Input
                  value={alias.ext}
                  onChange={(e) => setAt(i, { ...alias, ext: e.target.value })}
                  placeholder="csproj"
                  className="font-mono text-xs"
                />
              </div>
              <HugeiconsIcon
                icon={ArrowRight01Icon}
                strokeWidth={2}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <LangSelect value={alias.lang} onChange={(lang) => setAt(i, { ...alias, lang })} />
              <IconButton label={messages.settings.remove} icon={Delete02Icon} onClick={() => removeAt(i)} />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setLangAliases([...langAliases, { ext: "", lang: "xml" }])}>
          <HugeiconsIcon icon={PlusSignIcon} strokeWidth={2} />
          {messages.settings.addExtension}
        </Button>
        <ResetButton onClick={resetLangAliases} />
      </div>
    </div>
  )
}

/** Language picker over the grammars shiki ships in this app (shiki-langs.ts). */
function LangSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="w-32 justify-between font-normal" />}>
        <span className="truncate font-mono text-xs">{value}</span>
        <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 w-40">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => {
            if (typeof v === "string" && v) onChange(v)
          }}
        >
          {SHIKI_LANGS.map((lang) => (
            <DropdownMenuRadioItem key={lang} value={lang} className="font-mono text-xs">
              {lang}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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
