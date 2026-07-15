import { useCallback, useEffect, useState } from "react"

import { host } from "@/lib/git"

type State = { available: boolean; enabled: boolean }

/** Shared state for the crash-reporting (telemetry) opt-out, surfaced both on the home screen
    (the pre-repo surface) and in the settings modal. `available` is false unless a DSN was baked
    into the build (cf. main/telemetry.ts) — the callers render nothing in that case. */
export function useCrashReports() {
  const [state, setState] = useState<State | null>(null)
  useEffect(() => {
    void host.telemetryState().then(setState)
  }, [])
  const setEnabled = useCallback((enabled: boolean) => {
    setState((s) => (s ? { ...s, enabled } : s))
    void host.setTelemetry(enabled)
  }, [])
  return { state, setEnabled }
}
