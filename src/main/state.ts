/* Persisted state (AUDIT.md §4): userData/state.json. Tiny file, written on every
   mutation — losing it in a crash only costs a list of tabs.

   Atomic write (hygiene fix): temp + rename rather than a direct writeFile on the final
   file — a crash or a kill -9 mid-write can no longer leave a half-written state.json
   (truncated JSON) that loadState() would read on the next launch. */

import { existsSync } from "node:fs"
import { readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"

export interface PersistedState {
  root: string | null
  recents: string[]
  tabs: string[]
  active: string | null
  /** Crash-reporting opt-out (cf. telemetry.ts). Undefined = never chosen, treated as on. */
  telemetry?: boolean
}

export const persisted: PersistedState = { root: null, recents: [], tabs: [], active: null }

const stateFile = () => join(app.getPath("userData"), "state.json")

export async function saveState(): Promise<void> {
  const file = stateFile()
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(persisted))
    await rename(tmp, file)
  } catch {
    /* best-effort: a full disk must not break anything on the UI side */
  }
}

export async function loadState(): Promise<void> {
  try {
    Object.assign(persisted, JSON.parse(await readFile(stateFile(), "utf8")))
  } catch {
    /* first launch, or missing/corrupt file */
  }
  /* a corrupt state.json (valid JSON, unexpected shape) must not prevent the window
     from opening: we coerce it into the expected shape instead of letting boot fail */
  const paths = (list: unknown): string[] => (Array.isArray(list) ? list.filter((p) => typeof p === "string") : [])
  persisted.tabs = paths(persisted.tabs)
  persisted.recents = paths(persisted.recents).filter(isRepo)
  if (typeof persisted.root !== "string") persisted.root = null
  if (typeof persisted.telemetry !== "boolean") delete persisted.telemetry
  persisted.tabs.forEach((p) => openable.add(p))
  persisted.recents.forEach((p) => openable.add(p))
}

export const isRepo = (p: string): boolean => existsSync(join(p, ".git"))

/* The renderer only opens paths we've shown it: recents, scan results, or
   picks from the system dialog. Without this filter, a compromised renderer (the diff displays
   arbitrary content) could point git — and its hooks — at any folder. */
export const openable = new Set<string>()

export function remember(path: string): void {
  persisted.recents = [path, ...persisted.recents.filter((p) => p !== path)].slice(0, 12)
  openable.add(path)
  void saveState()
}
