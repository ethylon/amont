/* Parseurs purs de sorties git — zéro import Electron, zéro appel `spawn` : exécutables sous
   Node tels quels, c'est la surface de test unitaire du chantier main (AUDIT.md §4/§10, item 6).
   Toute fonction d'ici prend une string (ou des champs déjà extraits) et rend des données ;
   les appels git qui produisent ces strings vivent dans queries.ts / ops.ts / flow.ts. */

import type { Commit, FileChange, FlowPrefixes, GitRef, Stash, Worktree } from "../../shared/types.ts"
import type { ErrorPayload } from "../../shared/errors.ts"

/* --- Arbre de travail ---
   `status --porcelain=v1 -z` : chaque entrée est `XY<espace>chemin`, X = index, Y = arbre.
   Pour un rename, l'ancien chemin occupe le champ NUL suivant — d'où le ++i. */
const CONFLICT = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"])

export function parsePorcelain(out: string): Worktree {
  const parts = out.split("\0")
  const wt: Worktree = { staged: [], unstaged: [], untracked: [], conflicts: [] }
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i]
    if (e.length < 4) continue
    const x = e[0], y = e[1], path = e.slice(3)
    if (x === "?") { wt.untracked.push({ st: "?", path }); continue }
    if (CONFLICT.has(x + y)) { wt.conflicts.push({ st: x + y, path }); continue }
    const old = x === "R" || x === "C" ? parts[++i] : null
    if (x !== " ") wt.staged.push({ st: x, path, old })
    if (y !== " ") wt.unstaged.push({ st: y, path })
  }
  return wt
}

/* Parseur de `--name-status -z` (fix B3), seul format sûr : sans `-z`, git C-quote les chemins
   non-ASCII (`"caf\303\251.txt"`) et un nom contenant tab ou saut de ligne pulvérise un
   split('\n')/split('\t'). En `-z`, chaque champ est terminé par NUL et les chemins sortent
   bruts. Un rename/copy occupe trois champs : `Rnn NUL ancien NUL nouveau NUL`. */
export function parseNameStatus(out: string): FileChange[] {
  const files: FileChange[] = []
  const parts = out.split("\0") // NUL final : dernier élément vide, jamais consommé comme statut
  for (let i = 0; i < parts.length - 1;) {
    const st = parts[i++]
    if (!st) break
    /* R et C portent un score de similarité (R100) et un champ de plus : l'ancien chemin */
    const old = st[0] === "R" || st[0] === "C" ? parts[i++] : null
    const path = parts[i++]
    if (path === undefined) break // sortie tronquée : on rend ce qui est complet
    files.push({ st: st[0], path, old })
  }
  return files
}

/* --- Stash --- */
export function parseStashList(out: string): Stash[] {
  return out.split("\x1e")
    .map((row) => row.split("\x1f"))
    .filter((f) => f.length >= 7)
    .map((f) => ({
      h: f[0].trim(),
      p: f[1].split(" ").filter(Boolean),
      name: f[2], d: f[3], a: f[4], e: f[5], s: f.slice(6).join(" "),
    }))
}

/* --- Log ---
   SHA complets (fix B1, AUDIT.md §2) : un hash tronqué à 8 caractères garantit
   statistiquement des collisions passé quelques dizaines de milliers de commits — le
   renderer interne ces SHA en ids entiers séquentiels à l'ingestion (cf. features/graph/ids.ts),
   la troncature à 8 caractères redevient une affaire d'affichage. */
export function parseLogPage(out: string): Commit[] {
  /* git ne filtre pas les octets de contrôle de `%s` : un sujet qui contiendrait nos
     séparateurs fabriquerait des champs en trop (recollés au sujet, il est en dernier)
     ou des lignes bancales (écartées par le compte de champs). */
  return out.split("\x1e")
    .map((row) => row.split("\x1f"))
    .filter((f) => f.length >= 7)
    .map((f) => ({
      h: f[0].trim(),
      p: f[1].split(" ").filter(Boolean),
      d: f[2], a: f[3], e: f[4], r: f[5], s: f.slice(6).join(" "),
    }))
}

/* --- Refs ---
   `origin/HEAD` est un alias d'affichage : il ferait doublon avec la branche par défaut de la
   distante — on le retire du tableau et on récupère son symref pour le calcul de merge/gone. */
const REF_KINDS: [string, GitRef["kind"]][] = [
  ["refs/heads/", "head"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"],
]

export interface ParsedRefs {
  refs: GitRef[]
  /** symref de `<remote>/HEAD` (forme courte, ex. "origin/master"), vide si aucune distante */
  base: string
}

export function parseForEachRef(out: string): ParsedRefs {
  let base = ""
  const refs: GitRef[] = out.split("\n").filter(Boolean).flatMap((line): GitRef[] => {
    const [refname, head, track = "", symref = "", upstream = "", oid = "", peeled = ""] = line.split("\x1f")
    /* `%(*objectname)` pèle un tag annoté vers son commit ; vide pour une branche ou un tag léger */
    const tip = peeled || oid
    const kind = REF_KINDS.find(([prefix]) => refname.startsWith(prefix))
    if (!kind) return []
    const name = refname.slice(kind[0].length)
    if (kind[1] === "remote" && name.endsWith("/HEAD")) {
      base ||= symref
      return []
    }
    const ahead = /ahead (\d+)/.exec(track)
    const behind = /behind (\d+)/.exec(track)
    return [{
      name,
      kind: kind[1],
      head: head === "*",
      upstream,
      ahead: ahead ? +ahead[1] : 0,
      behind: behind ? +behind[1] : 0,
      merged: false,
      gone: track === "gone",
      tip,
    }]
  })
  return { refs, base }
}

/* `--all` embarque `refs/stash`, dont les commits de plomberie (« On x », « index on x »,
   « untracked files on x ») n'ont rien à faire dans le graphe. `--exclude` s'applique au
   `--all` qui suit. Partagé par git/queries.ts (log, recherche, total) et git/ops.ts
   (comptage des nouveaux commits après fetch). */
export const ALL_REFS = ["--exclude=refs/stash", "--all"]

/* --- Validation de nom de branche ---
   ponytail: filtre de sûreté, pas un parseur de refname — refuse surtout le nom qui
   commencerait par `-` et se ferait passer pour une option de git (fix B2). Liste noire
   plutôt que blanche : `[\w./+-]` refusait les lettres accentuées et `@`, pourtant légaux
   dans un refname. */
export const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[^\x00-\x20\x7f~^:?*[\\]+$/

/* --- Échecs git (fix : conserve le code de sortie, inspecte stdout) ---
   git noie ses erreurs sous des lignes `hint:` : on ne garde que fatal:/error:. Un conflit
   (merge, ou stash pop qui rejoue un merge) s'annonce par des lignes `CONFLICT (...)` — sur
   STDOUT, jamais stderr, d'où l'ancien bug (gitError ne lisait que stderr et perdait ce
   signal, cf. AUDIT.md §2 B4/divers). */
const CONFLICT_LINE = /^CONFLICT \([^)]*\):.*? in (.+)$/gm

export interface GitFailureInput {
  exitCode: number | null
  stdout: string
  stderr: string
  killedBy: "timeout" | "abort" | "limit" | null
}

export function classifyGitFailure(input: GitFailureInput): ErrorPayload {
  if (input.killedBy === "timeout") return { code: "TIMEOUT" }
  if (input.killedBy === "abort") return { code: "ABORTED" }
  if (input.killedBy === "limit") return { code: "OUTPUT_LIMIT" }

  const files = [...`${input.stdout}\n${input.stderr}`.matchAll(CONFLICT_LINE)].map((m) => m[1])
  if (files.length) return { code: "MERGE_CONFLICT", detail: files.join(", ") }

  const lines = (input.stderr || input.stdout).split("\n").map((l) => l.trim()).filter(Boolean)
  const fatal = lines.filter((l) => /^(fatal|error):/.test(l)).slice(0, 2)
  const msg = (fatal.length ? fatal : lines.slice(-1))
    .map((l) => l.replace(/^(fatal|error):\s*/, ""))
    .join(" — ")
  const detail = input.exitCode == null ? msg : `${msg} (exit ${input.exitCode})`
  return { code: "GIT_FAILED", detail: detail || undefined }
}

/* --- Git-flow ---
   Préfixes posés par `git flow init`, lus depuis `git config --get-regexp ^gitflow\.prefix\.`. */
export function parseFlowPrefixes(out: string): FlowPrefixes {
  const prefixes: FlowPrefixes = {}
  for (const line of out.split("\n").filter(Boolean)) {
    const [key, value = ""] = line.split(" ")
    const kind = key.slice("gitflow.prefix.".length)
    if (kind === "feature" || kind === "bugfix" || kind === "release" || kind === "hotfix") prefixes[kind] = value
  }
  return prefixes
}

const SEMVER_RE = /^v?\d+\.\d+\.\d+/

/** Suffixe de version d'une branche de flow : le nom moins son préfixe, ou vide si le résultat
    commencerait par `-` (même garde que `finish`, fix B2 : `feature/-D` ne doit jamais être lu
    comme une version). */
export function flowVersionSuffix(branch: string, prefix: string): string {
  const raw = branch.startsWith(prefix) ? branch.slice(prefix.length) : ""
  return raw.startsWith("-") ? "" : raw
}

/** Le tag que posera `finish` : la version portée par le nom de branche si elle en a une
    (convention gitflow, "release/4.2.0"), sinon un bump du dernier tag — patch pour un
    hotfix, minor pour une release. `null` si ni l'un ni l'autre ne donne de piste. */
export function computeNextTag(kind: "release" | "hotfix", suffix: string, lastTag: string | null): string | null {
  if (SEMVER_RE.test(suffix)) return suffix
  const m = lastTag && /^(v?)(\d+)\.(\d+)\.(\d+)/.exec(lastTag)
  if (!m) return null
  return kind === "hotfix" ? `${m[1]}${m[2]}.${m[3]}.${+m[4] + 1}` : `${m[1]}${m[2]}.${+m[3] + 1}.0`
}
