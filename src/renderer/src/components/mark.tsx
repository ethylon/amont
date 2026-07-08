import { cn } from "@/lib/utils"

/** Logo : deux lanes qui divergent puis se rejoignent. Seul SVG maison restant. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" strokeLinecap="round" aria-hidden className={cn("shrink-0", className)}>
      <path d="M5 17.2V3.4" stroke="var(--lane-0)" strokeWidth="1.7" />
      <path d="M15 17.2v-3.7C15 10 5 12.5 5 9" stroke="var(--lane-4)" strokeWidth="1.7" />
      <circle cx="5" cy="3.4" r="2.4" fill="var(--lane-0)" />
      <circle cx="15" cy="17.2" r="2.1" fill="var(--lane-4)" />
      <circle cx="5" cy="9" r="2.3" fill="var(--background)" stroke="var(--lane-0)" strokeWidth="1.6" />
    </svg>
  )
}
