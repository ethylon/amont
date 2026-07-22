import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

/** A labelled checkbox row — checkbox, bold label, optional muted hint. Extracted from the
    settings modal (AUDIT.md §7: one definition) now that the toolbar's Fetch options card
    renders the same rows without pulling in the modal's lazy chunk. The wrapping `<label>`
    implicitly targets the checkbox (its only labelable descendant), so the whole row toggles. */
export function CheckRow({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  hint?: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cn("flex items-start gap-2.5 text-xs", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className={cn("min-w-0", disabled && "opacity-50")}>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-[0.625rem] text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}
