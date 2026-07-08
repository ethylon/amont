import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./app.css"
import App from "@/App"
import { TooltipProvider } from "@/components/ui/primitives/tooltip"

/* Le preset shadcn pilote le thème par la classe .dark. L'app n'a pas de sélecteur :
   elle suit l'OS, comme avant la migration. */
const dark = matchMedia("(prefers-color-scheme: dark)")
const applyTheme = () => document.documentElement.classList.toggle("dark", dark.matches)
dark.addEventListener("change", applyTheme)
applyTheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>
)
