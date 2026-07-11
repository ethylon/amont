/* Opérations mutantes (AUDIT.md §4) : réseau (fetch/pull/push, auto ou manuel), actions de
   branche (merge/delete/pull/push/finish), checkout, stage/unstage/commit, stash.

   Toutes passent par le mutex de dépôt (`repos.withLock`, fix hygiène) : la danse
   stash→checkout→pop tournait sans verrou face à l'autofetch avant ce refactor — deux
   mutations concurrentes sur le même `.git` se soldent sinon par des `index.lock` qui se
   marchent dessus. Seul `runOp` (réseau) garde son propre garde manuel : l'auto-fetch doit
   pouvoir se taire silencieusement quand le dépôt est occupé, là où une action explicite de
   l'utilisateur doit throw (BUSY). */

import { AppError, decodeError } from "../../shared/errors.ts"
import type { BranchAct, OpEvent, OpName, StashAct } from "../../shared/types.ts"
import { assertPaths, withLock, type RepoHandle } from "../repos.ts"
import { mute } from "../watcher.ts"
import { OP_TIMEOUT } from "./exec.ts"
import { finishFlow } from "./flow.ts"
import { ALL_REFS, BRANCH } from "./parse.ts"

/* --- Réseau ---
   --progress : sans TTY git tait sa progression ; on la force pour que la console la streame. */
const OPS: Record<OpName, string[]> = {
  fetch: ["fetch", "--all", "--prune", "--progress"],
  pull: ["pull", "--ff-only", "--progress"],
  push: ["push", "--progress"],
}
const OP_GROUP: Record<OpName, string> = { fetch: "Fetch", pull: "Pull", push: "Push" }

export const isOpName = (name: string): name is OpName => Object.hasOwn(OPS, name)

/* En-tête d'opération : borne le flux au niveau de l'action utilisateur (un push, un pull,
   l'auto-fetch, un checkout…), là où `r.git()` ne voit que des commandes isolées. Les lectures
   de fond (statut, pages de log) restent sans en-tête, ce qui les distingue à l'œil. */
const groupTrace = (r: RepoHandle, text: string): void => r.events.trace({ kind: "group", text, ts: Date.now() })

/* Tips de toutes les refs, dédupliqués et triés : deux instantanés égaux = rien n'a bougé.
   Bien moins cher que le `rev-list --all --count` intégral qu'on payait deux fois par fetch. */
const refTips = (r: RepoHandle): Promise<string[]> =>
  r.git(["for-each-ref", "--format=%(objectname)", "refs/heads", "refs/remotes", "refs/tags"])
    .then((o) => [...new Set(o.split("\n").filter(Boolean))].sort())

/* Commits joignables des refs actuelles mais pas des anciens tips : les « nouveaux » du fetch.
   Plus juste que la différence de deux comptages, qu'un `--prune` faisait mentir. */
const countNew = (r: RepoHandle, before: string[]): Promise<number> =>
  r.git(["rev-list", "--count", ...ALL_REFS, "--stdin"], { input: before.map((h) => `^${h}\n`).join("") })
    .then((o) => parseInt(o, 10))

function errorPayload(e: unknown): Pick<Extract<OpEvent, { state: "error" }>, "code" | "detail"> {
  return decodeError(e)
}

/* Une par repo à la fois (git pose ses propres verrous, mais deux fetch concurrents sur le
   même dépôt se soldent par une erreur inutile). Le résultat part par événement, pas par
   retour d'invoke : l'auto-fetch n'a pas d'appelant côté renderer. Contrairement aux autres
   mutations, ne throw jamais : l'auto-fetch doit pouvoir se taire quand le dépôt est occupé. */
export async function runOp(r: RepoHandle, name: OpName, auto = false): Promise<void> {
  if (r.running) {
    /* jamais en silence pour un clic explicite : la fenêtre entre le clic et l'état `busy`
       du renderer est réelle */
    if (!auto) r.events.op({ op: name, state: "error", auto, code: "BUSY", detail: r.running })
    return
  }
  r.running = name
  groupTrace(r, auto ? "Auto-fetch" : OP_GROUP[name])
  r.events.op({ op: name, state: "start", auto })
  try {
    /* seul le fetch affiche un compteur ; pull recharge le graphe, push n'ajoute rien */
    const before = name === "fetch" ? await refTips(r) : null
    await r.git(OPS[name], { timeout: OP_TIMEOUT })
    let added = 0
    if (before) {
      const after = await refTips(r)
      if (after.join() !== before.join()) added = await countNew(r, before)
    }
    r.events.op({ op: name, state: "done", auto, added })
  } catch (e) {
    r.events.op({ op: name, state: "error", auto, ...errorPayload(e) })
  } finally {
    mute(r)
    r.running = null
  }
}

/* --- Actions de branche (menu contextuel) ---
   Aucun événement : le renderer a lancé l'action, c'est lui qui recharge et affiche l'erreur. */
const BRANCH_GROUP: Record<BranchAct, string> = { merge: "Fusion", delete: "Suppression", pull: "Pull", push: "Push", finish: "Clôture flow" }

/** La distante suivie par une branche, telle que sa config la déclare. */
async function upstreamOf(r: RepoHandle, name: string): Promise<{ remote: string; merge: string }> {
  const read = (key: string) => r.git(["config", "--get", `branch.${name}.${key}`]).then((o) => o.trim(), () => "")
  const [remote, merge] = await Promise.all([read("remote"), read("merge")])
  if (!remote || !merge) throw new AppError("NO_UPSTREAM", name)
  return { remote, merge }
}

const BRANCH_OPS: Record<BranchAct, (r: RepoHandle, name: string) => Promise<void>> = {
  merge: (r, name) => r.git(["merge", name], { timeout: OP_TIMEOUT }).then(() => {}),

  /* `-d`, jamais `-D` : le refus de git sur une branche non fusionnée est le seul garde-fou
     qu'on ait — le menu ne demande pas confirmation. La distante, elle, reste en place. */
  delete: (r, name) => r.git(["branch", "-d", name]).then(() => {}),

  /* On ne fetche pas dans une branche sortie : sur HEAD, c'est un pull. Ailleurs, le refspec
     explicite est fast-forward-only, et git en profite pour remettre `refs/remotes/…` à jour. */
  async pull(r, name) {
    const { remote, merge } = await upstreamOf(r, name)
    const current = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"])).trim()
    await r.git(name === current
      ? ["pull", "--ff-only", "--progress"]
      : ["fetch", remote, `${merge}:refs/heads/${name}`, "--progress"], { timeout: OP_TIMEOUT })
  },

  /* Le refspec nomme les deux côtés : `git push <remote> <branche>` pousserait vers une branche
     de même nom, quand bien même l'upstream en porte un autre. */
  async push(r, name) {
    const { remote, merge } = await upstreamOf(r, name)
    await r.git(["push", remote, `refs/heads/${name}:${merge}`, "--progress"], { timeout: OP_TIMEOUT })
  },

  finish: (r, name) => finishFlow(r, name),
}

export async function branchAction(r: RepoHandle, action: BranchAct, name: string): Promise<void> {
  if (!Object.hasOwn(BRANCH_OPS, action)) throw new AppError("BAD_ARG", "action")
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, action, async () => {
    groupTrace(r, `${BRANCH_GROUP[action]} ${name}`)
    try {
      await BRANCH_OPS[action](r, name)
    } finally {
      mute(r)
    }
  })
}

/* --- Checkout ---
   L'arbre sale part au stash et revient après la bascule. Bascule refusée : on repose l'arbre
   où on l'a trouvé. `pop` en conflit : git garde l'entrée de stash et pose ses marqueurs —
   on le dit et on n'essaie pas de rattraper, l'utilisateur est déjà sur la bonne branche. */
export async function checkout(r: RepoHandle, name: string): Promise<void> {
  if (typeof name !== "string" || !BRANCH.test(name)) throw new AppError("BAD_ARG", "name")
  await withLock(r, `checkout ${name}`, async () => {
    groupTrace(r, `Checkout ${name}`)
    const dirty = !!(await r.git(["status", "--porcelain", "-uall"])).trim()
    if (dirty) await r.git(["stash", "push", "-u", "-m", `amont: ${name}`])
    try {
      await r.git(["checkout", name])
    } catch (e) {
      /* le pop de rattrapage peut lui-même échouer (conflit) : l'entrée de stash survit,
         et c'est l'échec du checkout — la cause — qu'on remonte, pas celui du pop */
      if (dirty) await r.git(["stash", "pop"]).catch(() => {})
      throw e
    } finally {
      mute(r) // HEAD a bougé : le renderer recharge de lui-même, le watcher n'a rien à ajouter
    }
    if (dirty) await r.git(["stash", "pop"]).catch(() => {
      throw new AppError("STASH_POP_CONFLICT", name)
    })
  })
}

/* --- Arbre de travail : stage/unstage/commit ---
   Les chemins partent sur stdin, NUL-séparés, plutôt qu'en argv : « tout indexer » sur des
   milliers de fichiers dépasserait la limite de ligne de commande de Windows (~32k car.). */
const PATHSPEC = ["--pathspec-from-file=-", "--pathspec-file-nul"]

export async function stage(r: RepoHandle, paths: string[]): Promise<void> {
  assertPaths(paths)
  await withLock(r, "stage", () => r.git(["add", ...PATHSPEC], { input: paths.join("\0") }).then(() => {}))
}

export async function unstage(r: RepoHandle, paths: string[]): Promise<void> {
  assertPaths(paths)
  await withLock(r, "unstage", async () => {
    /* avant le premier commit il n'y a pas de HEAD, donc rien à restaurer depuis :
       sortir le chemin de l'index le laisse non suivi, ce qui est le résultat attendu. */
    const cmd = await r.git(["rev-parse", "--verify", "-q", "HEAD"])
      .then(() => ["restore", "--staged"], () => ["rm", "--cached", "-q"])
    await r.git([...cmd, ...PATHSPEC], { input: paths.join("\0") })
  })
}

export async function commit(r: RepoHandle, message: string, amend: boolean): Promise<void> {
  if (typeof message !== "string" || !message.trim()) throw new AppError("BAD_ARG", "message")
  await withLock(r, amend ? "amend" : "commit", async () => {
    groupTrace(r, amend ? "Amend" : "Commit")
    const args = ["commit", ...(amend ? ["--amend"] : []), "-m", message]
    await r.git(args)
    mute(r)
  })
}

/* --- Stash ---
   apply/pop/drop visent une entrée par son nom `stash@{N}` — les indices glissent après un
   drop, le renderer recharge la liste derrière chaque action. push remise l'arbre entier,
   non suivis compris, avec le message fourni. */
const STASH_NAME = /^stash@\{\d+\}$/
const STASH_GROUP: Record<StashAct, string> = { push: "Stash", apply: "Stash apply", pop: "Stash pop", drop: "Stash drop" }

export async function stashAction(r: RepoHandle, action: StashAct, arg?: string): Promise<void> {
  if (!Object.hasOwn(STASH_GROUP, action)) throw new AppError("BAD_ARG", "action")
  let args: string[]
  if (action === "push") {
    const msg = typeof arg === "string" && arg.trim() ? arg.trim() : null
    args = ["stash", "push", "-u", ...(msg ? ["-m", msg] : [])]
  } else {
    if (typeof arg !== "string" || !STASH_NAME.test(arg)) throw new AppError("BAD_ARG", "name")
    args = ["stash", action, arg]
  }
  await withLock(r, action, async () => {
    groupTrace(r, action === "push" ? STASH_GROUP.push : `${STASH_GROUP[action]} ${arg}`)
    try {
      await r.git(args)
    } finally {
      mute(r)
    }
  })
}
