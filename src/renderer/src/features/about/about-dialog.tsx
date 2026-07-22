/* About modal (Help ▸ About Amont): the brand's OG card redrawn live — same dark gradient,
   same three rivers, same plume (brand/web/amont-og.svg) — with the running version, the
   tagline and the outbound links. Lazy-loaded from App like the settings dialog. */

import type { CSSProperties } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Github01Icon, Globe02Icon } from "@hugeicons/core-free-icons"

import { messages } from "@/lib/messages"
import { Mark } from "@/components/ui/mark"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog"

const SITE = "https://amont.dev"
const REPO = "https://github.com/ethylon/amont"

/* The hero keeps the OG's fixed dark palette in both themes, so the mark's gradient is pinned
   to the OG stops rather than the theme hooks (per-instance gradient id, cf. ui/mark.tsx). */
const OG_MARK = { "--mark-top": "#8fe3e8", "--mark-bottom": "#0e2748" } as CSSProperties

/** The OG's three rivers, seen through their own window onto the 1280×640 canvas
    (viewBox = the masked right strip) — paths verbatim from brand/web/amont-og.svg. */
function Rivers() {
  return (
    <svg viewBox="960 0 320 640" aria-hidden className="absolute inset-y-0 right-0 h-full">
      <defs>
        <linearGradient id="about-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF" stopOpacity="0" />
          <stop offset="0.18" stopColor="#FFF" stopOpacity="1" />
          <stop offset="0.82" stopColor="#FFF" stopOpacity="1" />
          <stop offset="1" stopColor="#FFF" stopOpacity="0" />
        </linearGradient>
        <mask id="about-rivers">
          <rect x="960" y="0" width="320" height="640" fill="url(#about-fade)" />
        </mask>
      </defs>
      <g mask="url(#about-rivers)" opacity="0.85" fill="none" strokeLinecap="round">
        <path d="M1040,-40 C1040,200 1090,270 1090,700" stroke="#8FE3E8" strokeWidth="16" />
        <path d="M1140,-40 C1140,190 1190,260 1190,700" stroke="#5B8FD6" strokeWidth="16" />
        <path d="M1240,-40 C1240,180 1290,250 1290,700" stroke="#2E5B9E" strokeWidth="16" />
      </g>
    </svg>
  )
}

export function AboutDialog({ onClose }: { onClose: () => void }) {
  /* system browser, never in-app (same route as the menus — cf. main/window.ts) */
  const openExternal = (url: string) => void window.open(url, "_blank", "noopener,noreferrer")

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* the hero bleeds to the edges; the default close cross would float over it in the
          light theme's dark-on-light colors, so the footer button is the only explicit close */}
      <DialogContent showCloseButton={false} className="gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">{messages.menu.about}</DialogTitle>

        <div className="relative flex items-center gap-4 bg-linear-to-b from-[#15151B] to-[#0E0E12] px-6 py-7">
          <Rivers />
          <span className="relative shrink-0" style={OG_MARK}>
            <Mark className="size-16" />
          </span>
          <span className="relative min-w-0">
            <span className="block font-heading text-3xl/none font-semibold tracking-tight text-[#ECECF2]">amont</span>
            <span className="mt-1.5 block font-mono text-[0.625rem] text-[#8B8B99]">
              {messages.about.version(__APP_VERSION__)}
            </span>
          </span>
        </div>

        <div className="grid gap-3 p-4">
          <DialogDescription>{messages.about.tagline}</DialogDescription>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => openExternal(SITE)}>
              <HugeiconsIcon icon={Globe02Icon} strokeWidth={2} />
              {messages.about.website}
            </Button>
            <Button variant="outline" size="sm" onClick={() => openExternal(REPO)}>
              <HugeiconsIcon icon={Github01Icon} strokeWidth={2} />
              {messages.menu.sourceCode}
            </Button>
          </div>
          <p className="text-[0.625rem] text-muted-foreground">
            {messages.about.license} © {new Date().getFullYear()} Mathieu GUEY.
          </p>
          <DialogFooter showCloseButton className="mt-1" />
        </div>
      </DialogContent>
    </Dialog>
  )
}
