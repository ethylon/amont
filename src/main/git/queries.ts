/* Opérations de lecture (AUDIT.md §4) : statut, arbre de travail, log, refs, recherche,
   fichiers/diff, et les deux poignées shell (icône, ouverture) confinées au dépôt. Aucune
   mutation ici — pas de mutex, comme avant ce refactor. */

import { extname } from "node:path"
import { app, shell } from "electron"

import { AppError } from "../../shared/errors.ts"
import type {
  CommitMessage, Commit, FileChange, GitRef, Stash, Status, Worktree, WtSource,
} from "../../shared/types.ts"
import { inRepo, type RepoHandle } from "../repos.ts"
import {
  ALL_REFS, parseForEachRef, parseLogPage, parseNameStatus, parsePorcelain, parseStashList,
} from "./parse.ts"

const HASH = /^[0-9a-f]{7,40}$/

function assertHash(hash: string, parent?: string | null): void {
  if (!HASH.test(hash) || (parent != null && !HASH.test(parent))) throw new AppError("BAD_ARG", "hash")
}

/* --- Statut ---
   Branche courante + décalage avec sa distante. Absence d'upstream ou HEAD détachée
   ne sont pas des erreurs : le renderer affiche simplement des tirets. */
export async function repoStatus(r: RepoHandle): Promise<Status> {
  /* HEAD unborn (dépôt fraîchement init) : rev-parse échoue alors que rien n'est anormal —
     statut vide plutôt qu'un rejet, comme repo:unstage sait déjà le faire */
  const branch = (await r.git(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim()
  if (!branch) return { branch: null, head: null, ahead: null, behind: null }
  const head = (await r.git(["rev-parse", "HEAD"]).catch(() => "")).trim().slice(0, 8) || null
  if (branch === "HEAD") return { branch: null, head, ahead: null, behind: null }
  try {
    const [behind, ahead] = (await r.git(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]))
      .trim().split(/\s+/).map(Number)
    return { branch, head, ahead, behind }
  } catch {
    return { branch, head, ahead: null, behind: null }
  }
}

/* --- Arbre de travail --- */
export const worktree = (r: RepoHandle): Promise<Worktree> =>
  r.git(["status", "--porcelain=v1", "-z", "-uall"]).then(parsePorcelain)

const WT_DIFF: Record<"staged" | "unstaged", string[]> = { staged: ["diff", "--cached"], unstaged: ["diff"] }

export function wtdiff(r: RepoHandle, path: string, source: WtSource): Promise<string> {
  if (source === "untracked") return r.diffNoIndex("/dev/null", inRepo(r, path))
  if (source !== "staged" && source !== "unstaged") throw new AppError("BAD_ARG", "source")
  return r.git([...WT_DIFF[source], "--", path])
}

/* --- Stash --- */
export const stashList = (r: RepoHandle): Promise<Stash[]> =>
  r.git(["stash", "list", "--format=%H%x1f%P%x1f%gd%x1f%as%x1f%an%x1f%ae%x1f%gs%x1e"])
    .catch(() => "").then(parseStashList)

const stashTips = (r: RepoHandle): Promise<string[]> =>
  r.git(["stash", "list", "--format=%H"]).catch(() => "").then((o) => o.split("\n").filter(Boolean))

/* --- Log ---
   ponytail: git log --skip re-parcourt l'historique à chaque page — OK jusqu'à ~100k commits,
   passer à un stream spawn persistant si un jour ça rame. */
export async function logPage(r: RepoHandle, skip: number, count: number, signal?: AbortSignal): Promise<Commit[]> {
  /* --decorate=full : `%D` sort alors `refs/heads/x` / `refs/remotes/origin/x` / `refs/tags/x`.
     Sous sa forme courte, `origin/x` et une branche locale `origin/x` sont indistinguables. */
  const out = await r.git([
    "log", ...ALL_REFS, ...(await stashTips(r)), "--date-order", "--date=short", "--decorate=full",
    `--skip=${skip}`, `-n${count}`,
    "--pretty=format:%H%x1f%P%x1f%ad%x1f%an%x1f%ae%x1f%D%x1f%s%x1e",
  ], { signal })
  return parseLogPage(out)
}

/* --- Recherche ---
   git ET-alise `--grep` et `--author` : chaque critère est donc une invocation séparée dont on
   prend l'union. `-F` rend les motifs littéraux, `-S` fouille le contenu des diffs (la pioche).
   ponytail: plafond par critère, pas de pagination — la barre n'affiche qu'un compteur et saute
   de résultat en résultat. */
const SEARCH_MAX = 2000
const SEARCH_TIMEOUT = 30_000

export async function searchCommits(r: RepoHandle, q: string, content: boolean, signal?: AbortSignal): Promise<string[]> {
  const base = ["log", ...ALL_REFS, "--format=%H", `-n${SEARCH_MAX}`, "-i", "-F"]
  const runs = [
    r.git([...base, `--grep=${q}`], { signal }),
    r.git([...base, `--author=${q}`], { signal }),
  ]
  /* un préfixe de hash n'est pas un motif : rev-parse le résout, ou échoue (inconnu, ambigu) */
  if (/^[0-9a-f]{4,40}$/i.test(q))
    runs.push(r.git(["rev-parse", "--verify", "-q", `${q}^{commit}`], { signal }).catch(() => ""))
  /* la pioche relit le diff de chaque commit : lente, donc jamais implicite */
  if (content) runs.push(r.git([...base, `-S${q}`], { timeout: SEARCH_TIMEOUT, signal }))

  const outs = await Promise.all(runs)
  return [...new Set(outs.join("\n").split("\n").filter(Boolean).map((h) => h.slice(0, 8)))]
}

/* Le comptage embarque les tips de stash, comme le log. Chaque entrée traîne 1 à 2 commits
   de plomberie (index, non suivis) que le renderer replie : on les soustrait pour que
   `total` reste le nombre de lignes réellement affichables. Dédupliqués : deux stash créés
   dans la même seconde partagent le même commit d'index (même arbre, même parent, même date). */
export async function total(r: RepoHandle): Promise<number> {
  const stashes = await stashList(r)
  const plumbing = new Set(stashes.flatMap((s) => s.p.slice(1)))
  const count = parseInt(await r.git(["rev-list", "--count", ...ALL_REFS, ...stashes.map((s) => s.h)]), 10)
  return count - plumbing.size
}

/* --- Refs ---
   Branches d'intégration : jamais signalées « fusionnées », on ne les nettoie pas. */
const TRUNK = new Set(["main", "master", "develop"])
/* Un `git reflog` par branche candidate : en Promise.all nu, 200 branches locales sans
   upstream = 200 process concurrents à chaque rafraîchissement. Petit pool de travailleurs
   qui épuisent une file commune à la place. */
const REFLOG_POOL = 8

export async function listRefs(r: RepoHandle): Promise<GitRef[]> {
  const out = await r.git([
    "for-each-ref", "--sort=refname",
    "--format=%(refname)\x1f%(HEAD)\x1f%(upstream:track,nobracket)\x1f%(symref:short)\x1f%(upstream:short)\x1f%(objectname)\x1f%(*objectname)",
    "refs/heads", "refs/remotes", "refs/tags",
  ])
  const { refs, base: symrefBase } = parseForEachRef(out)

  /* Sans distante, on retombe sur la convention. Sans convention non plus, personne n'est
     « mergé » : mieux vaut ne rien dire que désigner une base arbitraire. */
  const base = symrefBase || ["main", "master", "develop"].find((b) => refs.some((x) => x.kind === "head" && x.name === b)) || ""
  if (base) {
    /* `origin/main` → `main` ; une base déjà locale traverse inchangée. La branche
       d'intégration est ancêtre d'elle-même : la marquer n'apprendrait rien. */
    const mainline = base.slice(base.indexOf("/") + 1)
    const mergedOut = await r.git(["for-each-ref", "--merged", base, "--format=%(refname:short)", "refs/heads"])
    const merged = new Set(mergedOut.split("\n").filter(Boolean))
    /* `--merged` inclut tout ancêtre de la base : une branche fraîche ou en retard, posée sur un
       commit du tronc, y figure sans rien avoir « fini ». Son tip est alors sur la chaîne
       first-parent de la base — un simple signet dans l'historique. Seule une branche dont le tip
       quitte le tronc (côté second parent d'un merge) a réellement été fusionnée : on écarte tout
       ce qui pointe sur le tronc, tip courant comme commit ancien.

       La chaîne parcourt tout l'historique et les refs sont relues à chaque rafraîchissement :
       on la met en cache tant que le tip de la base n'a pas bougé. */
    const baseTip = (await r.git(["rev-parse", base])).trim()
    if (r.trunk?.key !== `${base} ${baseTip}`) {
      const chain = (await r.git(["rev-list", "--first-parent", base])).split("\n").filter(Boolean)
      r.trunk = { key: `${base} ${baseTip}`, set: new Set(chain) }
    }
    const trunk = r.trunk.set
    for (const ref of refs)
      ref.merged =
        ref.kind === "head" &&
        ref.name !== mainline &&
        !TRUNK.has(ref.name) &&
        !trunk.has(ref.tip) &&
        merged.has(ref.name)
  }
  /* le graphe indexe les commits par hash court : `merged` s'est servi du SHA complet, on rabote */
  for (const ref of refs) ref.tip = ref.tip.slice(0, 8)

  /* Une branche suivie annonce `gone` d'elle-même. Sans upstream — poussée sans `-u`, ou config
     jamais posée — la suppression distante emporte jusqu'au reflog de `refs/remotes/…` : ne
     reste que le reflog local, où `branch: Created from origin/x` témoigne du lien passé. Une
     branche née localement n'y mentionne jamais son propre nom distant, et n'est donc pas barrée.

     ponytail: un reflog expiré (gc, 90 j) rend la branche indiscernable d'une branche locale. */
  const remoteRefs = refs.filter((x) => x.kind === "remote").map((x) => x.name)
  const present = new Set(remoteRefs.map((n) => n.slice(n.indexOf("/") + 1)))
  const remoteNames = [...new Set(remoteRefs.map((n) => n.slice(0, n.indexOf("/"))))]

  const candidates: GitRef[] = remoteNames.length
    ? refs.filter((ref) => ref.kind === "head" && !ref.gone && !present.has(ref.name))
    : []
  await Promise.all(Array.from({ length: Math.min(REFLOG_POOL, candidates.length) }, async () => {
    for (let ref: GitRef | undefined; (ref = candidates.shift()) !== undefined;) {
      const reflog = await r.git(["reflog", "show", "--format=%gs", ref.name]).catch(() => "")
      ref.gone = remoteNames.some((remote) => reflog.includes(`${remote}/${ref!.name}`))
    }
  }))
  return refs
}

/* --- Fichiers / diff --- */

/* Fichiers touchés. Pour un merge, le renderer passe le first-parent :
   le diff montre ce que le merge a apporté sur la branche cible. */
export function files(r: RepoHandle, hash: string, parent: string | null, signal?: AbortSignal): Promise<FileChange[]> {
  assertHash(hash, parent)
  const args = parent
    ? ["diff", "--name-status", "-z", parent, hash]
    : ["diff-tree", "-r", "--root", "--no-commit-id", "--name-status", "-z", hash]
  return r.git(args, { signal }).then(parseNameStatus)
}

/* Corps du message, à la demande. Le joindre au log coûterait, pour n'en afficher qu'un,
   une copie de tous les messages longs de l'historique. */
export function body(r: RepoHandle, hash: string, signal?: AbortSignal): Promise<string> {
  assertHash(hash)
  return r.git(["show", "-s", "--format=%b", hash], { signal })
}

/* Sujet et corps du dernier commit, pour préremplir un amend. `%B` est le message brut :
   la première ligne est le sujet, le reste (après la ligne vide) la description. */
export async function headMessage(r: RepoHandle): Promise<CommitMessage> {
  const raw = await r.git(["show", "-s", "--format=%B", "HEAD"])
  const nl = raw.indexOf("\n")
  const subject = (nl < 0 ? raw : raw.slice(0, nl)).trim()
  const body_ = (nl < 0 ? "" : raw.slice(nl + 1)).replace(/^\n+/, "").trimEnd()
  return { subject, body: body_ }
}

export function diff(
  r: RepoHandle, hash: string, parent: string | null, path: string, oldPath: string | null, signal?: AbortSignal
): Promise<string> {
  assertHash(hash, parent)
  if (typeof path !== "string" || (oldPath != null && typeof oldPath !== "string")) throw new AppError("BAD_ARG", "path")
  const paths = oldPath ? [oldPath, path] : [path]
  const args = parent ? ["diff", parent, hash, "--", ...paths] : ["show", "--format=", hash, "--", ...paths]
  return r.git(args, { signal })
}

/* --- Shell : icône et ouverture ---
   Icône Windows du fichier. Absent du disque (supprimé, vieux commit) : le renderer retombe
   sur son icône générique. */
export function fileIcon(r: RepoHandle, path: string): Promise<string | null> {
  return app.getFileIcon(inRepo(r, path), { size: "small" }).then((i) => i.toDataURL(), () => null)
}

/* Extensions que Windows exécute au double-clic (association par défaut ou quasi-systématique) :
   un dépôt cloné hostile qui en contiendrait une transformerait `repo:openFile` en exécution
   native. ponytail: liste noire par extension — défense en profondeur, pas une garantie ; elle
   ne couvre ni les gestionnaires tiers enregistrés sur d'autres extensions, ni un contenu dont
   le vrai type ne correspondrait pas à l'extension. Pour une extension bloquée, on révèle le
   fichier dans l'explorateur plutôt que d'échouer en silence (AUDIT.md §2, divers). */
const BLOCKED_EXT = new Set([
  ".exe", ".bat", ".cmd", ".com", ".scr", ".msi", ".msp", ".ps1", ".ps1xml", ".vbs", ".vbe",
  ".js", ".jse", ".wsf", ".wsh", ".msc", ".cpl", ".jar", ".pif", ".reg", ".lnk", ".hta",
  ".gadget", ".application", ".ws",
])

export function openFile(r: RepoHandle, path: string): Promise<string> {
  const full = inRepo(r, path)
  if (BLOCKED_EXT.has(extname(full).toLowerCase())) {
    shell.showItemInFolder(full)
    return Promise.resolve("")
  }
  return shell.openPath(full)
}
