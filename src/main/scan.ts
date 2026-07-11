/* Découverte des dépôts sous la racine (AUDIT.md §4).
   ponytail: profondeur 3 et pas de dépôt dans un dépôt. Couvre `~/Projets/<client>/<repo>` ;
   à revoir si des dépôts se cachent plus bas. */

import { readdir } from "node:fs/promises"
import { join } from "node:path"

const DEPTH = 3
const SKIP = new Set(["node_modules", "bin", "obj", "dist", "out", "target", "vendor"])

export async function scan(dir: string, depth: number, found: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // dossier illisible : il n'a rien à nous dire
  }
  if (entries.some((e) => e.name === ".git")) return void found.push(dir)
  if (depth === DEPTH) return
  await Promise.all(entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
    .map((e) => scan(join(dir, e.name), depth + 1, found)))
}
