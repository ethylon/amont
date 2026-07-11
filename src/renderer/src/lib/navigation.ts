/* Navigation d'onglets (AUDIT.md §5, item 6) : une union discriminée remplace le sentinel
   `HOME = 0` que TabStrip partageait avec l'espace des ids de dépôt (`Repo.id` démarre à 1
   côté main, ce qui ne collisionne jamais avec 0 — mais rien ne le dit dans les types, c'est
   une convention implicite entre les deux process). Les transitions restent pures et testées
   ici ; App.tsx les consomme depuis son propre state React (`document.startViewTransition` +
   `flushSync` sont un souci de rendu, pas d'état — un store séparé n'y apporterait rien). */

import type { Repo } from "@/lib/git"

export type NavKey = { kind: "home" } | { kind: "repo"; id: number }

export const HOME: NavKey = { kind: "home" }

export const repoKey = (id: number): NavKey => ({ kind: "repo", id })

export const navKeyEquals = (a: NavKey, b: NavKey): boolean =>
  a.kind === "home" ? b.kind === "home" : b.kind === "repo" && b.id === a.id

/** Le sens du glissement suit la position dans la barre d'onglets, l'accueil en position 0.
    Une clé qui n'y figure pas encore vient d'être ouverte : elle arrive de face ("open")
    plutôt que par le côté. */
export function transitionKind(tabs: Repo[], active: NavKey, target: NavKey): "open" | "next" | "prev" {
  const order: NavKey[] = [HOME, ...tabs.map((r) => repoKey(r.id))]
  const pos = (k: NavKey) => order.findIndex((x) => navKeyEquals(x, k))
  const known = pos(target) >= 0
  if (!known) return "open"
  return pos(target) > pos(active) ? "next" : "prev"
}

/** Onglet actif après la fermeture de `closedId` : si l'onglet fermé n'était pas actif, rien
    ne bouge ; sinon on retombe sur son voisin (même index, borné), ou l'accueil si c'était le
    dernier onglet. */
export function afterClose(tabs: Repo[], active: NavKey, closedId: number): NavKey {
  const i = tabs.findIndex((r) => r.id === closedId)
  if (i < 0) return active
  if (active.kind !== "repo" || active.id !== closedId) return active
  const next = tabs.filter((r) => r.id !== closedId)
  const fallback = next[Math.min(i, next.length - 1)]
  return fallback ? repoKey(fallback.id) : HOME
}
