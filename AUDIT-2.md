# Audit round 2 — régressions du refactor AUDIT.md

> Ré-audit après implémentation complète d'`AUDIT.md`. Objectif : (1) confirmer que les
> bugs d'origine (B1–B7) et les 5 chantiers sont bien corrigés, (2) trouver les régressions
> introduites par le refactor. Chaque finding donne `fichier:ligne` et un scénario de
> reproduction vérifiable indépendamment.
>
> Baseline au moment de l'audit : `pnpm typecheck` ✅ · `pnpm test` 124/124 ✅ ·
> `pnpm lint` 0 erreur (16 warnings react-refresh cosmétiques) ✅ · `pnpm build` ✅.

## Verdict

Le refactor est complet et fidèle au plan. **Les 7 bugs d'origine et les 5 chantiers sont
implémentés et corrects** (vérifiés ligne à ligne, cf. §1). Ce document liste **12 régressions
confirmées** introduites par le refactor, dont **3 HIGH visibles en usage normal**.

## Le fil rouge : chemins d'invalidation/reset incomplets

Trois des findings les plus graves sont la même erreur sous trois formes — _un cache/état qui
survit au remplacement de son état source_ :

| #       | Cache/état qui survit                                 | Devrait être lié à                        |
| ------- | ----------------------------------------------------- | ----------------------------------------- |
| **F1**  | overlay des arêtes longues (`buckets`, `assignedLen`) | `LayoutState` recréé par `loader.reset()` |
| **F4**  | cache de markup SVG par chunk                         | idem                                      |
| **2.1** | query `stashes`                                       | `invalidateRepo` (statut du dépôt)        |

Un `reset()` sur overlay/markup/measurer appelé depuis `controller.reset()`, plus l'ajout de
`queryKeys.stashes` dans `invalidateRepo`, referment toute la famille (F1, F4, F5, 2.1).

---

## 1. Statut des bugs d'origine (tous vérifiés FIXED)

| Item                                     | Statut | Preuve                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **B1** identité commit 32 bits           | FIXED  | `ids.ts` interne SHA complet → id séquentiel (`internId`/`idOf`) ; `rowOf: Map<HashId,number>` ; `shortHash` (`ids.ts:48`) purement cosmétique ; SHA complets transportés (`main/git/queries.ts:90` `%H`) ; `invariants.test.ts` verrouille la bijectivité. Aucun `parseInt`/`slice(0,8)`/`hkey` résiduel.                                                                                                    |
| **B2** injection arg `git flow finish`   | FIXED  | `flow.ts:87` `if (version.startsWith("-")) throw`. (Voir #2 : `flowInfo` a un trou résiduel connexe.)                                                                                                                                                                                                                                                                                                         |
| **B3** `repo:files` noms spéciaux        | FIXED  | `queries.ts:221` `--name-status -z` ; `parseNameStatus` split NUL + renames `R`/`C` ; testé (`parse.test.ts`).                                                                                                                                                                                                                                                                                                |
| **B4** annulation process git            | FIXED  | AbortSignal via `requestId`/`repo:cancel` (`ipc.ts:53`, `206`) ; `DEFAULT_TIMEOUT=60s` ; SIGTERM→SIGKILL (`exec.ts:61`) ; `killAll` au `closeRepo` (`repos.ts:177`) ; `OUTPUT_CAP` (`exec.ts:31`). (Voir #1 : réserve sur la fuite de `r.requests`.)                                                                                                                                                          |
| **B5** `git status` désordonné           | FIXED  | `repo-queries.ts` clé `["status", id]` via TanStack Query ; aucun `setState` racy.                                                                                                                                                                                                                                                                                                                            |
| **B6** bouton commit sans try/finally    | FIXED  | `worktree-panel.tsx:277` `try { await onCommit() } finally { setCommitting(false) }`.                                                                                                                                                                                                                                                                                                                         |
| **B7** fuite rAF scroll-text + divers    | FIXED  | Garde `!el.isConnected` (`scroll-text.ts:55`) + `scrollTextStop()` dans `destroy()` (`controller.ts:526`). Toggle thème `useSyncExternalStore` (`theme.ts`). Titre fenêtre reset (`App.tsx:63`). HEAD unborn `.catch` (`queries.ts:34`). Plafond crash-reload (`window.ts:67`). `--pathspec-from-file` (`ops.ts:180`). Pool reflog `REFLOG_POOL=8` (`queries.ts:203`). Icône = Mark actuel (`make-icon.mjs`). |
| Durcissement Electron                    | FIXED  | Fuses (`after-pack.mjs`), `requestSingleInstanceLock` (`index.ts:14`), CSP prod `object-src/base-uri/form-action 'none'` sans `wasm-unsafe-eval` (`csp.mjs`), gate remote-debug sur `!isPackaged` (`index.ts:22`).                                                                                                                                                                                            |
| `inRepo` realpath / openPath exécutables | FIXED  | realpath des deux côtés (`repos.ts:204`) ; denylist 25 extensions → `showItemInFolder` (`queries.ts:275`). Sender IPC vérifié (`ipc.ts:31`).                                                                                                                                                                                                                                                                  |
| Contrat IPC typé + preload générique     | FIXED  | Source unique `src/shared/` ; preload `invoke<K>`/`on<K>` avec unsubscribe (`preload/index.ts`) ; `window.amont`.                                                                                                                                                                                                                                                                                             |
| Erreurs structurées `{code,detail}`      | FIXED  | `AppError` JSON-in-message (`shared/errors.ts`), `classifyGitFailure` (`parse.ts`), `describeError` localisé côté renderer.                                                                                                                                                                                                                                                                                   |
| État renderer (chantier 3)               | FIXED  | TanStack Query, store zustand par dépôt (`repo-store.tsx`), sélection par hash, ErrorBoundary par onglet + DetailPanel/DiffView, registre de raccourcis scope-aware, navigation `{kind:"home"}                                                                                                                                                                                                                | {kind:"repo",id}`, `boot()`explicite.`useAsync`/`stale`×7/`refsGen`/bitmask supprimés. |
| Moteur de graphe (chantier 4)            | FIXED  | Layout pur (zéro DOM/px/CSS/prose), `chainInfo` structuré, `chainTip` O(montée), ResizeObserver, constantes dérivées, `graph-canvas.ts` renommé, remontée d'erreurs. (Voir F1–F6.)                                                                                                                                                                                                                            |
| Verticalité + a11y + OSS (chantiers 5/6) | FIXED  | Feature folders, `role="listbox"` clavier, FileRow bouton, console `role="dialog"`, i18n intégral anglais, LICENSE/README/CONTRIBUTING/SECURITY, ESLint/Prettier, vitest, CI matricielle windows, Renovate, `shiki/core`, toggle avatars off par défaut.                                                                                                                                                      |

---

## 2. Régressions confirmées

### HIGH — impact visible sur tout dépôt actif

#### F1 — Overlay des arêtes longues non réinitialisé au reset

- **Fichiers** : `src/renderer/src/features/graph/render/overlay.ts` (pas de `reset()` exporté) ; instancié une fois en `src/renderer/src/features/graph/controller.ts:80` ; jamais vidé par `reset()` (`controller.ts:426`) ni `remount()` (`controller.ts:232`).
- **Défaut** : `createOverlay()` n'expose que `{ root, sync }`. Son état de closure — `buckets`, `mounted`, `assignedLen` (monotone, cf. commentaire l.44) — survit à `loader.reset()`, qui recrée pourtant un `LayoutState` neuf avec `S.long = []`. `remount()` ne vide que `mountedG`/`mountedRows`.
- **Conséquence** : après tout git op sur le **même** dépôt (`resetAndLoad → graph.reset()`, `repo-store.tsx:325`) :
  1. `assignNew` (`overlay.ts:47-48`) : `for (; assignedLen < S.long.length; assignedLen++)`. `assignedLen` reste à sa valeur d'avant reset (ex. 50) alors que le nouveau `S.long` repart de 0 → aucune nouvelle arête longue n'est bucketée tant que l'historique n'a pas repassé l'ancien compte.
  2. `buckets` contient encore les arêtes de l'état précédent (positions de lignes périmées) ; `sync()` les remonte dans le viewport → géométrie d'arêtes fausse.
- **Répro** : dépôt avec ≥1 merge inter-chunks → `git commit`. Les arêtes longues affichées sont celles d'avant le commit (décalées d'une ligne) et les nouvelles sont absentes. Masqué uniquement sur un refresh sans changement d'historique (arêtes recalculées coïncidentes).
- **Fix** : ajouter `reset()` à l'overlay (vider `buckets`/`mounted`, `assignedLen=0`, retirer les `<g>` montés) et l'appeler depuis `controller.reset()`.

#### F2 — Correspondances de recherche résolues en ids trop tôt (hits profonds perdus)

- **Fichier** : `src/renderer/src/features/graph/controller.ts:483-485` (`setMatches`), avec `nextMatch` (`controller.ts:490-503`) et `applyMatches` (`interactions/selection.ts:71`).
- **Défaut** :
  ```ts
  const ids =
    hashes &&
    hashes.map((h) => idOf(loader.state.ids, h)).filter((id): id is number => id !== undefined)
  selectionCtl.setMatches(ids, loader.state.hashOf)
  ```
  `idOf` ne résout que les SHA **déjà internés** (déjà paginés). `api.search` renvoie des hits sur tout le dépôt ; ceux sous la fenêtre chargée → `undefined` → filtrés. Le `Set` de matches (`selection.ts:72`) est construit une fois et jamais réactualisé à la pagination.
- **Répro** : dépôt fraîchement ouvert (~2 pages ≈ 2000 lignes chargées), recherche renvoyant un hit ligne ~8000. Le hit est jeté. L'utilisateur presse Entrée/F3 : `nextMatch` fait `growUntil` pour charger la ligne, mais `matches.has(hashOf[i])` (`controller.ts:498`) est faux → balaie jusqu'à la fin et renvoie `null` (« aucun résultat suivant ») alors que le résultat existe. La ligne n'est jamais surlignée. La recherche paraît marcher près du sommet et échouer en profondeur.
- **Fix** : conserver les matches en SHA (strings), ou ré-interner/ré-appliquer `setMatches` à chaque page ingérée.

#### 2.1 — La query `stashes` n'est jamais invalidée

- **Fichier** : `src/renderer/src/lib/queries.ts:40-45` (`invalidateRepo`) ; consommée en `src/renderer/src/features/stash/stash-queries.ts:12` et `stash-section.tsx:85`.
- **Défaut** : `invalidateRepo` invalide `status`/`refs`/`flow`/`flowInfoAll` — **jamais `queryKeys.stashes`**. Aucun autre site ne l'invalide (grep : `queryKeys.stashes` n'apparaît que dans sa définition et `useStashesQuery`). `resetAndLoad` n'invalide que `worktree` (`repo-store.tsx:327`). `QueryClient` : `refetchOnWindowFocus:false` (`lib/query-client.ts:16`), `staleTime` par défaut ; `StashSection` reste monté → la query ne se charge qu'au montage.
- **Répro** : dépôt avec un stash → « Stash changes » depuis le panneau worktree (ou apply/drop/pop via menu contextuel). Le graphe recharge et montre les nœuds de stash à jour, mais la **section Stash de la sidebar reste périmée** (nouveau stash absent, ou stash droppé toujours présent) → incohérence graphe/sidebar. Idem `git stash` externe (`onChanged → invalidateRepo`).
- **Fix** : ajouter `void client.invalidateQueries({ queryKey: queryKeys.stashes(id) })` dans `invalidateRepo`.

### MEDIUM

#### F3 — `growUntil` sans verrou single-flight → layout corrompu sous concurrence

- **Fichier** : `src/renderer/src/features/graph/data/loader.ts:155-179` (`growUntil`) vs `90-111` (`fetchMore`) et `ingest` (`loader.ts:67-78`), `page-cache.ts:54` (`appendPage`).
- **Défaut** : `fetchMore` est protégé par le drapeau `fetching`. `growUntil` ne le lit ni ne le pose. `ingest(pi, raw, true)` **ignore l'argument `pi`** et empile via `rowStart = S.next` + `appendPage` (`nPages++`). Si un `fetchMore` déclenché par le scroll (`sync()`, `controller.ts:163`) empile une page pendant le `await Promise.allSettled` de `growUntil`, `S.next` avance ; les pages du lot sont alors ré-appendées à un `rowStart` décalé → commits dupliqués, `S.next` sur-compté, `rowOf` écrasé.
- **Répro** : touche `End` (`moveActive → growUntil`) pendant un scroll inertiel (`sync() → fetchMore()`). Fenêtre de timing étroite mais réelle. Aucun mutex ne sépare `growUntil` de `fetchMore` ni deux `growUntil`.
- **Fix** : faire passer `growUntil` par le même verrou single-flight que `fetchMore` (ou sérialiser toute ingestion `isNew`).

#### F4 — Cache de markup SVG par chunk non réinitialisé au reset

- **Fichier** : `src/renderer/src/features/graph/render/svg.ts` (`createMarkupCache`) ; instancié une fois en `controller.ts:79` ; utilisé `controller.ts:176` (`markup.chunkMarkup(ci, S)`).
- **Défaut** : même racine que F1. Instance unique, invalidée seulement sur `edges.length`/`nodes.length`, survit au reset alors que `S` est recréé. Un chunk plein a toujours `nodes.length===CHUNK` ; si `edges.length` coïncide aussi (fréquent en zone linéaire ou décalage de topologie à compte constant), `chunkMarkup` renvoie l'**ancienne** chaîne mémoïsée → métro dessiné depuis le layout périmé.
- **Fix** : `reset()` sur le markup cache, appelé depuis `controller.reset()`.

#### #1 — Fuite non bornée de `r.requests` sur validation synchrone (DoS mémoire, renderer-triggerable)

- **Fichier** : `src/main/ipc.ts:53-62` (`withCancel`), couplé à `queries.files/diff/body` (`main/git/queries.ts:218,228,243`) qui appellent `assertHash` (`queries.ts:24`).
- **Défaut** : `withCancel` fait `r.requests.set(requestId, controller)` **puis** `return fn(controller.signal).finally(() => r.requests.delete(requestId))`. `assertHash` throw de façon **synchrone** avant le `return r.git(...)` → l'exception se propage avant que `.finally` ne soit attaché ; l'entrée reste dans `r.requests` (vidée seulement au `closeRepo`, `repos.ts:178`).
- **Répro** : renderer compromis (modèle de menace du projet) bouclant `window.amont.files(id, "ZZZ", null, <requestId unique>)`. Chaque appel : `assertHash("ZZZ")` throw `BAD_ARG` → un `AbortController` reste en Map → croissance sans borne = DoS mémoire du main. _N'affecte pas l'usage normal (hashs valides)._
- **Fix** : frontière async (`return Promise.resolve().then(() => fn(signal)).finally(...)`), ou `set` après un premier `await`.

#### A11y — Ligne « Uncommitted changes » non atteignable au clavier

- **Fichier** : `src/renderer/src/features/graph/react/graph-column.tsx:67`.
- **Défaut** : `<div onClick={showWorktree} className="… cursor-pointer …">` sans `role`/`tabindex`/handler clavier — exactement le pattern souris-only corrigé partout ailleurs (FileRow, popover +N, lignes du graphe).
- **Fix** : convertir en `<button type="button">`.

### MINEURS / NITS

- **#2 — `repo:flowInfo` : argument `branch` non validé par `BRANCH`.** `main/ipc.ts:160` ne vérifie que `typeof branch !== "string"` (contrairement à `repo:branch`/`checkout` qui imposent `BRANCH.test`). `branch` arrive seul à `git describe --tags --abbrev=0 <branch>` (`flow.ts:48`) → `branch="--dirty"` injecte une option. Lecture seule, mais régression de cohérence vs la doctrine B2.
- **#3 — Fuite de `FSWatcher`/fd si le dépôt est fermé pendant le back-off de retry.** `watcher.ts:60` planifie `setTimeout(() => watchGit(r), delay)` après une erreur (r.watcher=null) ; `closeRepo` (`repos.ts:172`) fait `r.watcher?.close()` (no-op) sans flag `closed` ni annulation du timer → à l'échéance, `watchGit` ouvre un FSWatcher orphelin. Borné à `RETRY_CAP=6`.
- **#4 — `diffNoIndex` sans timeout ni AbortSignal.** `exec.ts:165` : le chemin `wtdiff` untracked (`queries.ts:56`) n'est ni borné en temps ni annulable ; un `ENOBUFS` (dépassement `OUTPUT_CAP`) est avalé en diff vide au lieu d'un `OUTPUT_LIMIT`.
- **#5 — `HASH` incompatible SHA-256.** `queries.ts:22` `/^[0-9a-f]{7,40}$/` rejette les `%H` de 64 hex d'un dépôt `--object-format=sha256` → `repo:files/diff/body` échouent en `BAD_ARG`.
- **2.2 — Compteur de recherche périmé sous le seuil.** `search-queries.ts:14` combine `enabled: term.length >= SEARCH_MIN` et `placeholderData: keepPreviousData` : sous le seuil, `data` retombe sur les anciens hits → badge (`commit-search.tsx:144`) et boutons prev/next restent actifs alors que les surbrillances sont effacées. Clic = no-op. Cosmétique.
- **F5 — Le measurer conserve ses maxima au reset.** `render/measure.ts` : `seenType/seenCell/typeW/cellW` réinitialisés seulement par `requeueAll` (une fois sur `document.fonts.ready`), pas au `reset()` → colonne branche qui ne rétrécit jamais après un `branch -d` (cosmétique, même racine que F1/F4).
- **F6 — Code mort `selectionCtl.refresh`.** `interactions/selection.ts:76` défini, jamais appelé.
- **A11y — Toggle avatars sans `aria-pressed`.** `tab-strip.tsx:141` communique l'état via le libellé ("Show/Hide") seulement.
- **OSS — README image cassée.** `README.md:11` `![…](docs/screenshot-graph.png)` mais `docs/` n'existe pas → image cassée sur GitHub.
- **OSS — Référence de script obsolète.** `lib/sha256.ts:4` cite `scripts/check-sha256.ts` (supprimé, migré en `lib/sha256.test.ts`).
- **i18n — Résidus français.** Commentaire `components/ui/context-menu.tsx:20` ; chaînes de test `lib/commit-parse.test.ts:102-103`, `lib/markdown.test.ts:29,35`.
- **OSS — `NOTE(debt):` sans exemple vivant.** Convention documentée dans CONTRIBUTING mais zéro occurrence dans le code. `REFACTOR-PROMPTS.md` (artefact de prompt interne) à la racine d'un repo public — discutable.

---

## 3. Écarts assumés (non-bugs, pour mémoire)

- `lib/sha256.ts` fait main **conservé** — la suggestion d'audit (avatarUrl async mémoïsé + suppression de la crypto artisanale) n'a pas été suivie. Décision documentée (crypto.subtle async vs peinture impérative des avatars, sandbox). Défendable, d'autant que les avatars sont off par défaut.
- Graphe en `role="listbox"`/`role="option"` au lieu de `role="grid"` — déviation documentée, l'unité de navigation étant la ligne et non la cellule.
- `LANES=10` vs `MAX_LANES=12` — dette intentionnelle documentée dans `constants.ts`.

---

## 4. Ordre de correction recommandé

1. **Famille reset/invalidation** (une racine) : `reset()` sur overlay (F1) + markup (F4) + measurer (F5) appelé depuis `controller.reset()` ; `queryKeys.stashes` dans `invalidateRepo` (2.1).
2. **Recherche** : matches en SHA / ré-application à la pagination (F2).
3. **Race** : `growUntil` sous le verrou `fetching` (F3).
4. **Robustesse main** : frontière async dans `withCancel` (#1), validation `BRANCH` de `flowInfo` (#2), timeout/signal sur `diffNoIndex` (#4).
5. **A11y** : worktree-row en bouton, `aria-pressed` du toggle avatars.
6. **Nits OSS/i18n** : README image, ref script obsolète, résidus français, `REFACTOR-PROMPTS.md`.
