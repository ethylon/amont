/* Arbre de chemins générique (AUDIT.md §7, phase 5) : file-list.tsx et refs-sidebar.tsx
   construisaient chacun leur propre `buildTree`, identiques à la forme de l'item près (un
   `FileChange` avec son `.path`, une `GitRef` avec son `.name`) — un seul algorithme, `pathOf`
   choisit le champ. Un nœud ne porte que ses enfants directs et les items qui s'arrêtent à ce
   niveau ; le label d'affichage (dernier segment) se déduit du chemin complet de l'item côté
   appelant, pas la peine de le dupliquer dans l'arbre. */

export type PathTree<T> = { dirs: Map<string, PathTree<T>>; items: T[] }

export function buildPathTree<T>(list: T[], pathOf: (item: T) => string): PathTree<T> {
  const root: PathTree<T> = { dirs: new Map(), items: [] }
  for (const item of list) {
    const parts = pathOf(item).split("/")
    let n = root
    for (let i = 0; i < parts.length - 1; i++) {
      if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), items: [] })
      n = n.dirs.get(parts[i])!
    }
    n.items.push(item)
  }
  return root
}
