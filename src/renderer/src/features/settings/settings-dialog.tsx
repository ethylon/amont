import { useCallback, useState, type CSSProperties } from "react"
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Delete02Icon,
  PaintBoardIcon,
  PlusSignIcon,
  RefreshIcon,
  SlidersHorizontalIcon,
  SourceCodeIcon,
} from "@hugeicons/core-free-icons"

import { typeIcon, typesOfColor } from "@/lib/commit-parse"
import { messages } from "@/lib/messages"
import { cn } from "@/lib/utils"
import { setTheme, useThemeMode, useTheme } from "@/lib/theme"
import { setLocale, useLocale } from "@/lib/i18n"
import {
  colorHex,
  COLOR_ROLES,
  listFonts,
  neutralPrefixHexes,
  removeColorRole,
  resetColor,
  resetColors,
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
import { CheckRow } from "@/components/ui/check-row"
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

/* App-wide settings, opened from File ▸ Settings. A left nav splits it into sections that
   each write straight to their own store — no Save button, only Close: Customization / Colors /
   Diff are renderer prefs (localStorage, cf. lib/customization.ts) plus the theme and language
   runtime switches (lib/theme.ts, lib/i18n.ts) and the crash-reports opt-out.

   The main-process settings (shared/settings.ts) the modal originally held moved to the
   toolbar's Fetch/Pull options cards (features/repo/op-options.tsx), under the buttons whose
   commands they shape. */

type Section = "customization" | "colors" | "diff"

const SECTIONS: { id: Section; icon: IconSvgElement; label: () => string }[] = [
  { id: "customization", icon: SlidersHorizontalIcon, label: () => messages.settings.sectionCustomization },
  { id: "colors", icon: PaintBoardIcon, label: () => messages.settings.sectionColors },
  { id: "diff", icon: SourceCodeIcon, label: () => messages.settings.sectionDiff },
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

        {/* max-h + scroll on the content pane: the Colors section now lists one preset per badge
            type and can outgrow small windows; the nav column stays put while the pane scrolls */}
        <div className="flex max-h-[65vh] min-h-80 gap-4">
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

          {/* the pane owns the scroll (not the max-h wrapper): without overflow here the Colors
              list would paint past the wrapper, over the dialog footer */}
          <div className="min-w-0 flex-1 overflow-y-auto pe-1">
            {section === "customization" && <CustomizationSection />}
            {section === "colors" && <ColorsSection />}
            {section === "diff" && <DiffSection />}
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

/* --- shared row primitives (CheckRow moved to components/ui/check-row.tsx: the toolbar's
   Fetch options card renders the same rows without pulling in this lazy chunk) --- */

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

function ColorsSection() {
  const dark = useTheme() // re-render on theme flip so the preview badge tracks the active theme
  const { removedRoles } = useCustomization() // and on any color change so the swatches stay in sync
  const active: ThemeKey = dark ? "dark" : "light"

  return (
    <div className="grid gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.625rem] text-muted-foreground">{messages.colors.intro}</p>
        {/* restores every hue AND the deleted presets */}
        <ResetButton onClick={resetColors} />
      </div>

      <div className="grid gap-2">
        {/* column headers over the two swatch columns */}
        <div className="flex items-center gap-2.5 text-[0.625rem] text-muted-foreground">
          <span className="w-24 shrink-0" />
          <span className="w-9 shrink-0 text-center">{messages.menu.themeLight}</span>
          <span className="w-9 shrink-0 text-center">{messages.menu.themeDark}</span>
        </div>
        {COLOR_ROLES.filter((role) => !removedRoles.includes(role)).map((role) => (
          <ColorRow key={role} role={role} active={active} />
        ))}
      </div>

      <p className="text-[0.625rem] text-muted-foreground">{messages.colors.neutralNote}</p>

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

/** One color preset: a live preview of its type badge — exactly the label and icon the graph
    shows (cf. typesOfColor, derived from the same tables) — a light and a dark swatch, a reset
    link and a delete cross that only shows on row hover ("Reset to defaults" brings a deleted
    preset back). */
function ColorRow({ role, active }: { role: ColorRole; active: ThemeKey }) {
  const [type] = typesOfColor(role)
  const icon = typeIcon(type)
  return (
    <div className="group/preset flex items-center gap-2.5">
      {/* `lane` derives both hue and text from `--badge-color`; driving it with the active theme's
          hex previews how the badge reads on screen right now. */}
      <span className="flex w-24 shrink-0 items-center">
        <Badge color="lane" shape="squared" style={{ "--badge-color": colorHex(active, role) } as CSSProperties}>
          {icon && <HugeiconsIcon icon={icon} strokeWidth={2} data-icon="inline-start" />}
          {type}
        </Badge>
      </span>
      <Swatch
        value={colorHex("light", role)}
        onChange={(hex) => setColor("light", role, hex)}
        label={`${type} — ${messages.menu.themeLight}`}
      />
      <Swatch
        value={colorHex("dark", role)}
        onChange={(hex) => setColor("dark", role, hex)}
        label={`${type} — ${messages.menu.themeDark}`}
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
      {/* discreet delete: a small red cross, revealed by hovering the row (opacity keeps the
          column from reflowing, and the button stays focusable for keyboard users) */}
      <button
        type="button"
        aria-label={messages.settings.remove}
        onClick={() => removeColorRole(role)}
        className="cursor-pointer text-destructive/70 opacity-0 transition-opacity group-hover/preset:opacity-100 hover:text-destructive focus-visible:opacity-100"
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} className="size-3" />
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
   The extension → shiki-grammar map. The editable list ships empty — the user adds their own — over a
   tiny built-in fallback (`.svg` → xml) that a user row overrides. Same write-through store model; a
   blank extension is ignored by the highlighter until filled, and "Reset to defaults" clears the list
   back to empty. */
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

function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="text-muted-foreground">
      <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
      {messages.settings.resetDefaults}
    </Button>
  )
}
