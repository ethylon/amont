import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/* Surcharge du primitive : l'axe `variant` de shadcn ne porte que 6 combinaisons figées.
   Ici la teinte est un axe à part (`color`) injecté par --badge-color, ce qui laisse
   variant décrire la seule intensité. Même pattern que Client.Vite. */
/* pas de `border-transparent` dans la base : cva concatène avec clsx, pas tailwind-merge,
   et il gagnerait sur la couleur de bordure posée par le variant. */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border px-2 py-0.5 text-[0.625rem] font-medium whitespace-nowrap transition-all focus-visible:border-(--badge-color) focus-visible:ring-[3px] focus-visible:ring-(--badge-color)/20 has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&>svg]:pointer-events-none [&>svg]:size-2.5!",
  {
    variants: {
      color: {
        /* --primary vire au sombre en thème sombre (il sert de fond, pas de texte) :
           on le mixe vers --foreground pour qu'il reste lisible en tant que texte. */
        primary:
          "[--badge-color:var(--primary)] [--badge-fg:color-mix(in_oklab,var(--primary)_70%,var(--foreground))]",
        neutral: "[--badge-color:var(--muted-foreground)] [--badge-fg:var(--muted-foreground)]",
        success: "[--badge-color:var(--success)] [--badge-fg:var(--success)]",
        warning: "[--badge-color:var(--warning)] [--badge-fg:var(--warning)]",
        danger: "[--badge-color:var(--destructive)] [--badge-fg:var(--destructive)]",
        /* Le seul axe où la teinte n'a pas de nom : le porteur — ou n'importe lequel de ses
           ancêtres, --badge-color hérite — la pose. Les lanes du graphe sont assez lisibles
           dans les deux thèmes pour servir aussi de couleur de texte. */
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

export { Badge, badgeVariants }
