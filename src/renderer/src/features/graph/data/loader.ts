/* Pipeline d'ingestion (AUDIT.md §6) : un seul point d'entrée, `ingest`, que `fetchMore` (page
   suivante), `ensureRows` (regarnir des pages évincées) et `growUntil` (sauts par lots) partagent
   — avant ce module, `fetchMore`/`ensureRows` dupliquaient la même logique de repli
   (`collapsePairs`/`foldStashes`), validation et pose en page. Possède l'état de layout (`S`) et
   le cache de pages : le contrôleur (render/interactions) les lit, il ne les mute jamais
   directement — l'éviction elle-même reste pilotée depuis le contrôleur (`evict`), seul à
   connaître le viewport et la sélection courants.

   Erreurs : un échec d'`api.log` n'est plus muet (item perf/erreurs) — `onError` est remonté une
   fois par épisode de panne, pas à chaque retry (le scroll/sync relance sans arrêt tant que rien
   n'arrive). `jumpTo`/`rowsOf`/`nextMatch` chargent par lots concurrents et annulables (token) au
   lieu d'attendre une page à la fois : sur un saut lointain (vieille ref), les allers-retours IPC
   se recouvrent plutôt que de s'enchaîner. */

import type { Commit, Stash } from "../../../../../shared/types.ts"
import type { RepoApi } from "@/lib/git"
import { collapsePairs, foldStashes } from "../layout/collapse.ts"
import { layoutChunk } from "../layout/lanes.ts"
import { createState, type LayoutState } from "../layout/state.ts"
import { idOf } from "../ids.ts"
import { createPageCache, type PageCache } from "./page-cache.ts"

/** pages concurrentes par lot lors d'un saut lointain (jumpTo/nextMatch) — au-delà, la
    concurrence n'apporte plus rien (limite pratique du nombre d'IPC/process git en vol) */
const JUMP_BATCH = 4

export interface LoaderOptions {
  api: RepoApi
  pageSize: number
  resident: number
  /** une page neuve (ou regarnie) vient d'être posée — le contrôleur y scanne les largeurs de
      colonnes et déclenche son propre `refresh()`/`sync()` */
  onPageLoaded?(commits: Commit[]): void
  /** un `api.log` a échoué — remonté une fois par épisode de panne, jamais en silence */
  onError?(err: unknown): void
}

export function createLoader(opts: LoaderOptions) {
  const { api, pageSize, resident } = opts
  const pageCache: PageCache = createPageCache(resident)
  let S: LayoutState = createState()
  let TOTAL = 0
  let exhausted = false
  let fetching: Promise<Commit[] | null> | null = null
  const refetching = new Map<number, Promise<boolean>>()
  let gen = 0 // invalide les fetchs en vol après un reset/destroy
  let stashOf = new Map<string, string>()
  let plumbing = new Set<string>()
  let errorReported = false

  function reportError(err: unknown) {
    if (errorReported) return
    errorReported = true
    opts.onError?.(err)
  }

  function applyPage(rowStart: number, commits: Commit[]): void {
    const end = rowStart + commits.length
    while (S.next < end) layoutChunk(S, (r) => commits[r - rowStart], end)
  }

  /** Point d'entrée unique : pose en page une page BRUTE déjà reçue de `api.log`, neuve
      (`isNew`, avance le cache) ou regarnissage d'une page évincée (revalidée contre l'état de
      layout existant — un dépôt qui a bougé sous la page ne monte rien de faux). Ne décide
      jamais seul de l'éviction : elle dépend du viewport et de la sélection, que seul le
      contrôleur connaît — c'est lui qui rappelle `evict()` après coup. */
  function ingest(pi: number, raw: Commit[], isNew: boolean): Commit[] | null {
    const commits = collapsePairs(foldStashes(raw, stashOf, plumbing))
    if (isNew) {
      const rowStart = S.next
      pageCache.appendPage(rowStart, commits)
      applyPage(rowStart, commits)
      if (raw.length < pageSize) exhausted = true
      /* le total du serveur ignore les capsules du collapse (deux merges → une ligne) : à
         l'épuisement de l'historique, le compte réel de lignes fait foi */
      if (exhausted) TOTAL = S.next
      errorReported = false // une page arrivée referme l'épisode de panne précédent
      return commits
    }
    const rowStart = pageCache.pageRowStart(pi)
    const len = (pageCache.nextPageRowStart(pi) ?? S.next) - (rowStart ?? 0)
    if (rowStart === undefined || commits.length < len || idOf(S.ids, commits[0].h) !== S.hashOf[rowStart]) return null
    pageCache.refill(pi, commits)
    errorReported = false
    return commits
  }

  /** Ne rejette jamais : un `git log` qui échoue (timeout, verrou de gc) laisse le cache en
      l'état et libère `fetching` pour que le prochain déclencheur retente. */
  function fetchMore(): Promise<Commit[] | null> {
    if (exhausted) return Promise.resolve(null)
    if (!fetching) {
      const g = gen
      const pi = pageCache.pageCount
      fetching = api.log(pi * pageSize, pageSize).then(
        (raw) => {
          fetching = null
          if (g !== gen) return null // reset entre-temps : page obsolète
          const commits = ingest(pi, raw, true)
          if (commits) opts.onPageLoaded?.(commits)
          return commits
        },
        (err) => {
          fetching = null
          if (g === gen) reportError(err)
          return null
        }
      )
    }
    return fetching
  }

  /** `fetchMore` avec détection de panne : `false` si rien n'est arrivé (échec de la page). */
  async function fetchProgress(): Promise<boolean> {
    const before = S.next
    await fetchMore()
    return exhausted || S.next > before
  }

  /** Recharge les pages évincées couvrant [r0, r1]. Le repli et le collapse sont déterministes
      par page brute : la page revient identique, on ne fait que regarnir les textes. */
  async function ensureRows(r0: number, r1: number): Promise<boolean> {
    let ok = true
    /* séquentiel : un `pin` de segment étalé ne doit pas lancer des dizaines de git en parallèle */
    for (let pi = pageCache.pageOfRow(r0), last = pageCache.pageOfRow(r1); pi <= last; pi++) {
      pageCache.touch(pi)
      if (pageCache.has(pi)) continue
      let p = refetching.get(pi)
      if (!p) {
        const g = gen
        p = api.log(pi * pageSize, pageSize).then(
          (raw) => {
            refetching.delete(pi)
            if (g !== gen) return false
            return !!ingest(pi, raw, false)
          },
          (err) => {
            refetching.delete(pi)
            if (g === gen) reportError(err)
            return false
          }
        )
        refetching.set(pi, p)
      }
      ok = (await p) && ok
    }
    return ok
  }

  /** Charge par lots concurrents jusqu'à ce que `done()` devienne vrai, l'historique s'épuise, ou
      qu'un reset/destroy périme cet appel (`token`). Remplace la boucle séquentielle
      page-à-page (un aller-retour IPC à la fois) par des lots de `JUMP_BATCH` pages en vol —
      leur application au layout reste dans l'ordre de la requête, jamais celui de la résolution
      réseau (l'allocation de lanes est un automate à état, il ne tolère pas le désordre). */
  async function growUntil(done: () => boolean, token: number): Promise<void> {
    while (!done() && !exhausted && token === gen) {
      const from = pageCache.pageCount
      const pis = Array.from({ length: JUMP_BATCH }, (_, k) => from + k)
      const raws = await Promise.allSettled(pis.map((pi) => api.log(pi * pageSize, pageSize)))
      if (token !== gen) return
      let progressed = false
      for (let k = 0; k < raws.length; k++) {
        const r = raws[k]
        if (r.status === "rejected") {
          reportError(r.reason)
          break // un échec dans le lot : on ne sait plus quelle page vient ensuite, on arrête le lot
        }
        const commits = ingest(pis[k], r.value, true)
        if (!commits) break // page invalide (dépôt bougé sous nos pieds) : le reset s'en chargera
        opts.onPageLoaded?.(commits)
        progressed = true
        if (r.value.length < pageSize) {
          exhausted = true
          break
        }
      }
      if (!progressed) return // aucune progression : ne pas boucler indéfiniment sur une panne
    }
  }

  return {
    get state(): LayoutState {
      return S
    },
    get total(): number {
      return TOTAL
    },
    get exhausted(): boolean {
      return exhausted
    },
    get token(): number {
      return gen
    },
    commitAt: (row: number) => pageCache.commitAt(row),
    isResident: (r0: number, r1: number) => pageCache.isResident(r0, r1),
    touch: (pi: number) => pageCache.touch(pi),
    pageOfRow: (row: number) => pageCache.pageOfRow(row),
    evict: (viewRowRange: readonly [number, number] | null, extraRows: Iterable<number>) => pageCache.evict(viewRowRange, extraRows),

    fetchMore,
    fetchProgress,
    ensureRows,
    growUntil,

    /** Réinitialise l'état de layout et le cache pour un dépôt (re)chargé. Rend les stash bruts
        (le contrôleur y lit les noms d'entrée pour la mesure des colonnes) — ne touche à aucun
        DOM, ça reste l'affaire du contrôleur (`remount`/`scrollTop`). */
    async reset(): Promise<{ stashes: Stash[] }> {
      ++gen // périme les fetchs en vol
      const [total, stashes] = await Promise.all([api.total(), api.stashes().catch((): Stash[] => [])])
      /* Ré-init d'un seul tenant, APRÈS l'attente, sous un gen re-bumpé : un scroll pendant
         l'await peut relancer fetchMore — parti sur l'ancien état, il doit être jeté à
         l'arrivée, pas semer une page dans l'état neuf. Le contrôleur compare `token` avant/après
         sa propre suite d'appels (remount, fetchMore initial) pour détecter un reset concurrent. */
      ++gen
      pageCache.reset()
      fetching = null
      refetching.clear()
      TOTAL = total
      stashOf = new Map(stashes.map((s) => [s.h, s.name]))
      plumbing = new Set(stashes.flatMap((s) => s.p.slice(1)))
      exhausted = TOTAL === 0
      S = createState()
      errorReported = false
      return { stashes }
    },

    /** invalide tout ce qui est en vol, sans toucher au DOM (affaire du contrôleur) */
    destroy(): void {
      gen++
    },
  }
}

export type GraphLoader = ReturnType<typeof createLoader>
