# Plan d'implémentation — Remontée Sentry des erreurs git non bloquantes

Spec : `docs/superpowers/specs/2026-07-20-git-errors-sentry-design.md` · Branche : `claude/git-errors-logging-2ctqio`

Chaque étape est committable seule, typecheck et tests verts. Vérification par étape :
`pnpm typecheck && pnpm test` (lint en fin de chantier : `pnpm lint`).

## Écarts assumés par rapport au spec (raffinements, pas des changements de design)

- **watcher** : on capture la vraie erreur du `FSWatcher` (EMFILE, EPERM…) via `captureGitError`
  au lieu d'un `captureMessage` sec — le fingerprint reste `[scope, code]`, le signal est
  meilleur (le message fs part dans `detail`, assaini).
- **`exec.ts` et `packs.ts` n'importent pas `telemetry.ts`** (qui tire Electron) : hook
  `onFailure` injecté via `RunnerContext`, callback `onUnrecoverable` injecté via `PackSweep` —
  même motif que `trace`/`log` déjà injectés. Les deux modules restent purs Node.
- **La garde réseau vit dans `telemetry.ts`** (`captureOpError`) et pas dans `ops.ts` :
  `ops.ts` reste sans import Electron, la politique de bruit reste avec la télémétrie.
- **`create.ts` est câblé** (résolu : il construit ses runners via `createGitRunner`, ligne 43).
- **`classifyGitFailure` produit déjà un `detail` mono-ligne** (jointure « — » de 2 lignes
  `fatal:` max + suffixe exit) : la règle « première ligne » du scrubber n'est qu'un filet.

## Étape 1 — Module pur `telemetry-scrub.ts` + tests

**Nouveau** `src/main/git/telemetry-scrub.ts` (zéro import, comme `parse.ts`) :

- `gitVerb(args: string[]): string` — `args[0]`, plus `args[1]` seulement si présent dans
  `SUBVERBS`, la whitelist littérale des seconds tokens qui précisent l'opération :
  `pop`, `push`, `list`, `show`, `blob`, `--unset`, `--get-regexp`, `--write-tree`… Jamais
  de second token hors liste : un sha, un chemin ou une branche ne peuvent pas fuiter.
- `sanitizeDetail(detail: string): string` — pipeline dans cet ordre :
  1. `split("\n")[0]`
  2. URLs (`[a-z]+://…`, credentials compris) → `<url>` ; `host: xxx` → `host: <host>`
  3. chemins absolus unix (`/…`), Windows (`X:\…` et `X:/…`), UNC (`\\…`), tilde (`~/…`) → `<path>`
  4. emails → `<email>` ; runs hex `[0-9a-f]{7,40}` en mot entier → `<sha>`
  5. contenus entre quotes simples ou doubles → `'<ref>'`
  6. `.slice(0, 300)`
- `isNetworkNoise(detail: string): boolean` — teste (insensible à la casse) :
  `could not resolve host`, `unable to access`, `connection timed out`, `connection refused`,
  `could not read from remote repository`, `no route to host`, `network is unreachable`,
  `operation timed out`, `early eof`, `the remote end hung up`.
- Dédup session : `shouldSend(scope: string, code: string): boolean` sur un `Set` module-level
  (`scope\0code`), + `resetDedupForTests()`.

**Nouveau** `src/main/git/telemetry-scrub.test.ts` (écrit en premier, style `parse.test.ts`) :

- `gitVerb` : `["status","--porcelain"]` → `status` ; `["stash","pop"]` → `stash pop` ;
  `["rev-parse","abc123…"]` → `rev-parse` (jamais le sha) ; `["config","--unset","gitflow…"]`
  → `config --unset` ; `["checkout","ma-branche"]` → `checkout`.
- `sanitizeDetail` : chemin unix/Windows/UNC/`~` ; URL `https://user:token@host/repo.git` →
  `<url>` (aucun fragment du token ne survit) ; email ; sha court (7) et long (40) ; quotes
  simples et doubles ; multi-ligne → première ligne seule ; troncature > 300 ; message déjà
  propre (`bad revision (exit 128)`) inchangé hors placeholders.
- `isNetworkNoise` : chaque motif → `true` ; `bad object`, `could not lock config file` → `false`.
- dédup : 1er envoi `true`, répétition `false`, couple différent `true`, `resetDedupForTests`.

Done : `pnpm typecheck && pnpm test` verts. Commit : `feat(telemetry): scrubber pur + verbe git + dédup session`.

## Étape 2 — `telemetry.ts` : les quatre fonctions de capture

Dans `src/main/telemetry.ts`, sous `captureRendererGone`, même style :

```ts
import { net } from "electron" // en tête, à côté de `app`
import { decodeError, type ErrorCode } from "../shared/errors.ts"
import { gitVerb, isNetworkNoise, sanitizeDetail, shouldSend } from "./git/telemetry-scrub.ts"

export interface GitFailureInfo {
  verb: string
  code: ErrorCode
  exitCode: number | null
  ms: number
}

/** Breadcrumb runner : verbe seul, jamais d'args ni de detail. */
export function addGitBreadcrumb(info: GitFailureInfo): void {
  if (!Sentry || !enabled) return
  Sentry.addBreadcrumb({
    category: "git",
    level: "warning",
    message: `${info.verb} failed: ${info.code}`,
    data: { code: info.code, exit_code: info.exitCode, duration_ms: info.ms },
  })
}

/** Événement ciblé : fingerprint [scope, code], detail assaini, dédup session. */
export function captureGitError(
  scope: string,
  err: unknown,
  extra?: { level?: "warning" | "error"; verb?: string; auto?: boolean }
): void {
  if (!Sentry || !enabled) return
  const { code, detail } = decodeError(err)
  if (!shouldSend(scope, code)) return
  Sentry.captureMessage(`git: ${scope} [${code}]`, {
    level: extra?.level ?? "warning",
    fingerprint: [scope, code],
    tags: { scope, code },
    contexts: {
      git_error: {
        code,
        verb: extra?.verb,
        detail: detail ? sanitizeDetail(detail) : undefined,
        auto: extra?.auto,
      },
    },
  })
}

const UNEXPECTED: ReadonlySet<string> = new Set([
  "GIT_FAILED",
  "UNKNOWN",
  "OUTPUT_LIMIT",
  "BAD_ARG",
  "TIMEOUT",
])

/** Filet IPC : codes inattendus uniquement, level error (l'utilisateur a vu l'échec). */
export function captureIpcError(channel: string, err: unknown): void {
  if (!UNEXPECTED.has(decodeError(err).code)) return
  captureGitError(`ipc.${channel}`, err, { level: "error" })
}

/** runOp (fetch/pull/push) : gardes anti-bruit réseau, puis capture. */
export function captureOpError(op: string, err: unknown, auto: boolean): void {
  const { code, detail } = decodeError(err)
  if (!UNEXPECTED.has(code)) return
  if (code === "TIMEOUT") return // les 3 ops runOp sont réseau
  if (!net.isOnline()) return
  if (detail && isNetworkNoise(detail)) return
  captureGitError(`op.${op}`, err, { auto })
}
```

Note : `gitVerb` n'est pas encore consommé ici (il l'est par l'étape 3 via exec) — l'import
n'arrive qu'avec son premier usage réel pour garder chaque commit lint-propre.

Done : typecheck vert (fonctions encore non appelées). Commit : `feat(telemetry): captureGitError/addGitBreadcrumb + filets IPC et runOp`.

## Étape 3 — Hook `onFailure` dans `exec.ts`, câblage `repos.ts` + `create.ts`

`src/main/git/exec.ts` :

- `RunnerContext` gagne `onFailure?: (info: { verb: string; code: ErrorCode; exitCode: number | null; ms: number }) => void`
  (type local ou importé de `shared/errors.ts` pour `ErrorCode` — pas d'import telemetry).
- `git()` : appeler `ctx.onFailure?.({ verb: gitVerb(args), code: failure.code, exitCode, ms })`
  aux trois points de rejet (`child.on("error")`, close killedBy, close exit≠0). `gitVerb`
  s'importe depuis `telemetry-scrub.ts` (pur → pas de dette).
- `gitBuffer()` : ajouter `const started = Date.now()` ; hook sur son chemin d'erreur
  (OUTPUT_LIMIT, TIMEOUT via `killed`, classify sinon).
- `diffNoIndex()` : idem sur ses deux rejets (OUTPUT_LIMIT, TIMEOUT), verbe littéral `"diff --no-index"`.

`src/main/repos.ts` : dans `createRepo`, les deux `createGitRunner` (probe ligne ~212, runner
ligne ~223) reçoivent `onFailure: addGitBreadcrumb` (import depuis `./telemetry.ts`).

`src/main/create.ts` : `const runner = (dir) => createGitRunner({ path: dir, children, onFailure: addGitBreadcrumb })`.

Done : typecheck vert ; comportement runtime inchangé hors breadcrumbs. Commit :
`feat(git): breadcrumb Sentry sur chaque échec de commande (hook onFailure injecté)`.

## Étape 4 — Filet IPC dans le registrar

`src/main/ipc.ts`, wrapper `handle` (ligne ~39) — le callback devient async pour attraper
rejets ET throws synchrones, re-throw à l'identique (contrat renderer intact, la vérification
sender continue de throw avant le try) :

```ts
ipcMain.handle(channel, async (event, ...args) => {
  if (event.sender !== getMainWindow()?.webContents)
    throw new AppError("NOT_ALLOWED", "unexpected sender")
  try {
    return await fn(event, ...(args as Parameters<InvokeChannels[K]>))
  } catch (e) {
    captureIpcError(channel, e)
    throw e
  }
})
```

Done : typecheck vert + vérif manuelle rapide qu'un code métier (ex. `NOT_A_REPO` en ouvrant
un dossier non-repo) traverse toujours pareil. Commit : `feat(ipc): capture Sentry des codes
d'erreur inattendus à la frontière`.

## Étape 5 — `runOp` (fetch/pull/push, auto et manuels)

`src/main/git/ops.ts`, `runOp` (~ligne 102) : ajouter `captureOpError(name, e, auto)` dans les
deux chemins d'erreur existants (le `catch` interne et le `.catch` du `withLock`), juste avant
l'émission de l'événement `state: "error"` inchangé.

Done : typecheck vert. Commit : `feat(ops): capture Sentry des échecs runOp non réseau`.

## Étape 6 — Les six sites explicites (catégorie 2)

1. **`ops.ts` `checkoutWithStash` (~227)** — le pop de secours :
   `.catch((e) => captureGitError("checkout.recovery-pop", e))` ; le throw du checkout
   d'origine reste l'erreur surfacée.
2. **`flow.ts` ×3 (~222/276/312)** — `config --unset` :
   `r.git(["config", "--unset", key], { okCodes: [5] }).catch((e) => captureGitError("flow.unset-base", e))`
   (exit 5 = clé absente = succès silencieux ; le catch ne voit plus que les vrais échecs —
   lock, droits). Factoriser les trois en un petit helper local `unsetFlowBase(r, branch)`.
3. **`merge-preview.ts` (~65)** :
   `.then(parseMergeTree, (e) => { captureGitError("merge-preview", e); return null })` —
   détecte notamment git < 2.38 (preview morte en silence).
4. **`watcher.ts` `onError`/retries (~113-124)** — `onError` reçoit désormais l'erreur du
   `FSWatcher` (`w.on("error", onError)` la passe déjà) ; au point d'abandon
   (`watchRetries >= RETRY_CAP`) : `captureGitError("watcher.retries-exhausted", err)`.
5. **`watcher.ts` échec du watch racine (~143-148)** — dans `add`, remonter l'erreur du
   `catch` (retourner `null` mais la garder) ; au `if (!root)` : `captureGitError("watcher.subscribe", err)`.
   Implémentation simple : `add` prend un paramètre out optionnel ou devient
   `addWithErr(): { w: FSWatcher | null; err?: unknown }` pour le seul appel racine.
6. **`packs.ts` (~88)** — `PackSweep` gagne `onUnrecoverable?: (err: unknown, pack: string) => void`,
   appelé dans le catch d'`index-pack` avant le `rm` ; `maintenance.ts` (constructeur du
   `PackSweep`) le câble sur `(e) => captureGitError("maintenance.pack-unrecoverable", e)`.

Done : typecheck + tests verts. Commit : `feat(git): capture Sentry des échecs tolérés anormaux (6 sites)`.

## Étape 7 — Vérifications finales

1. `pnpm typecheck && pnpm lint && pnpm test` — tout vert.
2. Relecture : aucun autre `.catch` transformé, les ~44 fallbacks attendus restent nus.
3. Smoke test manuel (optionnel, nécessite un DSN de test) :
   `MAIN_VITE_SENTRY_DSN=<dsn-test> pnpm dev`, ouvrir un repo, couper le réseau et lancer un
   fetch manuel (attendu : AUCUN événement, garde réseau) ; provoquer un `GIT_FAILED` réel
   (ex. corrompre un ref) et vérifier l'événement unique + breadcrumbs + payload sans chemin.
4. Push et point d'étape.

## Hors périmètre (rappel spec)

`updater.ts` (décision existante dans le code), `state.ts` (ordre d'init), renderer local,
codes métier, `ABORTED`. Aucune chaîne utilisateur nouvelle → pas d'i18n. Aucun changement
de contrat IPC → pas de modif preload/renderer.
