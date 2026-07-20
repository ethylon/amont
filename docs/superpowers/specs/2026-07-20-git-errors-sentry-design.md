# Remontée Sentry des erreurs git non bloquantes

Date : 2026-07-20 · Statut : validé (brainstorm) · Périmètre : main process (+ filet IPC couvrant le renderer)

## Contexte

Une cinquantaine de sites avalent des erreurs (`.catch(() => fallback)`, `catch {}`). La plupart
sont des fallbacks **attendus** (« la ref n'existe pas » est une réponse, pas une erreur), mais
plusieurs échecs **anormaux tolérés** dégradent l'app en silence : personne — ni l'utilisateur,
ni le mainteneur — n'en entend parler. Sentry est déjà branché en main process
(`src/main/telemetry.ts` : scrub PII, opt-out live, DSN uniquement sur les builds officiels),
avec un précédent de capture manuelle structurée (`captureRendererGone`).

## Objectif

Modèle hiérarchisé à deux étages :

1. **Breadcrumbs** : chaque échec de commande git laisse un breadcrumb Sentry (contexte gratuit
   attaché à tout événement futur, crash compris). Aucun événement en soi.
2. **Événements ciblés** : les échecs anormaux — avalés (catégorie 2), traversant l'IPC avec un
   code inattendu (3a + 4), ou d'opérations `runOp` (3b) — deviennent des événements Sentry
   fingerprintés, dédupliqués par session, au payload assaini.

## Non-objectifs

- **`updater.ts`** : hors périmètre. Le code décide déjà explicitement « Rien vers Sentry — un
  poste hors ligne n'est pas un bug ». Décision respectée.
- **`state.ts`** (state.json corrompu) : non couvrable — le chargement précède
  `applyTelemetryOptOut()`, `enabled` vaut encore `false`, `beforeSend` dropperait l'événement.
- **Échecs renderer purement locaux** (shiki, avatars, customization) : pas des erreurs git ;
  les avatars sont du bruit réseau. Le renderer n'est pas modifié du tout.
- **Codes métier** montrés à l'utilisateur (`MERGE_CONFLICT`, `NO_UPSTREAM`, `DIVERGED`,
  `NOT_A_REPO`, `BUSY`, `STASH_POP_CONFLICT`, `NOT_FLOW_BRANCH`, `EXISTS`, `NO_REPO`,
  `NOT_ALLOWED`) et `ABORTED` (annulation) : jamais capturés.
- Pas de métriques/perf tracing, pas de log local nouveau : Sentry uniquement.

## Architecture

### Nouveau module pur : `src/main/git/telemetry-scrub.ts`

Fonctions pures, zéro import Electron, testables sous Node (même veine que `parse.ts`) :

- `sanitizeDetail(detail: string): string` — le scrubber (règles ci-dessous) ;
- `gitVerb(args: string[]): string` — premier token de l'argv, plus le second uniquement s'il
  appartient à une whitelist de sous-commandes à deux mots (`stash pop`, `stash push`,
  `config --unset`, `worktree list`, …) — jamais un argument utilisateur ;
- `isNetworkNoise(detail: string): boolean` — motifs environnementaux (`Could not resolve
  host`, `unable to access`, `Connection timed out/refused`, `Could not read from remote
  repository`, `no route to host`, …) ;
- dédup par session : `shouldSend(scope, code): boolean` (première occurrence d'un couple →
  `true`, suivantes → `false` ; reset exposé pour les tests).

### Extensions de `src/main/telemetry.ts`

Même style et mêmes garanties que `captureRendererGone` (no-op sans DSN, `beforeSend` existant
→ opt-out et scrub PII respectés sans travail supplémentaire) :

- `captureGitError(scope: string, err: unknown, extra?)` — décode via `decodeError`, applique
  la dédup session, construit l'événement :
  - message `git: <scope> [<code>]`, fingerprint `[scope, code]` (une issue par site×code) ;
  - level `warning` (échec avalé, l'app a continué) ou `error` (filet IPC, l'utilisateur a vu
    l'échec) — paramétrable, défaut `warning` ;
  - tags `{ scope, code }` ; contexts `git_error` :
    `{ verb?, exit_code?, detail: sanitizeDetail(...), duration_ms?, auto? }`.
- `addGitBreadcrumb(info: { verb: string; code: ErrorCode; exitCode: number | null; ms: number })`
  — breadcrumb `category: "git"`, level `warning`, message `<verb> failed: <code>`. Aucun
  argument ni chemin, le verbe seul.

### Les quatre points de branchement

1. **`exec.ts` — breadcrumbs automatiques.** Le runner reste pur : pas d'import de
   `telemetry.ts` (qui tire Electron). Nouveau hook `onFailure?: (info) => void` dans
   `RunnerContext`, appelé sur chaque rejet de `git()`, `gitBuffer()` et `diffNoIndex()`
   (y compris les échecs ensuite avalés par l'appelant). `repos.ts` câble le hook vers `addGitBreadcrumb` pour les
   deux runners qu'il construit (probe et runner tracé). Vérifier à l'implémentation si
   `create.ts` (init/clone) passe par `createGitRunner` et câbler pareil le cas échéant.
2. **Sites catégorie 2 — capture explicite** (liste ci-dessous). Convention de lecture :
   un catch nu = fallback attendu ; un catch avec `captureGitError` = anomalie tolérée.
3. **Registrar IPC (`ipc.ts`, wrapper `handle`) — filet main-side.** try/catch autour de
   `fn(...)` : si `decodeError(e).code` ∈ ensemble « inattendu », `captureGitError`
   (`scope = "ipc.<channel>"`, level `error`) puis re-throw à l'identique. Couvre d'un coup les
   erreurs affichées (toasts) et celles que le renderer avale (`stashes() → []`,
   `worktrees() → []`, `headMessage → null`) : la capture a lieu à la frontière, avant que le
   renderer décide du sort de l'erreur.
4. **`runOp` (`ops.ts`) — fetch/pull/push, manuels et auto.** Ces échecs partent en événement
   `state: "error"`, jamais par l'IPC : capture dans les deux chemins d'erreur de `runOp`
   (catch interne et `.catch` du `withLock`), `scope = "op.<name>"`, garde réseau ci-dessous.

## Ensemble « inattendu » (filet IPC)

`GIT_FAILED`, `UNKNOWN`, `OUTPUT_LIMIT`, `BAD_ARG` (si ça traverse l'IPC, c'est un bug du
renderer — rare et à haut signal), `TIMEOUT`. Tous les autres codes : exclus (cf. Non-objectifs).

## Scrubber (`sanitizeDetail`)

Appliqué au `detail` de l'`AppError` (ligne `fatal:`/`error:` de git). Dans l'ordre :

1. Première ligne uniquement (élimine les listes de fichiers multi-lignes) ;
2. URLs (credentials compris) → `<url>` ; motif `host: xxx` → `host: <host>` ;
3. Chemins absolus unix, Windows (`C:\`), UNC (`\\`), `~` → `<path>` ;
4. Emails → `<email>` ; runs hexadécimaux de 7 à 40 chars → `<sha>` (améliore aussi le
   groupement des issues) ;
5. Tokens entre quotes simples ou doubles (branches, fichiers, pathspecs) → `'<ref>'` ;
6. Troncature à 300 caractères.

Le diagnostic repose sur `scope + code + verb + forme de la phrase git` ; aucune donnée
utilisateur (chemin, branche, URL, email) ne part.

## Anti-bruit

- **Dédup par session** : un couple `scope+code` n'envoie qu'un événement par lancement
  d'app ; les occurrences suivantes ne laissent que leur breadcrumb. La fréquence
  inter-sessions/utilisateurs reste lisible dans Sentry (compteur d'events par issue).
- **Garde réseau (`runOp` uniquement)** : pas de capture si `!net.isOnline()` (Electron), ni
  si `isNetworkNoise(detail)`, ni pour `TIMEOUT` sur `fetch`/`pull`/`push` (connexion lente ≠
  bug). Un échec non réseau (repo corrompu, config cassée) part, lui.
- L'opt-out utilisateur et l'absence de DSN court-circuitent tout (mécanisme existant).

## Sites de capture explicite (catégorie 2)

| Site (repère actuel) | Scope | Level | Note |
| --- | --- | --- | --- |
| `ops.ts:227` (pop de secours après checkout raté) | `checkout.recovery-pop` | warning | Stash orphelin : adjacent à de la perte de données. Le checkout reste l'erreur surfacée (comportement inchangé). |
| `flow.ts:222/276/312` (`config --unset` base) | `flow.unset-base` | warning | Ajouter `okCodes: [5]` (clé absente = attendu, exit 5) pour ne capturer que les vrais échecs (lock, droits). |
| `merge-preview.ts:65` (`merge-tree` → `null`) | `merge-preview` | warning | Détecte aussi un git < 2.38 : preview morte en silence pour l'utilisateur. |
| `watcher.ts:117` (abandon après `RETRY_CAP`) | `watcher.retries-exhausted` | warning | `captureMessage` (pas d'`AppError` ici) : dégradation permanente, plus de refresh auto. |
| `watcher.ts:143` (échec du watch racine) | `watcher.subscribe` | warning | Uniquement quand le repo vient de s'ouvrir avec succès (le gitDir existait un instant avant) ; un repo supprimé en cours de route ne doit pas spammer — la dédup borne de toute façon. |
| `packs.ts:88` (`index-pack` rejette → pack supprimé) | `maintenance.pack-unrecoverable` | warning | Recovery destructif : mérite une trace. |

Tous les autres catch silencieux du dépôt (~44) sont des fallbacks attendus et restent nus —
notamment `queries.ts` (probes `rev-parse`/`for-each-ref`/reflog, `blob()`), `repos.ts`
(probe `NOT_A_REPO`, realpath), `watcher.ts:90` (`graphKey` d'un repo fermé, documenté),
`flow.ts:29`, `scan.ts`, `window.ts`, `state.ts`.

## Tests

Unitaires (vitest, module pur, même approche que `parse.test.ts`) :

- `sanitizeDetail` : chemins unix/Windows/UNC/`~`, URL avec credentials, `host:`, email, sha,
  quotes simples/doubles, multi-ligne → première ligne, troncature, chaîne déjà propre
  inchangée ;
- `gitVerb` : verbe simple, sous-commande whitelistée, argument jamais retenu (sha, chemin,
  branche en 2e position) ;
- `isNetworkNoise` : chaque motif, et un `fatal:` non réseau → `false` ;
- dédup : premier envoi passe, répétition bloquée, couple différent passe, reset.

Le câblage Sentry lui-même (`captureGitError`/`addGitBreadcrumb`) n'est pas testé, comme
`captureRendererGone` aujourd'hui. Optionnel : smoke test du hook `onFailure` d'`exec.ts`
(commande git vouée à l'échec, assertion que le hook reçoit code/exit/ms).

## Notes d'implémentation

- Le filet IPC re-throw l'erreur **inchangée** : le contrat renderer (toasts, `decodeError`)
  ne bouge pas d'un octet.
- `runOp` : la capture s'ajoute aux deux chemins d'erreur existants sans en modifier les
  événements sortants.
- `exec.ts` transmet au hook : `verb` (via `gitVerb`), `code` et `detail` de l'`AppError`
  classifiée, `exitCode`, `ms`. Le breadcrumb n'utilise pas `detail` ; seul `captureGitError`
  le fait, après scrub.
- Vérifier que `classifyGitFailure` produit bien un `detail` mono-ligne court ; le scrubber
  re-tronque de toute façon.
