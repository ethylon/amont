/* État persisté (AUDIT.md §4) : userData/state.json. Fichier minuscule, écrit à chaque
   mutation — une perte au crash ne coûte qu'une liste d'onglets.

   Écriture atomique (fix hygiène) : temp + rename plutôt qu'un writeFile direct sur le fichier
   final — un crash ou un kill -9 en plein write ne peut plus laisser un state.json à moitié
   écrit (JSON tronqué) que loadState() lirait au prochain lancement. */

import { existsSync } from "node:fs"
import { readFile, rename, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { app } from "electron"

export interface PersistedState {
  root: string | null
  recents: string[]
  tabs: string[]
  active: string | null
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
    /* best-effort : un disque plein ne doit rien casser côté UI */
  }
}

export async function loadState(): Promise<void> {
  try {
    Object.assign(persisted, JSON.parse(await readFile(stateFile(), "utf8")))
  } catch {
    /* premier lancement, ou fichier absent/corrompu */
  }
  /* un state.json corrompu (JSON valide, forme inattendue) ne doit pas empêcher la fenêtre
     de s'ouvrir : on rabote vers la forme attendue au lieu de laisser le boot échouer */
  const paths = (list: unknown): string[] => (Array.isArray(list) ? list.filter((p) => typeof p === "string") : [])
  persisted.tabs = paths(persisted.tabs)
  persisted.recents = paths(persisted.recents).filter(isRepo)
  if (typeof persisted.root !== "string") persisted.root = null
  persisted.tabs.forEach((p) => openable.add(p))
  persisted.recents.forEach((p) => openable.add(p))
}

export const isRepo = (p: string): boolean => existsSync(join(p, ".git"))

/* Le renderer n'ouvre que des chemins qu'on lui a montrés : récents, résultats de scan, ou
   choix dans le dialogue système. Sans ce filtre, un renderer compromis (le diff affiche du
   contenu arbitraire) pourrait pointer git — et ses hooks — sur n'importe quel dossier. */
export const openable = new Set<string>()

export function remember(path: string): void {
  persisted.recents = [path, ...persisted.recents.filter((p) => p !== path)].slice(0, 12)
  openable.add(path)
  void saveState()
}
