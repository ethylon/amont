/* Localisation des erreurs structurées (AUDIT.md §4, chantier « erreurs »). Le main ne renvoie
   plus de strings françaises pré-formatées : juste un code (+ un detail factuel — nom de
   branche, ligne fatal: de git…). C'est ici, et seulement ici, que le message affiché à
   l'utilisateur prend forme. */

import { decodeError, type ErrorPayload } from "../../../shared/errors.ts"

const MESSAGES: Record<ErrorPayload["code"], (detail?: string) => string> = {
  NOT_A_REPO: () => "Pas un dépôt git (ou git introuvable)",
  NO_REPO: () => "Ce dépôt n'est plus ouvert",
  NOT_ALLOWED: () => "Chemin non autorisé",
  BAD_ARG: (d) => (d ? `Argument invalide : ${d}` : "Argument invalide"),
  BUSY: () => "Une opération est déjà en cours",
  MERGE_CONFLICT: (d) => (d ? `Conflit dans : ${d}` : "La fusion s'est terminée en conflit"),
  STASH_POP_CONFLICT: (d) => `Sur ${d}, mais le stash entre en conflit — entrée conservée`,
  NOT_FLOW_BRANCH: (d) => `${d} n'est pas une branche git-flow`,
  NO_UPSTREAM: (d) => `${d} ne suit aucune branche distante`,
  TIMEOUT: () => "git ne répond pas (délai dépassé)",
  ABORTED: () => "Opération annulée",
  OUTPUT_LIMIT: () => "La sortie de git dépasse la limite autorisée",
  GIT_FAILED: (d) => d ?? "Échec de git",
  UNKNOWN: (d) => d ?? "Erreur inconnue",
}

function format(payload: ErrorPayload): string {
  return MESSAGES[payload.code](payload.detail)
}

/** À utiliser sur une erreur d'`invoke` (rejet capturé par un `catch`/`.then(null, …)`). */
export function describeError(err: unknown): string {
  return format(decodeError(err))
}

/** À utiliser sur un payload déjà structuré (événement `git:op`, qui échappe à la restriction
    d'Electron sur les erreurs d'`invoke` et transporte `code`/`detail` tels quels). */
export function describePayload(payload: ErrorPayload): string {
  return format(payload)
}
