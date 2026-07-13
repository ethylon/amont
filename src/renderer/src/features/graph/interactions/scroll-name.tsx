/* React twin of scrollText() (see scroll-text.ts): the name scrolls on hover instead of
   truncating. Shared by the detail panel and the sidebar rows (branches, worktrees, tags). */

import { cn } from "@/lib/utils"
import { SCROLL_TEXT_CLASS, scrollTextHover, scrollTextStop } from "@/features/graph/interactions/scroll-text"

export function ScrollName({ text, className }: { text: string; className?: string }) {
  return (
    <span
      className={cn(SCROLL_TEXT_CLASS, className)}
      onMouseEnter={(e) => scrollTextHover(e.currentTarget)}
      onMouseLeave={() => scrollTextStop()}
    >
      <span>{text}</span>
    </span>
  )
}
