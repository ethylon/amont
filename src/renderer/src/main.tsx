import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"

import "./app.css"
import App from "@/app/App"
import { boot } from "@/lib/git"
import { queryClient } from "@/lib/query-client"
import { installShortcuts } from "@/app/shortcuts"
import { applyTheme } from "@/lib/theme"
import { setupI18n } from "@/lib/i18n"
import { initTelemetry } from "@/lib/telemetry"

/* first thing, so a failure anywhere in boot is still reported (a no-op unless a DSN was
   baked into the build — cf. lib/telemetry.ts + main/telemetry.ts) */
initTelemetry()

/* before the first render: pick the system locale so every string reads the right language,
   and paint the theme so there's no light flash on startup */
setupI18n()
applyTheme()
/* a single document listener for the whole shortcut registry (cf. app/shortcuts.ts) */
installShortcuts()

/* boot() opens the repos of the restored tabs: called once here, explicitly,
   rather than as a side effect of importing lib/git.ts (the old `bootState`). The promise
   flows down as a prop to App's restoration effect. */
const bootState = boot()

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App boot={bootState} />
    </QueryClientProvider>
  </StrictMode>
)
