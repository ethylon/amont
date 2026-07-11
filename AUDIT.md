# Audit pré-1.0 — refactor propre et pro avant open-source

> Audit du code à `v0.12.0` (commit `b3699bd`), en vue d'un refactor sans contrainte de
> rétrocompatibilité. Objectif : un code que des inconnus liront avec plaisir, et une
> architecture où copier une feature verticale pour en créer une autre est trivial.
> Baseline saine : `pnpm typecheck` et `pnpm test` passent, la CI vérifie typecheck + tests + build.

## Résumé exécutif

Le projet est **bien meilleur que ne le laisse craindre son historique** « mockup → brouillon
Vite → features empilées ». La posture sécurité Electron est au-dessus de la moyenne
(contextIsolation, sandbox, CSP stricte commentée, aucun `shell: true`, chemins derrière `--`,
validations par handler). Les commentaires sont denses et racontent les vraies raisons des
choix. La virtualisation du graphe est réelle et bien conçue. Le theming par variables CSS
jusque dans le SVG est exemplaire.

Les problèmes ne sont pas « du code sale » mais **trois dettes structurelles** héritées de la
croissance par empilement, plus **une poignée de vrais bugs** et **tout l'outillage OSS manquant** :

1. **Le contrat IPC est stringly-typed et triplé à la main** (main JS, preload JS, miroir TS
   dans le renderer) — zéro garantie de compilation, chaque feature paie cette taxe.
2. **Deux monolithes** : `src/main/index.js` (967 lignes, ~8 responsabilités) et
   `graph-canvas.ts` (1 066 lignes, ~10 responsabilités dans une closure), plus un
   composant-dieu `repo-view.tsx` (626 lignes, 22 `useState`, 14 `useEffect`).
3. **Les features sont étalées, pas verticales** : la feature « stash » existante touche
   6 fichiers sur 3 process. Il n'existe aucun dossier copiable.
4. **Bugs réels confirmés** : identité de commit sur 32 bits (collisions statistiquement
   garanties sur gros dépôts), injection d'argument dans `git flow finish`, parsing de
   fichiers cassé par les noms spéciaux, aucune annulation des process git en vol.
5. **Rien de ce qu'un projet OSS exige** : pas de LICENSE, README, ESLint, Prettier, vrai
   test runner ; tout est en français (UI, commentaires, métadonnées, locales codées en dur) ;
   trois noms concurrents (git-graph / Amont / gitgraph / gg-).

Le plan de refactor recommandé (fin de document) est ordonné pour que chaque phase rende la
suivante moins chère. La pierre angulaire est le **contrat IPC partagé typé** : c'est lui qui
débloque la migration TS du main, la verticalité des features et la testabilité.

---

## 1. Ce qui est bon — à préserver explicitement

Un refactor détruit facilement ce qui marchait. Liste de ce qu'il faut garder tel quel :

- **Posture sécurité Electron** : `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, preload CJS (le commentaire expliquant pourquoi ESM forcerait
  `sandbox: false` est correct), allowlist `openable` deny-by-default, `will-navigate`
  bloqué, `setWindowOpenHandler` filtré. Aucun chemin trouvé vers l'exécution de commande
  arbitraire depuis un renderer compromis.
- **Exécution git** : `spawn` avec argv (jamais de shell), chemins derrière `--`,
  `GIT_TERMINAL_PROMPT=0`, recherche en mode littéral `-F`, message de commit via `['-m', msg]`.
- **Virtualisation du graphe** : deux étages (chunks DOM/SVG montés par viewport ±1, cache de
  pages LRU avec épinglage sélection/viewport), layout en streaming append-only, invalidation
  par compteur de génération. Architecture correcte, à décomposer sans la casser.
- **Theming** : couleurs livrées au SVG exclusivement en `var(--lane-N)` etc. — bascule
  dark/light à coût JS nul. La palette de lanes avec chroma ajusté par teinte (app.css) est
  soignée.
- **Le shell React du graphe** (`commit-graph.tsx`) : refs + `cb.current` + destroy
  StrictMode-safe. C'est le modèle à suivre pour toute intégration impérative.
- **Flux de sélection** : React possède la vérité, le moteur applique `data-selected` —
  one-way data flow avec échappatoires impératives bien raisonnées.
- **CSP** : relâchement `unsafe-inline` correctement cantonné au serveur de dev.
- **Les scripts d'auto-contrôle** : `check-refs` / `check-graph` / `check-sha256` contiennent
  de vraies assertions de valeur (vecteurs différentiels sha256 contre node:crypto, cas de
  capsules gitflow) — à migrer vers vitest, pas à jeter.
- **mock.html** : ce n'est pas un vestige du mockup, c'est le harnais de dev navigateur
  (stub complet du bridge + 25k commits synthétiques). À documenter, pas à supprimer.
- **Les commentaires narratifs** : ils encodent les vraies raisons (contraintes, pièges,
  budgets). À **traduire**, pas à élaguer.

---

## 2. Bugs confirmés (vérifiés dans le code, pas seulement rapportés)

### B1 — CRITIQUE · Identité de commit sur 32 bits → collisions silencieuses
`src/main/index.js:228,254` tronque chaque hash à 8 caractères (`slice(0, 8)` aveugle, pas
l'abréviation anti-collision de git), et `src/renderer/src/lib/graph-layout.ts:22` en fait
l'identité du graphe :

```ts
export const hkey = (h: string) => parseInt(h.slice(0, 8), 16)
```

`rowOf`, la résolution d'arêtes `pending`, les résultats de recherche (eux aussi tronqués,
`index.js:281`) sont clavés sur 32 bits. Paradoxe des anniversaires : à 50 000 commits,
~25 % de probabilité d'au moins une collision ; à 100 000, ~69 %. Une collision = une arête
raccordée au mauvais commit ou une recherche qui surligne la mauvaise ligne, **sans erreur**.

**Fix** : transporter les SHA complets depuis le main ; conserver la compacité mémoire en
internant les hashs en ids entiers séquentiels (`Map<string, number>` à l'ingestion). La
troncature redevient une affaire d'affichage.

### B2 — MAJEUR · Injection d'argument dans `git flow finish`
`src/main/index.js:619-625` : la regex `BRANCH` (ligne 537) interdit le `-` **en tête du nom
complet**, mais `finish` découpe le préfixe :

```js
const version = name.slice(prefixes[type].length);
await git(r.path, ['flow', type, 'finish', ...(tagged ? ['-m', version] : []), version], OP_TIMEOUT);
```

Une branche `feature/-D` (légale pour git) donne `version = '-D'`, interprété comme option
par le script git-flow (`-D` = suppression forcée…). Atteignable par un simple nom de branche
exotique. **Fix** : rejeter `version.startsWith('-')` (idem dans `flowInfo`).

### B3 — MAJEUR · `repo:files` casse sur les noms de fichiers spéciaux
`src/main/index.js:807-820` : `diff --name-status` **sans `-z`**, parsé par `split('\n')` +
`split('\t')`. Git C-quote les chemins non-ASCII (`"caf\303\251.txt"`) et un nom contenant
tab/newline pulvérise le parse. `repo:worktree` utilise correctement `-z` — ce handler est
l'exception. **Fix** : `-z` + split sur NUL (attention au layout des renames `Rnn\0old\0new\0`).

### B4 — MAJEUR · Aucune annulation des process git en vol
`git()` n'offre aucun abort ; `closeRepo` nettoie timer et watcher mais laisse tourner les
enfants (fetch, log, pickaxe `-S` à 30 s de timeout). La recherche lance des `git log` par
frappe sans supersession ; côté renderer, la « cancellation » est un booléen `stale`
recopié **7 fois** (use-async, repo-view ×2, refs-sidebar, home-screen, diff-view,
commit-search) qui ne protège que le `setState` — le travail git continue.
**Fix** : `AbortSignal` traversant le contrat IPC (request-id + kill de l'enfant côté main).

### B5 — MAJEUR · Réponses de statut désordonnées
`repo-view.tsx:93-98` : `refreshStatus` sans garde d'époque, déclenché concurremment par
`onChanged`, `onOp`, commit, checkout, stash, branch. Deux `git status` en vol peuvent
résoudre dans le désordre : l'ancien écrase le récent (et re-bump `refsGen`, re-déclenchant
les effets flow). Idem `refreshWorktree` (focus fenêtre vs post-commit).

### B6 — MINEUR · Bouton commit sans `try/finally`
`worktree-panel.tsx:242-246` : `setCommitting(true); await onCommit(); setCommitting(false)`.
Latent aujourd'hui (le `onCommit` de repo-view catche en interne) mais le contrat n'est écrit
nulle part — le jour où `onCommit` rejette, le bouton reste désactivé pour toujours.

### B7 — MINEUR · Divers confirmés
- **Fuite rAF de scroll-text** : si l'élément survolé est démonté sans mouseleave (reset,
  changement d'onglet), la boucle rAF tourne indéfiniment sur un nœud détaché ; `destroy()`
  n'appelle jamais `scrollTextStop()` (`graph-canvas.ts:1049`).
- **Toggle de thème désynchronisé** : `tab-strip.tsx:31-36` copie `isDark` dans un state
  local sans s'abonner à `onThemeChange` — un flip de thème OS laisse l'icône fausse.
- **Titre de fenêtre jamais réinitialisé** en revenant à l'onglet Home (`repo-view.tsx:187`).
- **`repo:status` rejette sur HEAD unborn** (dépôt fraîchement `git init`) : le premier
  `rev-parse` n'a pas de catch (`index.js:166`) — alors que `repo:unstage` gère ce cas.
- **Stats `loaded < total` pour toujours** sur les dépôts gitflow : chaque capsule retire une
  ligne mais `total` n'est jamais réconcilié à l'épuisement (`graph-canvas.ts:578`).
- **Boucle crash-reload infinie** : `render-process-gone → reload()` sans plafond
  (`index.js:929-932`) — un crash déterministe devient une boucle CPU + incidents.log sans fin.
- **Limite argv Windows** : `stage`/`unstage` splattent tous les chemins en ligne de commande ;
  « tout stager » sur 10k fichiers dépasse ~32k caractères. `git()` supporte déjà stdin :
  `--pathspec-from-file=- --pathspec-file-nul`.
- **`repo:refs` spawne un `git reflog` par branche locale sans upstream** en un seul
  `Promise.all` — 200 branches = 200 process concurrents à chaque refresh.
- **Icône applicative périmée** : `make-icon.mjs` rasterise un ancien glyphe, pas le `Mark`
  actuel — `resources/icon.png` ne correspond plus au logo.
- **`inRepo` est un check lexical** : un symlink interne pointant dehors permet à
  `repo:wtdiff`/`repo:openFile` de lire/ouvrir hors dépôt. `realpath` des deux côtés.
- **`shell.openPath` lance les exécutables du dépôt** : un dépôt cloné hostile contient un
  `.exe`/`.lnk` — un appel IPC = exécution native. Blocklister les extensions exécutables
  ou passer par `showItemInFolder`, et documenter le risque résiduel.

---

## 3. Chantier 1 — Le contrat IPC partagé typé (pierre angulaire)

**Constat.** Le contrat vit en trois exemplaires synchronisés à la main : `ipcMain.handle('repo:log', …)`
dans le main (JS), `ipcRenderer.invoke('repo:log', …)` dans le preload (JS), et le type
`Bridge` dans `lib/git.ts:145-181` — dont le commentaire d'en-tête avoue tout : *« Miroir
typé de ce que le preload expose »*. Un renommage ou un argument ajouté ne casse qu'à
l'exécution. C'est aussi ce qui rend chaque feature chère (3 fichiers à toucher avant même
d'écrire l'UI).

**Cible.**

```
src/shared/
  ipc-contract.ts   # la map typée des canaux : { "repo:status": (id: RepoId) => Status, … }
  types.ts          # Commit, GitRef, Stash, Worktree, FlowInfo, OpEvent, TraceLine…
                    # (déménagés depuis renderer/lib/git.ts, importés par les 3 process)
  errors.ts         # codes d'erreur structurés (voir chantier 2)
```

- Main : un registrar `handle<K extends Channel>(channel, handler)` qui vérifie le sender,
  valide les arguments et sérialise les erreurs — un seul endroit.
- Preload : générique, dérivé du contrat ; les `on*` **retournent un unsubscribe**
  (aujourd'hui impossible de se désabonner, d'où le singleton `fanout` côté renderer).
- Renderer : le client typé remplace le miroir manuel.
- Au passage : migrer `src/main` et `src/preload` en TypeScript strict (electron-vite
  compile les `.ts` sans config ; `tsconfig.node.json` passe à `strict: true`, exit
  `checkJs`). Migrer **sans** le contrat partagé reviendrait à re-typer le miroir une
  quatrième fois — faire les deux ensemble.
- `bootState` exécuté à l'import du module (`git.ts:216`, side-effect non idempotent avoué
  en commentaire) devient un `boot()` explicite appelé par `main.tsx` ; `app:state` devient
  idempotent côté main.

## 4. Chantier 2 — Découpage du main process + erreurs structurées

**Constat.** 967 lignes mêlant exécution git + trace, registre de dépôts, état persisté +
allowlist, parsing worktree/stash/log/refs, opérations réseau + autofetch, watchers, scan de
découverte, ~30 handlers IPC entrelacés avec la logique métier, git-flow, analyse
merged/gone, gestion de fenêtre et rapport de crash.

**Erreurs.** Elles traversent l'IPC comme des strings françaises pré-localisées (le renderer
doit même stripper le préfixe `Error invoking remote method…`), sans code — impossible de
distinguer programmatiquement « pas un dépôt » / « conflit » / « timeout ». `gitError` perd
les messages portés par stdout (conflit de `stash pop`, avoué en commentaire) et jette le
code de sortie. L'API est incohérente : `openRepo` retourne `{ error }`, tout le reste throw.

**Cible.**

```
src/main/
  index.ts        # ~40 lignes : lifecycle, single-instance lock, câblage
  window.ts       # createWindow, crash/incidents (avec plafond de reload), durcissement navigation
  security.ts     # setPermissionRequestHandler deny-all, hook web-contents-created
  ipc.ts          # registrar typé (sender check, validation, sérialisation d'erreurs)
  state.ts        # état persisté, allowlist, écriture atomique (temp + rename)
  repos.ts        # registre : open/close, ids, mutex de mutation par dépôt, autofetch
  watcher.ts      # watch .git, debounce/mute, récupération sur erreur
  scan.ts         # découverte de dépôts
  git/
    exec.ts       # spawn : env, timeouts + escalade SIGKILL, plafond de sortie, AbortSignal,
                  # émetteur de trace injecté (fini le scan inverse path→tab et le mainWindow global)
    parse.ts      # porcelain-z, name-status-z (fix B3), for-each-ref, stash-list, gitError
                  # ← fonctions pures, unit-testées
    queries.ts    # log, refs+merged/gone (avec pool de concurrence), status, files, diff, search
    ops.ts        # fetch/pull/push, branches, la danse checkout, stage/commit/stash
    flow.ts       # préfixes, flowInfo, finish (avec fix B2)
```

- **Erreurs structurées** : `{ code: 'NOT_A_REPO' | 'MERGE_CONFLICT' | 'TIMEOUT' | …, detail }`,
  localisées côté renderer. Résout d'un coup la programmabilité, l'i18n et l'incohérence
  throw/return.
- **Hygiène process** : timeout par défaut pour les lectures (aujourd'hui infini), kill des
  enfants au `closeRepo`, plafond d'accumulation stdout (un `repo:diff` pathologique peut
  approcher la limite de string V8), mutex de mutation unifié (la danse
  stash→checkout→pop court aujourd'hui sans verrou face à l'autofetch).
- **Durcissement v1.0** : fuses Electron (`RunAsNode`, `NodeOptions`, asar integrity),
  `requestSingleInstanceLock` (deux instances = state.json écrasé dernier-écrivain),
  compléter la CSP prod (`object-src 'none'`, `base-uri 'none'`, `form-action 'none'`),
  gate `GG_DEBUG` (port de remote debugging) sur `!app.isPackaged`.

## 5. Chantier 3 — État renderer : couche requêtes + store par dépôt

**Constat.** `repo-view.tsx` possède sept domaines sans lien (miroirs d'état serveur,
sélection double-source synchronisée à la main, chrome UI, brouillon de commit, machine à
états de boot en bitmask `B_STATUS…B_ALL`, feedback d'opérations, mesures du canvas en state
React). Conséquences mesurables :

- Chaque frappe dans le sujet de commit re-rend tout l'arbre RepoView, y compris
  `RefsSidebar` qui reconstruit son arbre de refs à chaque rendu.
- La sélection est clavée par **index de ligne**, invalidée par tout reset : pull, checkout,
  stash font perdre sélection/diff/vue même quand les commits existent encore.
- Trois idiomes d'invalidation coexistent : `refsGen` encodé dans une clé string, flags
  `stale` ×7, compteur `gen` du graphe. Le premier repose sur une convention de format de
  chaîne, avec un `eslint-disable` pour un linter qui n'existe pas.
- `useAsync` vide ses données à chaque clé (flash), au point que la sidebar refuse de
  l'utiliser et re-code l'effet à la main — en le documentant.
- Prop drilling : 10 props vers RefsSidebar, 14 vers WorktreePanel.
- Aucun ErrorBoundary : un throw de rendu = fenêtre blanche, rattrapée seulement par le
  reload complet du main.

**Cible.**

- **État serveur → TanStack Query** : `['status', id]`, `['refs', id]`, `['worktree', id]`,
  `['files', id, hash, parent]`, `['diff', …]` avec `placeholderData: keepPreviousData`.
  Les mutations (commit, checkout, stash, branch, stage) **invalident** leurs clés ; les
  événements `onChanged`/`onOp` appellent `invalidateQueries`. Ce seul mouvement supprime :
  `useAsync`, `refsGen`, le bitmask de boot (l'union pending des 4 requêtes), les 7 flags
  `stale`, le bug B5 (désordre), et le flash de données.
- **État client → un store zustand par dépôt** (store vanilla créé dans un Provider — les
  onglets restent isolés, propriété que le montage par onglet donne déjà) : slices
  `selection` (clavée par **hash**, actions reducer — l'invariant additif/soustractif vit à
  un seul endroit), `commitDraft`, `ui`, `ops`. Les composants s'abonnent à leur slice ;
  RepoView redevient un layout de slots (~100 lignes).
- Les mesures du canvas (`graphW`, `branchW`) s'écrivent en propriétés CSS directement sur
  le conteneur — plus de re-rendu de l'arbre pour un redimensionnement de colonne.
- Thème via `useSyncExternalStore` (`useTheme()`), navigation d'onglets en union discriminée
  `{ kind: "home" } | { kind: "repo"; id: RepoId }` au lieu du sentinel `HOME = 0` partageant
  l'espace des ids.
- ErrorBoundary par onglet + autour de DetailPanel/DiffView, avec action « recharger l'onglet ».
- Un registre de raccourcis clavier par onglet, scope-aware (diff ouvert > recherche focus >
  défaut) — remplace les 5 listeners `keydown` globaux couplés par `stopPropagation`.

## 6. Chantier 4 — Décomposition du moteur de graphe

**Constat préalable.** `graph-canvas.ts` **n'utilise pas `<canvas>`** : c'est un renderer
SVG + DOM impératif. Le nom trompe activement ; à renommer.

- La closure `createGraph` (900 lignes) mêle cache de pages LRU, fetch/pagination,
  pilotage du layout, fabrique de lignes DOM (chips, avatars, capsules), montage SVG,
  mesure de colonnes, hover, popover « +N », sélection/recherche, et `foldStashes` (une
  transformation de données qui appartient au layout). Rien n'est testable isolément.
- `graph-layout.ts` n'est pas pur : constantes pixel, sérialisation SVG, `var()` CSS, et
  **des strings d'UI français dans le module d'algorithme** (`chainInfo` retourne
  « mergée dans… ») — violation de couche et blocage i18n.
- Perfs sur gros dépôts : `jumpTo`/`nextMatch` en O(n²) cumulé (fetch page-à-page séquentiel
  + `git log --skip=k` lui-même O(k)) ; l'overlay d'arêtes longues re-sérialisé
  intégralement à chaque page (O(n²/PAGE), jamais virtualisé) ; `branchChain` descend
  jusqu'à la racine à **chaque mouseover** avec des `unshift` quadratiques.
- Calibration : `CHUNK = 500` sert à la fois de bucket SVG et de fenêtre de lignes HTML —
  jusqu'à ~1 500 lignes lourdes montées pour ~30 visibles (~50× d'overdraw). Découpler.
- Pas de `ResizeObserver` : `sync()` ne tourne que sur scroll/fetch ; la correction sur
  resize tient au mou de 14 000 px des chunks — invariant implicite que la recalibration
  ci-dessus casserait immédiatement.
- Constantes dupliquées qui peuvent dériver en silence : `ROW = 28` ↔ `h-7`, largeurs de
  colonnes re-sommées à la main dans `FIXED_W`, `LANES = 10` couleurs ↔ `MAX_LANES = 12`
  clip (les lanes 10-11 recyclent les couleurs 0-1 ; ≥ 12 disparaissent sans affordance).

**Cible.**

```
src/renderer/src/features/graph/
  constants.ts       # ROW, LANE, CHUNK, PAGE, palette, largeurs (grid-template dérivé)
  ids.ts             # interning SHA complet → id entier (fix B1)
  layout/            # pur, exécutable sous Node, zéro DOM/px/CSS ← la surface de test
    state.ts         # LayoutState (chunks paresseux)
    lanes.ts         # layoutChunk : allocateur de lanes + topologie d'arêtes (en données)
    chains.ts        # chainTip O(montée) pour le hover, branchChain, chainInfo → données
                     # structurées ({ refs, mergedInto } — plus de prose)
    collapse.ts      # collapsePairs + foldStashes
  render/            # geometry (X/Y/edgePath), svg (sérialisation, cache de markup par
                     # chunk), overlay (arêtes longues incrémentales + bucketées par
                     # intervalle), rows (fabriques DOM), measure
  data/              # page-cache (LRU + pin, testable sans DOM), loader (pipeline unique
                     # fetchMore/ensureRows, jumpTo en fetch groupé annulable, onError
                     # remonté à l'UI — aujourd'hui les échecs de log sont muets)
  controller.ts      # fenêtre de viewport découplée de CHUNK, ResizeObserver, GraphHandle
  interactions/      # selection, hover (via chainTip), popover +N (opérable clavier),
                     # keyboard (grille ARIA, navigation flèches)
  react/commit-graph.tsx  # le shell actuel, inchangé
```

## 7. Chantier 5 — Verticalité des features

**Test concret aujourd'hui** : « ajouter un panneau stash » = toucher `main/index.js`
(handlers non typés) + `preload/index.js` (miroir) + `lib/git.ts` (types à la main) +
`repo-view.tsx` (état, callbacks, layout) + un composant dans `components/` à plat +
`refs-sidebar.tsx` pour le point d'entrée. Six fichiers, trois process, zéro aide du
compilateur. La feature stash existante est étalée exactement comme ça.

**Cible** : `components/` éclate en trois altitudes —

```
renderer/src/
  app/            # shell : App (layout + view transitions), navigation.ts, boot.ts,
                  # shortcuts.ts, ErrorBoundary
  lib/            # ipc client typé, query.ts (clés), theme, prefs (localStorage typé), utils
  features/
    repo/         # RepoView slot-layout, store par dépôt, use-repo-queries, ops
    graph/        # (chantier 4)
    refs/         # sidebar + arbre + menus + queries (le fichier de 514 lignes = 5 modules
                  # qui cohabitent : fetch, filtre, arbre, menus, peinture des runs)
    worktree/     # panel + slice commitDraft
    stash/        # ← le dossier « copie-moi »
    diff/         # diff-view + pipeline shiki/diff2html
    search/  flow/  console/  home/
  components/ui/  # design system, inchangé
```

**Après refactor**, ajouter une feature = créer `features/x/` (composant + queries + actions),
étendre `shared/ipc-contract.ts` + un fichier handler dans `main/git/`, une ligne de slot
dans RepoView. Deux points d'édition hors du dossier, tous deux vérifiés par le compilateur.

Dette de découpage associée (à résorber pendant le déménagement) :

- `commit-message.ts` fait six métiers → `commit-parse.ts`, `markdown.ts`, `gitflow.ts` ;
  `fileStatusColor`/`BadgeColor` remontent vers l'UI (le sens de dépendance est inversé).
- `buildTree` dupliqué (file-list / refs-sidebar) → `lib/path-tree.ts` générique.
- Le helper `item(label, cmd)` défini deux fois dans refs-sidebar ; les 4 fabriques
  d'IconButton quasi identiques de worktree-panel ; le quatuor « op git → refresh →
  resetAndLoad → showOp » recopié 4 fois dans repo-view → un `runGitAction()`.
- Le trio spinner/erreur recopié 4 fois → un `<AsyncHint>` partagé.
- La peinture impérative des « runs » de focus dans refs-sidebar (querySelector +
  `offsetParent` + rAF) : passer les Collapsible en contrôlé et calculer les runs en données ;
  au minimum isoler et documenter l'invariant. Le remount-par-clé pour forcer `defaultOpen`
  (3 variantes) disparaît avec des Collapsible contrôlés.

## 8. Accessibilité (barre v1.0 OSS)

Quasi absente aujourd'hui, et c'est le premier reproche que fera un public exigeant :

- **Le graphe est invisible au clavier et aux lecteurs d'écran** : lignes en
  `div.cursor-pointer` sans role/tabindex/aria-selected, aucune navigation flèches.
  Le popover « +N » s'ouvre **uniquement au survol** — le bouton est focusable (bon
  instinct, `aria-expanded` présent) mais inopérable au clavier : les refs cachées sont
  inaccessibles sans souris. Cible : `role="grid"` + roving tabindex, flèches/PageUp/Down
  pilotant `reveal`, Enter = sélection, popover togglable au clic/Enter.
- `FileRow` est un `<div>` cliquable (la liste de fichiers, interaction cœur, est
  souris-only) ; l'ouverture dans l'OS est double-clic-only ; le checkout des
  remotes/tags est double-clic-only.
- La console git est un popover fait main sans `role="dialog"` ni gestion de focus, alors
  que le kit embarque des primitives Base UI qui font tout ça.
- Le délai de 250 ms sur **chaque** clic simple de fichier (désambiguïsation du double-clic)
  se sent — inverser : simple clic instantané, l'action rare passe au menu contextuel.
- Bon point à préserver : `commit-search.tsx` est le haut du panier (aria-live,
  aria-pressed, restauration de focus dans diff-view). `inert` sur la nav repliée. Le
  `prefers-reduced-motion` est respecté partout, scroll-text compris.

## 9. Open-source readiness

### La décision n°1 : la langue
Tout est français : strings UI en dur, commentaires, docs de props, `lang="fr"`,
`toLocaleString("fr")` codé en dur (diff-view, git-console, status-bar), description
package.json, données du mock. Les identifiants sont anglais. Ce **mélange** est le seul
état non viable pour un OSS « wow » : les contributeurs ne peuvent pas relire ce qu'ils ne
lisent pas. Recommandation : anglais intégral pour la 1.0 (commentaires **traduits**, pas
supprimés — ils sont la valeur du code), strings extraites dans un module de messages
(même sans i18n complet), locale centralisée.

### La décision n°2 : le nom
`git-graph` (repo/package) vs `Amont` (produit, title, appId `fr.mathieuguey.amont`) vs
`window.gitgraph` (bridge) vs `gg-` (préfixes CSS/data). Le bridge et les préfixes sont
bon marché à renommer maintenant, coûteux après. Bonus : l'icône OS est un ancien logo
(voir B7) et le splash no-JS de index.html est une troisième copie manuelle du Mark.

### Confidentialité : les avatars fuient
`avatar.ts` : chaque auteur affiché déclenche une requête `gravatar.com` (+
`avatars.githubusercontent.com`). Le SHA-256 d'un email est trivialement réversible pour
toute adresse connue : consulter un dépôt privé d'entreprise divulgue son roster de
committers (hashé) + l'IP du spectateur à Automattic. Pour la 1.0 : toggle de settings
(défaut à débattre) + mention README. Les mitigations existantes (CSP img-src allowlistée,
`d=404`) sont bonnes. À scrubber aussi : la table `KNOWN` code en dur un mapping personnel,
`mock.html` contient le vrai email noreply GitHub du mainteneur, et les tables de typos de
`commit-message.ts` (`HTOFIX`, `BUFGIXE`…) encodent l'histoire d'une équipe privée —
à passer en config par dépôt ou supprimer.

### `sha256.ts` fait main : défendable, mais simplifiable
Implémentation correcte (vérifié : padding, longueur big-endian 64 bits, wraparound) et
différentiellement testée contre `node:crypto` — ce n'est pas un red flag, et le commentaire
donne la vraie raison (peinture synchrone des avatars vs `crypto.subtle` async-only).
Recommandation 1.0 : `avatarUrl` async mémoïsé par email (peu d'emails distincts par dépôt,
monogramme en attendant — le composant Avatar superpose déjà) et supprimer 51 lignes de
crypto artisanale + un script de test.

### Outillage manquant

| Élément | État | Cible |
|---|---|---|
| LICENSE + champ `license` | absent | **bloquant** — MIT/Apache-2.0 |
| README | absent | quoi/screenshots, install, Windows-only + SmartScreen, dev (`pnpm dev`/`mock`/`test`), note privacy |
| ESLint / Prettier | absents (un `eslint-disable` mort en témoigne) | flat config typescript-eslint type-checked + react-hooks + `no-restricted-imports` (frontière primitives) ; Prettier tranche le style .mjs/.ts |
| Tests | 3 scripts node ad hoc (s'arrêtent au 1er échec, pas de watch/coverage) | **vitest** : migration mécanique des assertions existantes, colocalisées en `*.test.ts` ; importer les vraies constantes (le `BUDGET = 2` redéclaré dans check-refs peut dériver) ; puis couvrir les trous : allocateur de lanes, résolution d'arêtes inter-chunks, cache LRU, parsers du main (extraits au chantier 2), et un test d'invariants sur fixture réelle (chaque arête résolue ou pending, `rowOf` bijectif — attrape B1) |
| CI | ubuntu-only, double exécution push+PR | matrice + `windows-latest` (la cible release n'est jamais buildée hors jour de tag), `concurrency` cancel, push restreint au défaut, step lint |
| package.json | description fr, pas de `repository`/`engines` | métadonnées anglaises complètes ; `engines.node >= 22.18` (le type-stripping des scripts l'exige déjà) ; documenter dans CONTRIBUTING le choix assumé « tout en devDependencies » (correct avec electron-vite/builder, mais un PR drive-by voudra le « corriger ») |
| Renovate/Dependabot | absent | nécessaire : diff2html (`innerHTML` avec contenu contrôlé par les dépôts — sûr aujourd'hui, à maintenir patché), shiki, electron |
| CONTRIBUTING / SECURITY | absents | conventions ui/primitives, marqueur de dette `ponytail:` (à documenter ou renommer), harnais mock, frontière de confiance du rendu de diff, process de release |
| Plateformes | nsis Windows only, hypothèses Windows dans le code | soit cibles mac/linux + lifecycle par plateforme (`activate`, menu macOS — `Menu.setApplicationMenu(null)` tue Cmd+C/V), soit statement « Windows-only » explicite |

### Poids et divers
- **shiki bundle complet** (`import { codeToTokens } from "shiki"`) : toutes les grammaires
  + moteur WASM — c'est lui qui impose `'wasm-unsafe-eval'` dans la CSP. Passer à
  `shiki/core` + moteur regex JS + liste de langages explicite, chargé au premier diff :
  bundle bien plus léger **et** une directive CSP en moins.
- Kit UI deux couches (`ui/` densifié h-6 sur `ui/primitives/` shadcn pristine) : le
  pattern est légitime et documenté, mais la frontière n'est pas appliquée — les features
  importent des deux couches au hasard. Un index re-export + règle lint. Morts à balayer :
  `primitives/dialog.tsx` (155 lignes, zéro import), `kbd`, `badge` doublonné, les tokens
  `--sidebar-*`/`--chart-*` et la règle CSS d'une palette de commandes inexistante.
- `useAsync` : soit v2 (`keepPrevious`, erreur exposée, vraie option de cache — le
  paramètre s'appelle `cacheKey` mais rien ne cache), soit absorbé par TanStack Query
  (recommandé, chantier 3).

---

## 10. Plan de refactor ordonné

Chaque phase rend la suivante moins chère ; les quick wins de la phase 0 sont
indépendants de tout.

**Phase 0 — Correctifs secs (avant ou pendant tout le reste)**
B2 (git-flow `-`), B3 (`-z`), B6 (`try/finally`), fuite rAF scroll-text, toggle thème,
titre fenêtre, HEAD unborn, plafond crash-reload, `--pathspec-from-file`, pool de
concurrence sur `repo:refs`, régénérer l'icône.

**Phase 1 — Le contrat (chantier 3.1)**
`src/shared/` (contrat IPC + types + codes d'erreur), registrar typé côté main, preload
générique avec unsubscribe, migration TS strict de main/preload, `boot()` explicite.
*Débloque tout le reste.*

**Phase 2 — Main découpé (chantier 4.2)**
`git/exec.ts` avec AbortSignal + timeouts + plafonds (B4), erreurs structurées, parsers purs
extraits **avec leurs tests vitest** (B3 verrouillé), puis le découpage mécanique des
modules, mutex de mutation, durcissement (fuses, single-instance, CSP, permissions).

**Phase 3 — État renderer (chantier 5.3)**
TanStack Query (tue B5, refsGen, bitmask, flags stale, useAsync), store par dépôt,
sélection par hash (avec B1 fixé en phase 4 — coordonner), RepoView en slots,
ErrorBoundaries, registre de raccourcis.

**Phase 4 — Moteur de graphe (chantier 6.4)**
`ids.ts` (B1), layout pur sans px/CSS/prose, overlay incrémental, fenêtre de lignes
découplée de CHUNK + ResizeObserver, `chainTip`, jumpTo groupé annulable, constantes
unifiées, remontée d'erreurs. Suite de tests vitest du layout en parallèle.

**Phase 5 — Verticalité (chantier 7.5)**
Feature folders (surtout des `git mv` une fois 1-4 posées), découpages lib, dédup UI,
frontière ui/primitives outillée.

**Phase 6 — A11y + OSS**
Grille ARIA du graphe, FileRow bouton, popovers clavier, console en dialog ; puis la passe
langue (anglais intégral), naming unifié, LICENSE/README/CONTRIBUTING/SECURITY, ESLint/
Prettier, CI matricielle, Renovate, scrub des données personnelles, toggle avatars,
shiki/core.

**Estimation honnête** : les phases 1-2 sont le gros œuvre invisible (aucun changement
visuel) ; les phases 3-4 sont les plus délicates (le comportement doit être préservé —
le harnais mock.html et les fixtures de tests sont les filets) ; les phases 5-6 sont
volumineuses mais mécaniques. Le résultat final : une feature = un dossier + deux points
d'édition compilés, un moteur de graphe testé propriété par propriété, et un dépôt qui
soutient l'inspection ligne à ligne d'un public exigeant.
