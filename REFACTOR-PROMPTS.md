# Prompts de session — refactor pré-1.0

Un prompt par phase du plan (`AUDIT.md` §10), à coller tel quel dans une **nouvelle session**
une fois la PR de la phase précédente mergée. Chaque prompt est autonome : il suppose
seulement que `AUDIT.md` (et les phases antérieures) sont sur la branche par défaut.

Convention de branche suggérée : `refactor/phase-N-<sujet>`. Chaque session se termine par
une PR, jamais par un push direct sur la branche par défaut.

---

## Phase 0 — Correctifs secs

```text
Lis d'abord AUDIT.md à la racine du dépôt — c'est l'audit pré-1.0 complet. Retiens
en particulier la section 1 (ce qui doit être préservé tel quel) et la section 2
(bugs confirmés avec fichier:ligne).

Ta mission : exécuter la Phase 0 du plan (section 10) — les correctifs secs,
SANS aucun changement d'architecture. Concrètement :

1. B2 — git flow finish : rejeter les suffixes de branche commençant par « - »
   (src/main/index.js ~619-625, même garde dans flowInfo ~666).
2. B3 — repo:files : passer à `-z` et parser sur NUL, y compris le format des
   renames Rnn\0old\0new\0 (src/main/index.js ~807-820).
3. B6 — bouton commit : try/finally autour de onCommit
   (worktree-panel.tsx ~242-246).
4. Fuite rAF de scroll-text : appeler scrollTextStop() dans destroy() et
   remount() de graph-canvas ; dans la boucle, sortir si !current.isConnected.
5. Toggle de thème de tab-strip : s'abonner à onThemeChange (useSyncExternalStore)
   au lieu de copier isDark dans un state local.
6. Titre de fenêtre : un seul effet dans App dérivé de l'onglet actif, qui
   réinitialise le titre en revenant sur Home.
7. repo:status sur HEAD unborn (dépôt fraîchement init) : catch sur le premier
   rev-parse, retourner un statut vide au lieu de rejeter (src/main/index.js ~166).
8. Plafond sur la boucle crash-reload : max 3 reloads en 60 s, ensuite page
   d'erreur statique (src/main/index.js ~929-932).
9. stage/unstage : passer par --pathspec-from-file=- --pathspec-file-nul
   (le support stdin existe déjà dans git()) pour éviter la limite argv Windows.
10. repo:refs : limiter la concurrence des `git reflog` (pool ~8) au lieu d'un
    Promise.all illimité (src/main/index.js ~798-802).
11. Stats du graphe : à l'épuisement de l'historique, réconcilier total avec le
    nombre de lignes réelles pour que « loaded/total » converge
    (graph-canvas.ts ~578).
12. Régénérer resources/icon.png depuis le Mark actuel via scripts/make-icon.mjs ;
    en profiter pour remplacer le setTimeout(200) par did-finish-load + un
    aller-retour requestAnimationFrame.

Règles :
- Un commit par correctif, message conventionnel en français comme l'historique
  existant (fix:, chore:…), avec une ligne expliquant le pourquoi.
- Aucun refactor opportuniste : pas de renommage, pas de déplacement de code,
  pas de changement de style — tout ça vient dans les phases suivantes.
- Quand un fix est testable en pur (B3 notamment), ajoute une assertion aux
  scripts scripts/check-*.ts existants.
- Après chaque commit : pnpm typecheck && pnpm test && pnpm build doivent être
  verts. Pour les fixes du graphe (4, 11), vérifie visuellement avec le harnais
  mock : vite --config vite.preview.config.mjs (port 5199).
- Si en implémentant tu découvres qu'un constat de l'audit est inexact, corrige
  le fix en conséquence et note l'écart dans la description de la PR — ne force
  pas un fix qui ne colle pas au code réel.

À la fin : pousse la branche et ouvre une PR intitulée
« fix: phase 0 — correctifs secs pré-refactor (AUDIT.md §2/§10) » dont la
description liste chaque correctif avec sa référence à l'audit, puis surveille
la CI.
```

---

## Phase 1 — Contrat IPC partagé typé + migration TypeScript du main/preload

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0. Sections clés pour toi :
1 (à préserver), 3 (chantier « contrat IPC »), 10 (plan). La phase 0
(correctifs secs) est déjà mergée.

Ta mission : la Phase 1 — poser le contrat IPC partagé typé et migrer
main/preload en TypeScript strict. AUCUN changement de comportement visible,
aucun découpage du main en modules (c'est la phase 2), aucun changement d'état
côté renderer (phase 3).

1. Crée src/shared/ :
   - types.ts : déménage depuis src/renderer/src/lib/git.ts tous les types du
     domaine (Commit, GitRef, Stash, Worktree, FlowInfo, Status, OpEvent,
     TraceLine, Repo/RepoId…). Le renderer les ré-importe depuis shared.
   - ipc-contract.ts : la map typée UNIQUE des canaux — pour chaque canal
     invoke, la signature (args, retour) ; pour chaque canal événement, le type
     du payload. Les noms de canaux deviennent des constantes dérivées de cette
     map, plus aucun littéral 'repo:*' dispersé.
2. Côté main : un registrar générique handle<K extends Channel>(channel, fn)
   qui (a) vérifie que l'événement vient de la fenêtre principale, (b) type les
   arguments et le retour contre le contrat. Tous les ipcMain.handle passent
   par lui. Ne déplace pas encore la logique métier — le fichier reste gros,
   c'est voulu.
3. Côté preload : réécris-le comme une projection générique du contrat (invoke
   typé + événements). Les abonnements on* retournent désormais une fonction
   de désabonnement (ipcRenderer.off). Côté renderer, supprime le singleton
   « fanout » devenu inutile et adapte les abonnés.
4. Migration TS : renomme src/main/index.js et src/preload/index.js en .ts
   (electron-vite les compile sans config ; le preload DOIT rester en sortie
   CJS — le commentaire d'electron.vite.config.mjs explique pourquoi, ne le
   casse pas). tsconfig.node.json passe à strict: true, supprime
   allowJs/checkJs. Type le record de dépôt du registre (interface RepoHandle :
   id, path, name, gitDir, running, muted, dirty, timer, watcher, trunk).
5. Boot explicite : lib/git.ts exécute aujourd'hui bridge.state() à l'import
   (bootState, side-effect non idempotent avoué en commentaire). Remplace par
   une fonction boot() appelée une fois depuis main.tsx, et rends app:state
   idempotent côté main.
6. Mets à jour src/renderer/mock.html pour qu'il stubbe la nouvelle forme du
   bridge (unsubscribe compris) — c'est le harnais de dev, il doit rester
   fonctionnel.

Règles :
- Commits conventionnels en français, découpés par étape logique (shared, main,
  preload, renderer, boot).
- Aucun renommage de canal, aucun changement de payload : le contrat CAPTURE
  l'existant, il ne le réforme pas. Les erreurs structurées viennent en phase 2.
- Après chaque étape : pnpm typecheck && pnpm test && pnpm build verts. Vérifie
  l'app réelle avec pnpm dev (ouvrir un dépôt, sélectionner un commit, un
  fetch) et le harnais mock (vite --config vite.preview.config.mjs).
- Si un constat de l'audit s'avère inexact, adapte-toi au code réel et note
  l'écart dans la PR.

À la fin : PR « refactor: phase 1 — contrat IPC partagé typé, main/preload en
TS strict (AUDIT.md §3) », description expliquant le contrat et listant les
garanties nouvelles (compilation croisée des 3 process). Surveille la CI.
```

---

## Phase 2 — Découpage du main, erreurs structurées, hygiène process, durcissement

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0. Sections clés : 1 (à
préserver), 2 (bugs B4 et « divers »), 4 (chantier main), 10 (plan). Les
phases 0 et 1 sont mergées : le contrat IPC typé existe dans src/shared/ et
main/preload sont en TS strict.

Ta mission : la Phase 2 — découper le main process, structurer les erreurs,
assainir la gestion des process enfants, durcir pour la 1.0. Pas de changement
côté renderer au-delà de l'adaptation aux erreurs structurées (l'état renderer
est la phase 3).

1. Découpe src/main/index.ts selon la structure cible d'AUDIT.md §4 :
   index.ts (~40 lignes de câblage), window.ts, security.ts, ipc.ts, state.ts,
   repos.ts, watcher.ts, scan.ts, git/{exec,parse,queries,ops,flow}.ts.
   Découpage à comportement constant — la logique bouge, elle ne change pas.
2. git/exec.ts (le spawn wrapper) gagne :
   - un AbortSignal de bout en bout (nouveau canal d'annulation dans le
     contrat : request-id côté renderer, kill de l'enfant côté main) ;
   - un timeout par défaut pour les lectures (~60 s ; aujourd'hui infini),
     escalade SIGTERM → SIGKILL après grâce ;
   - un plafond d'accumulation stdout (erreur ou marqueur de troncature) ;
   - l'émetteur de trace injecté en contexte (supprime le scan inverse
     path→tab et la référence au mainWindow global) ;
   - kill de tous les enfants d'un dépôt à closeRepo et à la fermeture.
3. Erreurs structurées (src/shared/errors.ts) : { code, detail } avec codes
   ('NOT_A_REPO', 'MERGE_CONFLICT', 'TIMEOUT', 'BAD_ARG'…), sérialisées
   proprement à travers l'IPC. Unifie l'API (openRepo retourne { error },
   le reste throw : choisis UNE convention). gitError conserve le code de
   sortie et inspecte stdout pour les opérations qui y écrivent leurs
   conflits (stash pop, merge). Le renderer localise les messages — les
   strings françaises sortent du main.
4. Hygiène : mutex de mutation par dépôt (la danse stash→checkout→pop court
   aujourd'hui sans verrou face à l'autofetch) ; écriture atomique de
   state.json (temp + rename) ; requestSingleInstanceLock + focus de la
   fenêtre existante ; garde de réentrance sur openRepo (Map<path, Promise>) ;
   récupération du watcher sur 'error' (recréation avec backoff) ; plafond de
   taille sur incidents.log.
5. Durcissement : fuses Electron (@electron/fuses : RunAsNode,
   EnableNodeCliInspectArguments, EnableNodeOptionsEnvironmentVariable off,
   OnlyLoadAppFromAsar + intégrité asar on) ; session.setPermissionRequestHandler
   deny-all + hook web-contents-created ; CSP prod complétée (object-src
   'none', base-uri 'none', form-action 'none') ; GG_DEBUG gated sur
   !app.isPackaged ; realpath des deux côtés dans inRepo (symlinks) ;
   blocklist d'extensions exécutables sur repo:openFile (ou
   showItemInFolder) avec le risque résiduel documenté en commentaire.
6. Tests : installe vitest (+ @vitest/coverage-v8). Les parsers extraits dans
   git/parse.ts (porcelain -z, name-status -z, for-each-ref, stash-list,
   gitError, la regex BRANCH, flowInfo) reçoivent de vrais tests unitaires.
   Migre mécaniquement les trois scripts scripts/check-*.ts en *.test.ts
   colocalisés (chaque bloc assert devient un it() ; importe les vraies
   constantes comme BUDGET au lieu de les redéclarer). "test": "vitest run".

Règles :
- Commits conventionnels français, un par module ou par thème (découpage,
  erreurs, hygiène, durcissement, tests).
- Comportement constant sauf les fixes listés : si un handler change de
  sémantique, c'est un bug de refactor.
- Après chaque étape : pnpm typecheck && pnpm test && pnpm build verts +
  vérification manuelle via pnpm dev (ouvrir, fetch, checkout, stash, fermer
  un onglet pendant un fetch → le process doit mourir).
- Écart entre audit et code réel → adapte et note dans la PR.

À la fin : PR « refactor: phase 2 — main découpé, erreurs structurées,
durcissement (AUDIT.md §4) ». Surveille la CI.
```

---

## Phase 3 — État renderer : couche requêtes + store par dépôt

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0. Sections clés : 1 (à
préserver), 2 (bug B5), 5 (chantier état renderer), 10 (plan). Les phases 0-2
sont mergées : contrat IPC typé dans src/shared/, main découpé avec erreurs
structurées et AbortSignal disponible.

Ta mission : la Phase 3 — remplacer la gestion d'état artisanale du renderer
par une couche requêtes + un store par dépôt, et réduire repo-view.tsx à un
layout. Ne touche PAS à l'intérieur du moteur de graphe (graph-canvas/
graph-layout, phase 4) ni à l'arborescence des dossiers (phase 5).

1. Ajoute @tanstack/react-query et zustand.
2. État serveur → TanStack Query, clés par dépôt : ['status', id],
   ['refs', id], ['worktree', id], ['flow', id], ['flowInfo', id, branch],
   ['files', id, hash, parent], ['body', id, hash], ['diff', …], avec
   placeholderData: keepPreviousData. Les mutations (commit, checkout, stash,
   branch, stage/unstage, ops réseau) invalident leurs clés ; les événements
   onChanged/onOp appellent invalidateQueries. Branche l'AbortSignal des
   queries sur le canal d'annulation posé en phase 2 (signal → kill du process
   git). Cette étape SUPPRIME : hooks/use-async.ts, le compteur refsGen et sa
   clé string, le bitmask de boot B_STATUS…B_ALL (remplacé par l'union pending
   des requêtes), et les 7 copies du flag `stale` (repo-view ×2, refs-sidebar,
   home-screen, diff-view, commit-search, use-async). Le bug B5 (statuts
   désordonnés) disparaît par construction.
3. État client → un store zustand par dépôt (createStore vanilla dans un
   <RepoProvider id>, un store par onglet ouvert) avec slices :
   - selection : clavée par HASH de commit (plus par index de ligne), actions
     reducer SELECT_ROW / SELECT_BRANCH / FOCUS_REF / CLEAR — l'invariant
     additif/soustractif (ctrl-clic) vit à un seul endroit. Après un reset du
     graphe, re-résous les lignes via graph.rowsOf(hashes) et restaure ce qui
     survit (aujourd'hui pull/checkout/stash effacent la sélection).
   - commitDraft : subject/description/amend (aujourd'hui hissés dans RepoView,
     ce qui re-rend tout l'arbre à chaque frappe).
   - ui : sidebarOpen, view, diff, diffMode.
   - ops : busyOp, opState avec timer auto-nettoyé.
   Le GraphHandle vit dans le store comme ref non réactive ; un abonné mince
   synchronise sélection → canvas.
4. RepoView redevient un layout de slots (~100 lignes) : bannière / sidebar /
   centre / panneau / statusbar. Les panneaux s'abonnent à leurs slices ; le
   prop drilling (10 props vers RefsSidebar, 14 vers WorktreePanel) disparaît.
   Le quatuor « op git → refresh → resetAndLoad → showOp » recopié 4 fois
   devient une action runGitAction() du store.
5. Les mesures du canvas (graphW/branchW) ne passent plus par du state React :
   le moteur écrit les propriétés CSS directement sur le conteneur. stats va
   au StatusBar par abonnement au store, pas à travers RepoView.
6. Navigation : remplace le sentinel HOME = 0 par une union discriminée
   { kind: "home" } | { kind: "repo"; id: RepoId } dans un petit store
   app/navigation (transitions open/select/close pures et testées). Conserve
   le keep-mounted + view-transitions existants.
7. Thème : un hook useTheme() sur useSyncExternalStore, consommé partout
   (tab-strip, diff-view) — supprime les copies locales.
8. ErrorBoundary par onglet (autour de RepoView) + autour de
   DetailPanel/DiffView, avec action « recharger l'onglet ».
9. Raccourcis clavier : un registre par onglet, scope-aware (diff ouvert >
   recherche focus > défaut), qui remplace les 5 listeners keydown globaux
   couplés par stopPropagation (App F5, RepoView Ctrl+B/Escape, CommitSearch
   Ctrl+F/F3, GitConsole Escape, refs-sidebar).

Règles :
- Commits conventionnels français par étape (query layer, store, RepoView,
  navigation, boundaries, raccourcis).
- Comportement visible identique : mêmes interactions, mêmes raccourcis, même
  persistance (sélection en mieux). Le harnais mock (vite --config
  vite.preview.config.mjs) est ton filet principal — vérifie : boot d'un
  onglet, sélection simple/ctrl/branche, frappe dans le sujet de commit (plus
  de re-rendu de la sidebar — vérifie avec React DevTools profiler si dispo),
  Escape/Ctrl+B/Ctrl+F, bascule de thème, fermeture/réouverture d'onglet.
- pnpm typecheck && pnpm test && pnpm build verts après chaque étape.
- Écart audit/code réel → adapte et note dans la PR.

À la fin : PR « refactor: phase 3 — couche requêtes + store par dépôt
(AUDIT.md §5) ». Surveille la CI.
```

---

## Phase 4 — Décomposition du moteur de graphe

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0. Sections clés : 1 (à
préserver — la liste « virtualisation / theming / shell React / flux de
sélection » te concerne directement), 2 (bug B1), 6 (chantier graphe), 10
(plan). Les phases 0-3 sont mergées : contrat IPC typé, main découpé, état
renderer sur query layer + store, sélection par hash.

Ta mission : la Phase 4 — corriger l'identité 32 bits, décomposer le moteur
de graphe en modules testables, et corriger les O(n²). Le moteur n'utilise pas
<canvas> malgré le nom du fichier : c'est un renderer SVG + DOM impératif.
Préserve absolument : la virtualisation deux étages (chunks + LRU épinglé), le
layout streaming append-only, le theming 100 % var() CSS, le shell React de
commit-graph.tsx, le flux « React possède la sélection ».

1. B1 — identité : le main envoie désormais les SHA COMPLETS (supprime les
   slice(0, 8) de src/main — log, stash, search, refs tips) ; côté renderer,
   un module ids.ts interne les hashs en ids entiers séquentiels
   (Map<string, number> à l'ingestion) qui remplacent hkey partout (rowOf,
   pending, matches, jumpTo). La troncature à 8 devient une affaire
   d'affichage. Ajuste le harnais mock (hashs complets).
2. Décompose selon la structure cible d'AUDIT.md §6 :
   constants.ts (ROW/LANE/CHUNK/PAGE/palette, grid-template et FIXED_W DÉRIVÉS
   des mêmes constantes — plus de re-somme à la main ; unifie LANES=10 vs
   MAX_LANES=12), layout/ (state, lanes, chains, collapse — PUR, exécutable
   sous Node, zéro DOM/px/CSS ; foldStashes déménage ici depuis le canvas),
   render/ (geometry, svg avec cache de markup par chunk, overlay, rows,
   measure), data/ (page-cache LRU testable sans DOM, loader), controller.ts,
   interactions/ (selection, hover, popover), react/commit-graph.tsx
   (inchangé). Renomme les fichiers pour refléter les couches (graph-canvas
   n'est pas du canvas).
3. chainInfo retourne des données structurées ({ refs, mergedInto, mergeHash }
   | { refs, merged: false }) — les strings françaises « mergée dans… »
   sortent du module d'algorithme, React formate.
4. Perfs :
   - overlay des arêtes longues : append incrémental (insertAdjacentHTML du
     delta) + bucketing par intervalle de lignes pour que sync() monte/démonte
     avec le viewport — fini le rebuild O(n²/PAGE) et l'overlay jamais
     virtualisé ;
   - hover : nouvelle fonction chainTip(S, i) O(montée) sans tableau — fini le
     branchChain jusqu'à la racine à chaque mouseover avec unshift quadratique ;
   - jumpTo/nextMatch : fetch groupé annulable (token) au lieu de la boucle
     page-à-page séquentielle awaitée ;
   - fenêtre de lignes HTML découplée de CHUNK (~2 hauteurs de viewport au
     lieu de 3 × 500 lignes montées) — CHUNK reste le bucket SVG ;
   - ResizeObserver sur le conteneur → sync() (aujourd'hui seul le scroll
     déclenche ; la recalibration ci-dessus rend ça obligatoire) ;
   - onStats throttlé à rAF ;
   - chunks paresseux dans layoutChunk ((S.nodes[ci] ??= []) — supprime le
     crash si le dépôt grandit entre total() et la pagination).
5. Les échecs de api.log ne sont plus muets : remonte un onError une fois vers
   l'UI (toast/showOp) au lieu du graphe éternellement court sans message.
   Unifie le pipeline d'ingestion fetchMore/ensureRows en un loadPage unique.
6. Tests vitest du layout (la raison d'être du découpage) :
   layout.lanes (allocation/réutilisation/continuité first-parent),
   layout.edges (résolution pending inter-chunks, bucketing edges vs long,
   dangling), layout.chains (porte les cas actuels de check-graph),
   collapse (cas capsules existants + paire inter-pages), geometry (snapshots
   edgePath), page-cache (LRU/pin/pageOfRow avec un faux api.log), plus UN
   test d'invariants sur fixture réelle (rejouer un log JSON enregistré :
   chaque arête résolue ou pending, rowOf bijectif — c'est lui qui verrouille
   B1, aucune lane doublée sur une ligne).

Règles :
- Commits conventionnels français par étape (ids, découpage, chainInfo, perfs,
  erreurs, tests).
- Le harnais mock est ton banc d'essai permanent (25k commits synthétiques) :
  scroll rapide, jump sur une vieille ref, recherche, sélection, resize de
  fenêtre, bascule de thème — tout doit être indistinguable d'avant (en mieux
  sur le scroll et le hover).
- pnpm typecheck && pnpm test && pnpm build verts après chaque étape.
- Écart audit/code réel → adapte et note dans la PR.

À la fin : PR « refactor: phase 4 — moteur de graphe décomposé, identité
plein-SHA, O(n²) corrigés (AUDIT.md §6) ». Surveille la CI.
```

---

## Phase 5 — Verticalité : feature folders et dédoublonnage

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0. Sections clés : 7
(chantier verticalité), 10 (plan). Les phases 0-4 sont mergées : contrat IPC
typé, main découpé, query layer + store par dépôt, moteur de graphe décomposé
sous features/graph/ (ou équivalent).

Ta mission : la Phase 5 — réorganiser le renderer en feature folders et
résorber la dette de duplication. C'est surtout du déplacement (git mv pour
préserver l'historique) : les phases 1-4 ont déjà fait le travail de fond.

1. Arborescence cible (AUDIT.md §7) :
   app/ (App layout + view transitions, navigation, boot, shortcuts,
   ErrorBoundary), lib/ (client ipc typé, query keys, theme, prefs, utils),
   features/{repo, graph, refs, worktree, stash, diff, search, flow, console,
   home}/, components/ui/ inchangé. Chaque feature colocalise composants +
   queries + actions. La feature stash — aujourd'hui étalée sur refs-sidebar,
   detail-panel, repo-view, graph — devient LE dossier « copie-moi » de
   référence : c'est le critère de réussite de la phase.
2. Découpe refs-sidebar.tsx (514 lignes = 5 modules qui cohabitent) : fetch,
   filtre, arbre, menus branche/stash, peinture des runs de focus. Passe les
   Collapsible en contrôlé (open piloté) : ça supprime les 3 variantes de
   remount-par-clé ET permet de calculer les « runs » en données au lieu du
   pass impératif querySelector/offsetParent/rAF (si le calcul en données
   s'avère trop coûteux, isole au moins le pass dans un module documenté).
3. Découpe lib/commit-message.ts (six métiers) : commit-parse.ts, markdown.ts,
   gitflow.ts ; fileStatusColor et BadgeColor remontent vers la couche UI
   (le sens de dépendance actuel est inversé). Centralise les conventions de
   branches (PINNED de refs-sidebar + MAIN_TARGETS de commit-message) en un
   seul module.
4. Dédoublonnage : buildTree générique lib/path-tree.ts (file-list +
   refs-sidebar) ; le helper item(label, cmd) défini deux fois dans
   refs-sidebar → un MenuItemWithCmd ; les 4 fabriques d'IconButton de
   worktree-panel → une seule ; l'en-tête de groupe copié-collé (refs vs
   stash) → un RefGroup ; le trio « <Spinner/> + texte » ×4 → un <AsyncHint> ;
   le style label-uppercase répété → une classe/composant unique ; les clés
   localStorage éparpillées → lib/prefs.ts typé.
5. Frontière du kit UI : components/ui/index.ts (ou re-exports pass-through)
   devient la seule surface d'import ; plus aucun import direct de
   ui/primitives/* hors de ui/ (la règle lint arrive en phase 6b, prépare-la).
   Supprime les morts : primitives/dialog.tsx (155 lignes, zéro import),
   primitives/kbd.tsx, primitives/badge.tsx doublonné, les tokens CSS
   --sidebar-*/--chart-*, --color-black et la règle CSS de la palette de
   commandes inexistante dans app.css.
6. Divers : renomme le type DiffView en DiffViewMode (collision avec le
   composant), le prop `console` de status-bar (shadowing), supprime
   l'indirection morte de detail-panel (const badge = …; return badge),
   déplace iconEl de lib/utils vers la feature graph, un seul canal
   graphRef/onReady au lieu des deux.

Règles :
- git mv systématique, commits conventionnels français par thème (structure,
  refs, lib, dédup, ui-kit, morts).
- ZÉRO changement de comportement : c'est la phase la plus mécanique, elle ne
  doit rien casser. Harnais mock + pnpm dev après chaque gros déplacement.
- pnpm typecheck && pnpm test && pnpm build verts après chaque commit.
- Écart audit/code réel → adapte et note dans la PR.

À la fin : PR « refactor: phase 5 — feature folders et dédoublonnage
(AUDIT.md §7) ». La description DOIT contenir le test de verticalité : le
walkthrough « ajouter un panneau X » en listant les points d'édition (dossier
feature + contrat partagé + handler main + slot RepoView). Surveille la CI.
```

---

## Phase 6a — Accessibilité

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0, section 8 (accessibilité)
et section 1 (les bons points a11y à préserver : commit-search, inert,
prefers-reduced-motion). Les phases 0-5 sont mergées : le code est organisé en
feature folders, le moteur de graphe est décomposé avec un module
interactions/.

Ta mission : la Phase 6a — amener l'app au niveau a11y attendu d'un OSS 1.0.
Référence de qualité interne : commit-search.tsx (aria-live, aria-pressed,
restauration de focus) — c'est la barre.

1. Le graphe devient opérable au clavier et lisible par lecteur d'écran :
   role="grid" (ou listbox/option) sur le board, roving tabindex sur les
   lignes, aria-selected, navigation ↑/↓/PageUp/PageDown/Home/End qui pilote
   la sélection À TRAVERS la virtualisation (via reveal — les lignes non
   montées doivent se monter au passage), Enter = sélection, Shift/Ctrl =
   additif, cohérent avec la souris. Les stats (« n/m commits ») passent en
   aria-live poli.
2. Le popover « +N » (refs cachées) devient togglable au clic et au clavier
   (Enter/Espace, Escape ferme, focus dedans) — aujourd'hui hover-only avec
   le clic explicitement avalé : les refs cachées sont inaccessibles sans
   souris. Envisage de le porter sur les primitives Base UI du kit plutôt que
   la machine à états maison (~80 lignes de floating-UI artisanal).
3. file-list : FileRow devient un vrai <button type="button"> (role, tabindex,
   clavier) — la liste de fichiers est une interaction cœur actuellement
   souris-only. L'ouverture dans l'OS gagne une entrée de menu contextuel
   (le ContextMenu du kit) en plus du double-clic. Supprime le délai de
   250 ms sur le simple clic : simple clic instantané, l'action rare passe au
   menu contextuel / double-clic sans pénaliser le cas chaud.
4. refs-sidebar : checkout des remotes/tags accessible au clavier (menu
   contextuel ou Enter), pas seulement au double-clic.
5. git-console : le popover fait main devient un vrai dialogue — role="dialog",
   aria-label, focus initial dedans, focus rendu à la fermeture, Escape —
   idéalement via la primitive Base UI du kit. Ajoute une région aria-live
   pour les lignes d'échec.
6. Vérifie au passage : chaque IconButton a un aria-label, les états busy sont
   annoncés (aria-busy ou live region), l'ordre de tabulation de RepoView est
   cohérent (toolbar → sidebar → graphe → panneau).

Règles :
- Commits conventionnels français par zone (graphe, popover, fichiers,
  sidebar, console).
- Teste au clavier UNIQUEMENT (souris interdite) le parcours complet : ouvrir
  un dépôt, naviguer le graphe, sélectionner, ouvrir le détail, ouvrir un
  diff, revenir, checkout une branche, commit. Harnais mock pour le graphe.
- Ne régresse aucune interaction souris existante ; préserve
  prefers-reduced-motion partout.
- pnpm typecheck && pnpm test && pnpm build verts.
- Écart audit/code réel → adapte et note dans la PR.

À la fin : PR « feat: phase 6a — accessibilité clavier et lecteurs d'écran
(AUDIT.md §8) » avec, en description, le parcours clavier de bout en bout
vérifié. Surveille la CI.
```

---

## Phase 6b — Open-source readiness

> ⚠️ Trois décisions à prendre AVANT de lancer cette session, à insérer dans le
> prompt : **la licence** (MIT / Apache-2.0), **le nom public** (git-graph vs
> Amont), **les plateformes** (Windows-only assumé vs cibles mac/linux).

```text
Lis d'abord AUDIT.md à la racine — l'audit pré-1.0, section 9 (open-source
readiness) et section 2 (les points privacy). Les phases 0-6a sont mergées.

Décisions déjà prises (fais-les respecter partout) :
- Licence : <LICENCE>
- Nom public : <NOM> (binaire, package, bridge window.*, préfixes CSS/data,
  appId, title — UN seul nom partout)
- Plateformes 1.0 : <PLATEFORMES>
- Langue : anglais intégral (code, commentaires, UI). L'app reste
  francophone-friendly via la locale système, pas via du français codé en dur.

Ta mission : la Phase 6b — tout ce qui manque pour publier.

1. La passe langue : traduis TOUS les commentaires en anglais (traduire, pas
   élaguer — ils encodent les vraies raisons des choix, c'est la valeur du
   code) ; extrais les strings UI dans un module de messages (même sans
   framework i18n complet) et traduis-les ; supprime les locales codées en
   dur (toLocaleString("fr") dans diff-view/git-console/status-bar →
   locale système) ; lang de index.html ; description/metadata package.json
   en anglais ; données du mock en anglais.
2. Scrub des données personnelles et conventions privées : l'email noreply
   GitHub réel dans mock.html → id fictif ; la table KNOWN d'avatar.ts
   (mapping personnel codé en dur) → supprimée ou config ; les tables de
   typos de l'ex-équipe dans commit-message/gitflow (HTOFIX, BUFGIXE,
   BACKUP_WIP) → config par dépôt ou suppression.
3. Privacy avatars : toggle de settings pour les requêtes
   gravatar/githubusercontent (monogramme sinon), mention claire dans le
   README. Profites-en pour remplacer sha256.ts artisanal par un avatarUrl
   async mémoïsé par email sur crypto.subtle (monogramme en attendant la
   résolution — le composant Avatar superpose déjà) et supprimer le test
   différentiel devenu inutile. Si la contrainte synchrone du graphe rend ça
   trop invasif, garde sha256.ts et documente pourquoi.
4. Lint/format : eslint.config.js flat (typescript-eslint
   recommended-type-checked, react-hooks — deux suppressions l'attendent
   déjà —, react-refresh, no-restricted-imports interdisant
   components/ui/primitives/* hors de ui/), Prettier + .editorconfig (tranche
   l'incohérence de style .mjs vs .ts), pnpm lint branché en CI. Corrige ce
   que le lint remonte.
5. Fichiers projet : LICENSE + champ license ; README.md (ce que c'est +
   captures — l'app est visuelle —, install depuis les releases, statut
   plateformes + avertissement SmartScreen binaires non signés, dev setup :
   pnpm dev / le harnais mock via un script "mock" ajouté à package.json /
   pnpm test, note privacy avatars, et TON avertissement « écrit par IA,
   qualité non garantie ») ; CONTRIBUTING.md (conventions ui/primitives, le
   choix assumé « tout en devDependencies » avec electron-vite/builder, le
   marqueur de dette ponytail: — documente-le ou renomme-le en NOTE(debt): —,
   harnais mock, process de release tag → draft → publish) ; SECURITY.md
   (frontière de confiance du rendu de diff via diff2html, posture CSP) ;
   templates issue/PR.
6. package.json : repository/bugs/homepage, engines.node (le README et la CI
   doivent matcher), .nvmrc, politique de versions cohérente (exact +
   lockfile), garde private: true (c'est une app).
7. CI : matrice ubuntu + windows (la cible release n'est jamais buildée hors
   jour de tag), concurrency avec cancel-in-progress, push restreint à la
   branche par défaut + pull_request, step lint. Renovate ou Dependabot
   (electron, diff2html, shiki en priorité). Release : --generate-notes ou
   changelog.
8. Bundle : shiki passe de l'import bundle complet à shiki/core + moteur
   regex JS (@shikijs/engine-javascript) + liste de langages explicite,
   chargé dynamiquement au premier diff ; supprime alors 'wasm-unsafe-eval'
   de la CSP de production.
9. Cohérence visuelle du nom : régénère l'icône si le nom/logo bouge, aligne
   le splash no-JS de index.html (troisième copie manuelle du Mark — ajoute
   les pointeurs « keep in sync » croisés), electron-builder.yml
   (productName, appId).

Règles :
- Commits conventionnels EN ANGLAIS à partir de cette phase (le dépôt devient
  public-facing) ; un commit par thème.
- La passe langue ne change AUCUN comportement — relis les diffs de
  commentaires pour vérifier qu'aucun code ne bouge en même temps.
- pnpm typecheck && pnpm test && pnpm build && pnpm lint verts ; vérifie le
  harnais mock et pnpm dev après la passe strings (les libellés bougent, pas
  les flux).
- Écart audit/code réel → adapte et note dans la PR.

À la fin : PR « chore: phase 6b — open-source readiness (AUDIT.md §9) » dont
la description contient la checklist P0/P1 de l'audit cochée. Surveille la CI.
```

---

## Après la phase 6b

Relire `AUDIT.md` une dernière fois en cochant chaque constat, faire une session
`/security-review` + `/code-review` sur l'ensemble, générer les captures du README,
puis tagger la 1.0.
