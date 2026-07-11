import { cn } from "@/lib/utils"

/** Amont mark: two slopes converging, the source at the top.
    Brand colors, deliberately outside theme tokens — except the bar:
    ink on light background / foam on dark background, i.e. the current foreground.
    Keep in sync (same path data) with the 3 other copies of this mark: the app icon generator
    (scripts/make-icon.mjs), and the two static no-JS splash/crash pages
    (src/renderer/index.html, src/renderer/crash.html). */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" aria-hidden className={cn("shrink-0", className)}>
      <defs>
        <linearGradient id="amont-courant" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#6AA6E8" />
          <stop offset="1" stopColor="#8F8FE8" />
        </linearGradient>
      </defs>
      <path d="M62,192 C62,132 92,112 114,70" fill="none" stroke="url(#amont-courant)" strokeWidth="22" strokeLinecap="round" />
      <path d="M178,192 C178,132 148,112 126,70" fill="none" stroke="url(#amont-courant)" strokeWidth="22" strokeLinecap="round" />
      <path d="M94,148 H146" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" />
      <circle cx="120" cy="40" r="13" fill="#F272A8" />
    </svg>
  )
}
