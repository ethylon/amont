/* Live ticker feed of a running git operation, shared by the surfaces that roll it under a
   spinner (the commit button's hook output, the flow banners' traced commands): the last
   `git:trace` line the picker kept while `active`, `null` outside the run. */

import { useEffect, useState } from "react"

import { onTrace, type TraceLine } from "@/lib/git"

/** Picker for the command lines (`git …`) as main spawns them, in execution order — what the
    flow banners roll through while a gitflow operation runs. */
export const traceCommand = (line: TraceLine): string | null => (line.kind === "cmd" ? line.text : null)

/** The step label a running operation last traced: subscribed to `git:trace` while `active`,
    keeps only the lines `pick` retains (`null` holds the previous one on screen), and resets
    once inactive. `pick` sits in the effect's deps — pass a module-level function. */
export function useTraceStep(repoId: number, active: boolean, pick: (line: TraceLine) => string | null): string | null {
  const [step, setStep] = useState<string | null>(null)
  useEffect(() => {
    if (!active) {
      setStep(null)
      return
    }
    return onTrace((line) => {
      if (line.id !== repoId) return
      const next = pick(line)
      if (next !== null) setStep((prev) => (prev === next ? prev : next))
    })
  }, [active, repoId, pick])
  return step
}
