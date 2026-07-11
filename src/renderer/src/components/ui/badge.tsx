import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* Overrides the primitive: shadcn's `variant` axis only carries 6 fixed combinations.
   Here the hue is a separate axis (`color`) injected via --badge-color, which leaves
   variant to describe intensity alone. Same pattern as Client.Vite. */
/* no `border-transparent` in the base: cva concatenates with clsx, not tailwind-merge,
   and it would win over the border color set by the variant. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border px-2 py-0.5 text-[0.625rem] font-medium whitespace-nowrap transition-colors focus-visible:border-(--badge-color) focus-visible:ring-[3px] focus-visible:ring-(--badge-color)/20 has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      color: {
        /* --primary turns dark in dark theme (it's meant as a background, not text):
           we mix it toward --foreground so it stays legible as text. */
        primary:
          "[--badge-color:var(--primary)] [--badge-fg:color-mix(in_oklab,var(--primary)_70%,var(--foreground))]",
        neutral: "[--badge-color:var(--muted-foreground)] [--badge-fg:var(--muted-foreground)]",
        success: "[--badge-color:var(--success)] [--badge-fg:var(--success)]",
        warning: "[--badge-color:var(--warning)] [--badge-fg:var(--warning)]",
        release: "[--badge-color:var(--release)] [--badge-fg:var(--release)]",
        danger: "[--badge-color:var(--destructive)] [--badge-fg:var(--destructive)]",
        info: "[--badge-color:var(--info)] [--badge-fg:var(--info)]",
        refactor: "[--badge-color:var(--refactor)] [--badge-fg:var(--refactor)]",
        /* The only axis where the hue has no name: the carrier — or any of its
           ancestors, --badge-color inherits — sets it. Graph lanes are legible enough
           in both themes to also serve as the text color. */
        lane: "[--badge-fg:var(--badge-color)]",
      },
      variant: {
        default: "border-(--badge-color)/20 bg-(--badge-color)/10 text-(--badge-fg) dark:bg-(--badge-color)/20",
        outline: "border-(--badge-color)/40 text-(--badge-fg)",
      },
      shape: {
        pill: "rounded-full",
        squared: "rounded-sm",
      },
    },
    defaultVariants: {
      color: "neutral",
      variant: "default",
      shape: "pill",
    },
  }
)

function Badge({
  className,
  color = "neutral",
  variant = "default",
  shape = "pill",
  render,
  ...props
}: Omit<useRender.ComponentProps<"span">, "color"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ color, variant, shape }), className) }, props),
    render,
    state: { slot: "badge", color, variant },
  })
}

/** Full-height rule between two pieces of content in the same badge: `-my-0.5` cancels the vertical padding. */
const badgeSeparator = "-my-0.5 w-px self-stretch bg-(--badge-color)/20"

/** Badge hue vocabulary, derived from `cva` (single source of truth): the domain describes
    its colors with the type owned by the component that displays them, not the other way
    around (AUDIT.md §7, phase 5 — `BadgeColor` used to live in lib/commit-message.ts, an
    inverted dependency direction). */
export type BadgeColor = NonNullable<VariantProps<typeof badgeVariants>["color"]>

export { Badge, badgeSeparator, badgeVariants }
