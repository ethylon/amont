/* Erreurs structurées partagées par les trois process (AUDIT.md §4, chantier « main »).

   Contrainte dure d'Electron (cf. electron.d.ts, `IpcMain.handle`) : « Errors thrown through
   `handle` in the main process are not transparent as they are serialized and only the
   `message` property from the original error is provided to the renderer process. » Un throw
   perd donc tout sauf `.message` en traversant l'IPC — impossible d'y accrocher `code`/`detail`
   comme propriétés distinctes.

   Le contournement : `AppError` encode son payload `{ code, detail }` en JSON DANS `.message`.
   Ce qui traverse l'IPC est donc une string JSON ; `decodeError` la reconstitue de l'autre
   côté. À l'intérieur du main (avant que l'erreur ne traverse l'IPC), `err instanceof AppError`
   donne un accès direct à `.code`/`.detail` sans passer par le JSON — le detour n'existe que
   pour le franchissement de frontière.

   Convention unique retenue pour tout le contrat (AUDIT.md : « openRepo retourne { error },
   le reste throw — UNE convention ») : THROW partout, y compris openRepo (qui retournait
   `{ error }` avant ce refactor). Le payload JSON dans `.message` rend le throw aussi
   « structuré » qu'un retour l'aurait été, sans la piètre ergonomie d'un Result<T> à dérouler
   sur chaque canal — la majorité des canaux jetaient déjà. */

export type ErrorCode =
  | "NOT_A_REPO"
  | "NO_REPO"
  | "NOT_ALLOWED"
  | "BAD_ARG"
  | "BUSY"
  | "MERGE_CONFLICT"
  | "STASH_POP_CONFLICT"
  | "NOT_FLOW_BRANCH"
  | "NO_UPSTREAM"
  | "TIMEOUT"
  | "ABORTED"
  | "OUTPUT_LIMIT"
  | "GIT_FAILED"
  | "UNKNOWN"

/** Le detail reste factuel (nom de branche, ligne fatal: de git, code de sortie…), jamais une
    phrase — c'est au renderer de composer le message affiché, dans sa langue. */
export interface ErrorPayload {
  code: ErrorCode
  detail?: string
}

export class AppError extends Error {
  readonly code: ErrorCode
  readonly detail?: string

  constructor(code: ErrorCode, detail?: string) {
    super(JSON.stringify({ code, detail } satisfies ErrorPayload))
    this.name = "AppError"
    this.code = code
    this.detail = detail
  }
}

function isErrorPayload(v: unknown): v is ErrorPayload {
  return !!v && typeof v === "object" && typeof (v as { code?: unknown }).code === "string"
}

/** Reconstitue `{ code, detail }` depuis n'importe quelle erreur — une `AppError` locale (main,
    avant l'IPC), ou l'`Error` générique qu'Electron reconstruit côté renderer après une
    traversée d'IPC. Vérifié empiriquement (Electron 43) : le `.message` reçu n'est PAS le JSON
    nu que documente `electron.d.ts` (« only the message property... is provided ») — Electron y
    ajoute un préfixe, `Error invoking remote method 'canal': AppError: {"code":…}`. On extrait
    donc la sous-chaîne entre la première `{` et la dernière `}` plutôt que de parser le message
    entier : robuste au préfixe exact (qui pourrait varier d'une version d'Electron à l'autre),
    et sans risque vis-à-vis d'un `detail` qui contiendrait lui-même des accolades (il est
    échappé à l'intérieur du JSON, donc avant la dernière accolade fermante). Toute erreur qui
    ne colle pas à ce format (bug, exception non prévue) retombe sur `UNKNOWN`. */
export function decodeError(err: unknown): ErrorPayload {
  if (err instanceof AppError) return { code: err.code, detail: err.detail }
  if (err instanceof Error) {
    const start = err.message.indexOf("{")
    const end = err.message.lastIndexOf("}")
    if (start !== -1 && end > start) {
      try {
        const parsed: unknown = JSON.parse(err.message.slice(start, end + 1))
        if (isErrorPayload(parsed)) return parsed
      } catch {
        /* accolades présentes mais pas notre JSON : message brut d'une erreur non structurée */
      }
    }
    return { code: "UNKNOWN", detail: err.message }
  }
  return { code: "UNKNOWN", detail: String(err) }
}
