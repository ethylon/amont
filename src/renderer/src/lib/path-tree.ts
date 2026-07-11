/* Generic path tree (AUDIT.md §7, phase 5): file-list.tsx and refs-sidebar.tsx each
   built their own `buildTree`, identical except for the shape of the item (a
   `FileChange` with its `.path`, a `GitRef` with its `.name`) — a single algorithm, `pathOf`
   picks the field. A node only carries its direct children and the items that stop at that
   level; the display label (last segment) is derived from the item's full path on the
   caller's side, no need to duplicate it in the tree. */

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
