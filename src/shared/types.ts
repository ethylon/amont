/* Types du domaine, partagés par les trois process (main, preload, renderer). Déménagés
   depuis renderer/lib/git.ts : ils décrivent la forme des données qui traversent l'IPC,
   pas seulement ce que le renderer en attend — main les produit, preload les relaie tels
   quels. Voir ipc-contract.ts pour la map des canaux qui les transporte. */

import type { ErrorPayload } from "./errors.ts"

/** `Omit` qui distribue sur les membres d'une union discriminée plutôt que de s'effondrer sur
    leurs seules clés communes (`keyof (A | B)` ne garde que l'intersection des clés — `Omit`
    non distribuée y perdrait les champs propres à chaque variante). Utile pour construire le
    payload d'un événement (`TraceLine`, `OpEvent`) sans son `id`, ajouté au dernier moment par
    l'émetteur qui le connaît déjà (cf. main/ipc.ts `makeHooks`). */
export type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

export type Commit = {
  /** SHA complet (40 caractères) — fix B1 (AUDIT.md §2) : le renderer interne ces hash en ids
      entiers séquentiels à l'ingestion (cf. renderer/features/graph/ids.ts), la troncature à
      8 caractères redevient une affaire d'affichage. */
  h: string
  /** parents, SHA complets ; le premier est le first-parent */
  p: string[]
  d: string
  a: string
  /** e-mail de l'auteur, seule clé d'avatar que git connaisse */
  e: string
  /** refs brutes de `%D --decorate=full` : "HEAD -> refs/heads/develop, tag: refs/tags/v4.2.0" */
  r: string
  s: string
  /** posé par le collapse release/hotfix (cf. renderer/features/graph/layout/collapse.ts) : cette ligne fusionne les deux merges
      d'une version — côté master (absorbé) et côté develop (survivant). */
  cap?: {
    /** SHA complet du merge master fusionné ; reste résolu par la capsule dans layoutChunk */
    absorbed: string
    /** tag semver de la release, `null` si la paire n'en portait pas */
    version: string | null
    /** branche source : "release/1.6.2", "hotfix/1.6.3" */
    from: string
    flow: "release" | "hotfix"
    /** [cible master, cible develop] */
    targets: [string, string]
  }
  /** posé par le repli des stash (cf. renderer/features/graph/layout/collapse.ts) : cette ligne est une entrée de stash,
      ses parents de plomberie ont été retirés — seul le parent de base reste. */
  stash?: {
    /** nom d'entrée `stash@{N}`, la poignée des actions apply/pop/drop */
    name: string
    /** SHA complet du commit des fichiers non suivis (`stash push -u`), `null` sans eux */
    untracked: string | null
  }
}

/** Une entrée de `git stash list`. `p` garde tous les parents : base, index, non suivis. */
export type Stash = {
  name: string
  /** SHA complet du commit de stash, sa ligne dans le graphe */
  h: string
  p: string[]
  d: string
  a: string
  e: string
  /** sujet du reflog : "WIP on x: …" ou "On x: message" */
  s: string
}

export type StashAct = "push" | "apply" | "pop" | "drop"

export type FileChange = {
  /** A, M, D, R, C, ? ou un couple de conflit (UU, AA…) */
  st: string
  path: string
  old?: string | null
}

/** Un dépôt ouvert. `id` est l'unique poignée acceptée par les appels git. */
export type Repo = { id: number; path: string; name: string }
/** Un dépôt connu mais pas ouvert : récent, ou trouvé sous la racine. */
export type RepoRef = { path: string; name: string }
/** `null` : dialogue annulé. Un échec d'ouverture (pas un dépôt…) throw désormais une AppError
    structurée (fix chantier « erreurs », AUDIT.md §4) plutôt que de rendre `{ error }` — même
    convention que le reste du contrat. */
export type OpenResult = Repo | null

export type BootState = {
  root: string | null
  recents: RepoRef[]
  /** onglets restaurés, déjà ouverts côté main */
  tabs: Repo[]
  active: number | null
}

export type Status = {
  branch: string | null
  head: string | null
  ahead: number | null
  behind: number | null
}

/** Une ref de `for-each-ref`. `ahead`/`behind` ne sont renseignés que pour une branche suivie. */
export type GitRef = {
  /** sans le préfixe `refs/…/` : "feature/x", "origin/master", "v4.2.0" */
  name: string
  kind: "head" | "remote" | "tag"
  head: boolean
  /** distante suivie, forme courte ("origin/master") ; vide si la branche n'en a pas */
  upstream: string
  ahead: number
  behind: number
  /** branche locale déjà fusionnée dans la branche d'intégration */
  merged: boolean
  /** branche locale dont la contrepartie distante a été supprimée */
  gone: boolean
  /** SHA complet du commit pointé, pelé pour un tag annoté : la cible d'un focus dans le graphe */
  tip: string
}

/** Les préfixes de `git flow init`, ou `null` si le dépôt ignore git-flow. */
export type FlowPrefixes = Partial<Record<"feature" | "bugfix" | "release" | "hotfix", string>>

/** Contexte read-only de la branche de flow courante : cockpit et carte contexte. */
export type FlowInfo = {
  /** commits propres à la branche, absents de sa base */
  commits: number
  /** epoch (s) du premier commit propre, `null` tant que la branche n'a rien */
  startedAt: number | null
  /** point de départ affichable : dernier tag (release/hotfix) ou tronc (feature/bugfix) */
  base: string | null
  /** branches où le finish atterrira */
  targets: string[]
  /** tag que le finish posera — version du nom de branche, sinon bump du dernier tag */
  nextTag: string | null
}

export type BranchAct = "merge" | "delete" | "pull" | "push" | "finish"

export type WtSource = "staged" | "unstaged" | "untracked"

/** Sujet (première ligne) et description (corps) d'un message de commit, tels que saisis. */
export type CommitMessage = { subject: string; body: string }

export type Worktree = Record<"staged" | "unstaged" | "untracked" | "conflicts", FileChange[]>

export type OpName = "fetch" | "pull" | "push"

/* Le cas "error" transporte un code structuré plutôt qu'un message français pré-formaté (fix
   chantier « erreurs », AUDIT.md §4) : le renderer compose le texte affiché. Ce canal étant un
   événement (`webContents.send`), pas une erreur d'`invoke`, il échappe à la restriction
   d'Electron qui ne laisse passer que `.message` sur un throw — `code`/`detail` voyagent tels
   quels, sans le détour JSON qu'exige `shared/errors.ts` côté invoke. */
export type OpEvent = { id: number } & (
  | { op: OpName; state: "start"; auto: boolean }
  | { op: OpName; state: "done"; auto: boolean; added: number }
  | ({ op: OpName; state: "error"; auto: boolean } & ErrorPayload)
)

/** `.git` a bougé sous nos pieds. Main ne l'émet qu'application au premier plan. */
export type ChangeEvent = { id: number }

/** Une ligne de la console : en-tête d'opération, commande lancée, sortie stderr, ou issue. */
export type TraceLine = { id: number } & (
  | { kind: "group"; text: string; ts: number }
  | { kind: "cmd"; text: string }
  | { kind: "out"; text: string }
  | { kind: "exit"; ok: boolean; ms: number }
)
