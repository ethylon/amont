import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"

import "./app.css"
import App from "@/App"
import { boot } from "@/lib/git"
import { queryClient } from "@/lib/query-client"
import { applyTheme } from "@/lib/theme"

/* avant le premier rendu : pas de flash clair au démarrage */
applyTheme()

/* boot() ouvre les repos des onglets restaurés : appelé une seule fois ici, explicitement,
   plutôt qu'en side-effect à l'import de lib/git.ts (l'ancien `bootState`). La promesse
   descend en prop jusqu'à l'effet de restauration de App. */
const bootState = boot()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App boot={bootState} />
    </QueryClientProvider>
  </StrictMode>
)
