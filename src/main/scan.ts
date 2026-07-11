/* Découverte des dépôts sous la racine (AUDIT.md §4).
   Profondeur fixe et pas de dépôt dans un dépôt : couvre les arborescences imbriquées à deux ou
   trois niveaux (espace de travail / groupe / dépôt) les plus courantes. Réglable via
   AMONT_SCAN_DEPTH si des dépôts se cachent plus bas dans une arborescence donnée. */

import { readdir } from "node:fs/promises"
import { join } from "node:path"

const DEPTH = Number(process.env.AMONT_SCAN_DEPTH) || 3
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
