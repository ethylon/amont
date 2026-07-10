import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./app.css"
import App from "@/App"
import { applyTheme } from "@/lib/theme"

/* avant le premier rendu : pas de flash clair au démarrage */
applyTheme()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
