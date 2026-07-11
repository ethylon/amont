/* Surveillance de .git (AUDIT.md §4) : git ne notifie rien, on regarde bouger les seuls
   fichiers qui changent le graphe — HEAD (bascule), les refs locales, et `packed-refs` (gc,
   suppression de branche). L'index relève de l'arbre de travail, `objects/` n'est que du
   bruit, et `refs/remotes/` appartient au fetch, qui annonce déjà son résultat.

   Hors premier plan on retient l'événement au lieu de l'émettre : relire un dépôt que personne
   ne regarde ne sert à rien, et Windows ne suspend rien de lui-même.

   Récupération sur erreur (fix hygiène) : un `watch` qui échoue (volume démonté, ressources
   epuisées) fermait le watcher pour de bon — le dépôt restait muet jusqu'à la fermeture de
   l'onglet. On retente désormais avec un backoff, jusqu'à un plafond de tentatives.

   ponytail: dans un worktree lié, `--absolute-git-dir` pointe `.git/worktrees/<nom>` — HEAD y est,
   mais pas les refs. Surveiller aussi `--git-common-dir` le jour où le cas se présente. */

import { watch, type FSWatcher } from "node:fs"

const WATCH_DEBOUNCE = 300
const MUTE_MS = 1500
/* `refs/stash` et son reflog : un `git stash` lancé d'un terminal change le graphe. Un drop
   d'une entrée ancienne ne touche que `logs/refs/stash`, d'où la surveillance des deux. */
const WATCHED = /^(?:HEAD|packed-refs)$|^refs[\\/](?:heads|tags)[\\/]|^(?:logs[\\/])?refs[\\/]stash$/

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS = 30_000
const RETRY_CAP = 6 // au-delà, le dépôt reste sans watcher — le renderer garde le rafraîchissement manuel

export interface Watchable {
  gitDir: string
  running: string | null
  muted: number
  dirty: boolean
  watcher: FSWatcher | null
  watchRetries: number
  events: { changed(): void; isFocused(): boolean }
}

/* Nos propres commandes réveillent le watcher, alors que le renderer a déjà rechargé derrière
   elles. On ne sait pas distinguer ces événements des autres : on se tait un instant. */
export const mute = (r: Watchable): void => { r.muted = Date.now() + MUTE_MS }

export function watchGit(r: Watchable): void {
  let timer: NodeJS.Timeout | undefined
  const fire = () => {
    if (r.running || Date.now() < r.muted) return
    if (r.events.isFocused()) r.events.changed()
    else r.dirty = true
  }
  try {
    r.watcher = watch(r.gitDir, { recursive: true }, (_type, file) => {
      if (!file || file.endsWith(".lock") || !WATCHED.test(file)) return
      clearTimeout(timer)
      timer = setTimeout(fire, WATCH_DEBOUNCE)
    })
    r.watchRetries = 0
    r.watcher.on("error", () => {
      r.watcher = null
      if (r.watchRetries >= RETRY_CAP) return // au-delà : silence définitif, sans bruit
      const delay = Math.min(RETRY_BASE_MS * 2 ** r.watchRetries, RETRY_MAX_MS)
      r.watchRetries++
      setTimeout(() => watchGit(r), delay)
    })
  } catch {
    /* pas de watcher au premier essai (dossier déjà parti) : l'app reste utilisable, le
       rafraîchissement redevient manuel — pas de retente ici, rien n'a pu s'abonner */
  }
}
