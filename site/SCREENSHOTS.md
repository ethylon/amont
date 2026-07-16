# Captures pour la landing — plan de prise de vue

Toutes les captures font **2880×1800** (viewport 1440×900 @2x). Chaque vue en **light et dark**
(`?theme=`), nommage `docs/<scene>-<light|dark>.png` — le site et le README importent ces chemins.

## Préparation

Les captures sortent du harnais navigateur `/demo.html` : le scénario « Aurelia Storefront »
de `src/renderer/demo-scenario.mjs`, le même que la démo embarquée du site (`embed.html`),
plus l'état conflit derrière `?merge=1`.

```sh
pnpm mock
# http://localhost:5199/demo.html?theme=light&locale=en           → graph, diff, worktree
# http://localhost:5199/demo.html?theme=light&locale=en&merge=1   → conflict
```

Viewport 1440×900, `deviceScaleFactor: 2` (Playwright/Chromium headless ou device mode des
devtools), screenshot du viewport → 2880×1800 exactement.

Alternative vraie app : `node site/scripts/demo-repo.mjs` (défaut `~/amont-demo`, `--conflict`
pour la variante merge) génère le même scénario en repo git réel à ouvrir dans Amont
(`pnpm dev`) — utile pour vérifier la parité harnais/app, mais fenêtre 1440×900 @2x plus
délicate à obtenir en capture native.

## Prises

| Fichier                     | Feature (une seule)                                                                               | État       | Cadrage                                                                                                                                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `graph-{light,dark}.png`    | Le graphe : lanes, merge curves, tags v0.9.0/v1.0.0, stash, ahead 2/behind 1, badges `feat`/`fix` | défaut     | Fenêtre entière. Sélectionner le commit « merge: checkout flow » pour peupler le panneau de détail. Sidebar branches visible ; les deux merges et le stash à l'écran.                                                                                                                                                  |
| `diff-{light,dark}.png`     | Diff côte à côte, coloration syntaxique                                                           | défaut     | Sélectionner « refactor: extract ProductCard from ProductList », ouvrir `src/components/ProductList.tsx`, vue side-by-side. Fenêtre entière, panneau de détail à droite.                                                                                                                                               |
| `worktree-{light,dark}.png` | Staging fichiers/hunks + message de commit                                                        | défaut     | Ligne « Uncommitted changes » en haut du graphe. Arbres staged (`src/cart.ts`) / unstaged (`README.md`, `src/styles.css`, `CartBadge.tsx` untracked) visibles, diff de `README.md` (2 hunks) au centre, boutons par hunk. Taper « feat: cart badge with live item count » pour montrer la commande git sous le bouton. |
| `conflict-{light,dark}.png` | Résolution de conflit A/B + sortie éditable                                                       | `?merge=1` | Ouvrir `src/cart.ts` (conflit `formatPrice`). Scroller jusqu'au bloc « Conflict 1 » : pickers Take A/Take B visibles, sortie fusionnée éditable en bas.                                                                                                                                                                |

## Notes

- La mission listait une capture « palette clavier » : l'app n'a pas de command palette
  (vérifié — aucun overlay, seulement des raccourcis `src/renderer/src/app/shortcuts.ts`).
- La section « It's still git » du site rend la console de commandes en HTML
  (`site/src/components/CommandLog.astro`), pas en screenshot : aucune capture console à faire.
- L'ancien harnais `src/renderer/screenshots.html` (dataset figé du repo Amont) a été
  supprimé : `/demo.html` couvre les quatre scènes.
