/* Types du domaine, partagés par les trois process (main, preload, renderer). Déménagés
   depuis renderer/lib/git.ts : ils décrivent la forme des données qui traversent l'IPC,
   pas seulement ce que le renderer en attend — main les produit, preload les relaie tels
   quels. Voir ipc-contract.ts pour la map des canaux qui les transporte. */

export type Commit = {
  /** hash court, 8 caractères */
  h: string
  /** parents, hashes courts ; le premier est le first-parent */
  p: string[]
  d: string
  a: string
  /** e-mail de l'auteur, seule clé d'avatar que git connaisse */
  e: string
  /** refs brutes de `%D --decorate=full` : "HEAD -> refs/heads/develop, tag: refs/tags/v4.2.0" */
  r: string
  s: string
  /** posé par le collapse release/hotfix (cf. graph-layout) : cette ligne fusionne les deux merges
      d'une version — côté master (absorbé) et côté develop (survivant). */
  cap?: {
    /** hash court du merge master fusionné ; reste résolu par la capsule dans layoutChunk */
    absorbed: string
    /** tag semver de la release, `null` si la paire n'en portait pas */
    version: string | null
    /** branche source : "release/1.6.2", "hotfix/1.6.3" */
    from: string
    flow: "release" | "hotfix"
    /** [cible master, cible develop] */
    targets: [string, string]
  }
  /** posé par le repli des stash (cf. graph-canvas) : cette ligne est une entrée de stash,
      ses parents de plomberie ont été retirés — seul le parent de base reste. */
  stash?: {
    /** nom d'entrée `stash@{N}`, la poignée des actions apply/pop/drop */
    name: string
    /** hash court du commit des fichiers non suivis (`stash push -u`), `null` sans eux */
    untracked: string | null
  }
}

/** Une entrée de `git stash list`. `p` garde tous les parents : base, index, non suivis. */
export type Stash = {
  name: string
  /** hash court (8) du commit de stash, sa ligne dans le graphe */
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
export type OpenResult = Repo | { error: string } | null

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
  /** hash court (8) du commit pointé, pelé pour un tag annoté : la cible d'un focus dans le graphe */
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

export type OpEvent = { id: number } & (
  | { op: OpName; state: "start"; auto: boolean }
  | { op: OpName; state: "done"; auto: boolean; added: number }
  | { op: OpName; state: "error"; auto: boolean; message: string }
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
