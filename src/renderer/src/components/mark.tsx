import { cn } from "@/lib/utils"

/** Logo : une lane principale, un commit qui bifurque. Seul SVG maison restant. */
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      <g stroke="var(--lane-0)">
        <circle cx="5" cy="6" r="3" />
        <path d="M5 9v6" />
        <circle cx="5" cy="18" r="3" />
        <path d="M12 3v18" />
      </g>
      <g stroke="var(--lane-4)">
        <circle cx="19" cy="6" r="3" />
        <path d="M16 15.7C16.9428 14.8567 17.6972 13.8242 18.2142 12.6698C18.7311 11.5153 18.9988 10.2649 19 9" />
      </g>
    </svg>
  )
}
