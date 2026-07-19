import { Checkbox } from "@/components/ui/checkbox"

/** A labelled checkbox row — checkbox, bold label, optional muted hint. Extracted from the
    settings modal (AUDIT.md §7: one definition) now that the toolbar's Fetch options card
    renders the same rows without pulling in the modal's lazy chunk. The wrapping `<label>`
    implicitly targets the checkbox (its only labelable descendant), so the whole row toggles. */
export function CheckRow({
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
