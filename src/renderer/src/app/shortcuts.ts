/* Registre de raccourcis clavier (AUDIT.md §5, item 9) : un point de passage unique remplace
   les listeners `document.addEventListener("keydown", …)` indépendants qui coexistaient (App
   F5, RepoView Ctrl+B/Escape, CommitSearch Ctrl+F/F3, GitConsole Escape) et ne se coordonnaient
   entre eux que par l'ordre de montage — deux listeners indépendants sur `document` pour la
   même touche s'exécutaient tous les deux, sans qu'aucun ne le décide explicitement.

   Chaque consommateur reste scope-aware : son handler décide lui-même s'il s'applique (onglet
   actif, popover ouvert…) et renvoie `true` s'il a traité l'événement — ce qui arrête la
   descente vers les priorités plus basses. Escape a deux prétendants concurrents : la console
   git (overlay flottant, priorité haute) et la fermeture du diff (priorité par défaut). Le
   champ de recherche et le filtre du sidebar gardent leur propre gestion d'Escape en local, au
   plus près de l'input (stopPropagation avant même d'atteindre ce registre) : c'est déjà la
   scope la plus étroite qui puisse exister, un détour par ce module n'y ajouterait rien. */

import { useEffect } from "react"

export const PRIORITY = {
  /** popovers/dialogues flottants au-dessus du contenu (console git) */
  OVERLAY: 100,
  /** raccourcis d'onglet ordinaires (Ctrl+B, Ctrl+F, F3, Escape ferme le diff) */
  DEFAULT: 50,
  /** raccourcis globaux à l'application (F5) */
  GLOBAL: 10,
} as const

type ShortcutHandler = (ev: KeyboardEvent) => boolean | void

interface Entry {
  priority: number
  handler: ShortcutHandler
}

const entries: Entry[] = []

function dispatch(ev: KeyboardEvent): void {
  for (const { handler } of [...entries].sort((a, b) => b.priority - a.priority)) {
    if (handler(ev) === true) return
  }
}

let installed = false

/** À appeler une fois au démarrage (main.tsx) : un seul listener `document`, quel que soit le
    nombre d'onglets/composants qui enregistrent des raccourcis ensuite. */
export function installShortcuts(): void {
  if (installed) return
  installed = true
  document.addEventListener("keydown", dispatch)
}

/** Enregistre `handler` tant que `active` est vrai (onglet au premier plan, popover ouvert…).
    Priorité haute = testé en premier ; `handler` renvoie `true` pour arrêter la descente. */
export function useShortcut(active: boolean, priority: number, handler: ShortcutHandler): void {
  useEffect(() => {
    if (!active) return
    const entry: Entry = { priority, handler }
    entries.push(entry)
    return () => {
      const i = entries.indexOf(entry)
      if (i >= 0) entries.splice(i, 1)
    }
  }, [active, priority, handler])
}
