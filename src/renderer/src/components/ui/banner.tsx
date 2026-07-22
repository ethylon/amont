import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/reui/alert"
import { cn } from "@/lib/utils"

/* Bandeau d'état 32px, bord à bord au-dessus du contenu (conflit, remote ahead…). Surcharge de
   l'Alert ReUI : même sémantique (role="alert", teinte par tokens), mais la carte grid devient
   un strip une ligne — coins droits, bordure basse seule, teinte plus soutenue pour rester
   lisible en chrome d'app. Les surfaces interactives (flow start, création inline) ne sont pas
   des alertes et gardent leur propre strip. */
export function Banner({ className, ...props }: React.ComponentProps<typeof Alert>) {
  return (
    <Alert
      variant="warning"
      className={cn(
        "amont-drop flex shrink-0 items-center gap-2.5 rounded-none border-x-0 border-t-0 border-warning/40 bg-warning/10 px-3.5 py-1 text-xs whitespace-nowrap",
        className
      )}
      {...props}
    />
  )
}

export function BannerTitle({ className, ...props }: React.ComponentProps<typeof AlertTitle>) {
  return <AlertTitle className={cn("min-w-0 shrink-0 font-semibold", className)} {...props} />
}

export function BannerDetail({ className, ...props }: React.ComponentProps<typeof AlertDescription>) {
  return (
    <AlertDescription className={cn("block min-w-0 truncate text-xs text-muted-foreground", className)} {...props} />
  )
}

export function BannerActions({ className, ...props }: React.ComponentProps<typeof AlertAction>) {
  return <AlertAction className={cn("ms-auto flex shrink-0 items-center gap-1.5 max-sm:mt-0", className)} {...props} />
}
