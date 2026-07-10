import { cn } from "@/lib/utils"

/** Marque Amont : deux versants qui convergent, la source au sommet.
    Couleurs de charte, volontairement hors tokens de thème — sauf la barre :
    encre sur fond clair / écume sur fond sombre, soit le foreground courant. */
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
