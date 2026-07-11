/* Repo discovery under the root (AUDIT.md §4).
   Fixed depth and no repo-within-a-repo: covers the most common two- or three-level
   nested layouts (workspace / group / repo). Adjustable via
   AMONT_SCAN_DEPTH if repos are hiding deeper in a given tree. */

import { readdir } from "node:fs/promises"
import { join } from "node:path"

const DEPTH = Number(process.env.AMONT_SCAN_DEPTH) || 3
const SKIP = new Set(["node_modules", "bin", "obj", "dist", "out", "target", "vendor"])

export async function scan(dir: string, depth: number, found: string[]): Promise<void> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return // unreadable directory: it has nothing to tell us
  }
  if (entries.some((e) => e.name === ".git")) return void found.push(dir)
  if (depth === DEPTH) return
  await Promise.all(entries
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !SKIP.has(e.name))
    .map((e) => scan(join(dir, e.name), depth + 1, found)))
}
