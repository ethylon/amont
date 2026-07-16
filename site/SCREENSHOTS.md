# Captures pour la landing — plan de prise de vue

Toutes les captures existantes font **2880×1800** (fenêtre 1440×900 @2x). Reprendre ce format.
Chaque vue en **light et dark** (toggle thème dans l'app), nommage `docs/<scene>-<light|dark>.png`
— le site et le README importent ces chemins.

## Préparation

```sh
node site/scripts/demo-repo.mjs           # crée ~/amont-demo (+ ~/amont-demo-origin.git)
node site/scripts/demo-repo.mjs ~/amont-demo-conflict --conflict
pnpm dev                                  # vraie app Electron
```

Ouvrir `~/amont-demo` dans Amont. Fenêtre 1440×900 (ou plein écran 2880×1800 utile).
Alternative sans Electron : `pnpm mock` + `http://localhost:5199/screenshots.html`
(dataset figé du repo Amont — utilisable pour `graph` seulement; staging/stash/ahead-behind
du scénario démo n'y existent pas).

## Prises

| Fichier | Feature (une seule) | Repo | Cadrage |
|---|---|---|---|
| `graph-{light,dark}.png` | Le graphe : lanes, merge curves, tags v0.9.0/v1.0.0, stash, ahead 2/behind 1, badges `feat`/`fix` | `~/amont-demo` | Fenêtre entière. Sélectionner le commit de merge « merge: checkout flow » pour peupler le panneau de détail. Sidebar branches visible. Scroll pour que les deux merges + le stash soient à l'écran. |
| `diff-{light,dark}.png` | Diff côte à côte, coloration syntaxique | `~/amont-demo` | Sélectionner « feat: product search with price filter », ouvrir `src/search.ts`, vue side-by-side. Fenêtre entière, panneau de détail à droite. |
| `worktree-{light,dark}.png` | Staging fichiers/hunks/lignes + message de commit | `~/amont-demo` | Ligne « Uncommitted changes » en haut du graphe. Arbres staged (`src/cart.ts`) / unstaged (`README.md`, `src/styles.css`, `CartBadge.tsx` untracked) visibles, diff live au centre, boutons par hunk. Taper un début de message de commit pour montrer la commande git sous le bouton. |
| `conflict-{light,dark}.png` | Résolution de conflit A/B + sortie éditable | `~/amont-demo-conflict` | Ouvrir `src/cart.ts` (conflit `formatPrice`). Les deux panes alignées + pickers par côté/bloc/ligne + éditeur du résultat en bas. |

## Notes

- La mission listait une capture « palette clavier » : l'app n'a pas de command palette
  (vérifié — aucun overlay, seulement des raccourcis `src/renderer/src/app/shortcuts.ts`).
- La section « It's still git » du site rend la console de commandes en HTML
  (`site/src/components/CommandLog.astro`), pas en screenshot : aucune capture console à faire.
- Les 4 scènes ci-dessus remplacent les captures actuelles de `docs/` (prises sur le repo
  d'Amont) par le scénario du repo démo. Tant qu'elles ne sont pas refaites, le site
  fonctionne avec les captures existantes.
