import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./app.css"
import App from "@/App"
import { applyTheme } from "@/lib/theme"
import { TooltipProvider } from "@/components/ui/primitives/tooltip"

/* avant le premier rendu : pas de flash clair au démarrage */
applyTheme()

/* Le délai du groupe est celui d'un contenu survolé au passage (cf. `Tip`) : un provider à 0
   court-circuite le `delay` des triggers. Les boutons d'icône, dont l'infobulle est le seul
   libellé, le remettent à zéro chez eux. */
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider delay={500}>
      <App />
    </TooltipProvider>
  </StrictMode>
)
