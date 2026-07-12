/* Structured errors shared by the three processes (AUDIT.md §4, "main" workstream).

   Hard constraint from Electron (cf. electron.d.ts, `IpcMain.handle`): "Errors thrown through
   `handle` in the main process are not transparent as they are serialized and only the
   `message` property from the original error is provided to the renderer process." A throw
   therefore loses everything except `.message` when crossing the IPC boundary — impossible to
   attach `code`/`detail` as separate properties.

   The workaround: `AppError` encodes its `{ code, detail }` payload as JSON INSIDE `.message`.
   What crosses the IPC boundary is therefore a JSON string; `decodeError` reconstructs it on
   the other side. Inside main (before the error crosses the IPC boundary), `err instanceof
   AppError` gives direct access to `.code`/`.detail` without going through the JSON — the
   detour only exists for crossing the boundary.

   Single convention adopted for the whole contract (AUDIT.md: "openRepo returns { error },
   everything else throws — ONE convention"): THROW everywhere, including openRepo (which used
   to return `{ error }` before this refactor). The JSON payload in `.message` makes the throw
   just as "structured" as a return value would have been, without the poor ergonomics of a
   Result<T> to unwrap on every channel — most channels already threw. */

export type ErrorCode =
  | "NOT_A_REPO"
  | "NO_REPO"
  | "NOT_ALLOWED"
  | "EXISTS"
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

/** The detail stays factual (branch name, git's fatal: line, exit code…), never a
    sentence — it's up to the renderer to compose the displayed message, in its own language. */
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

/** Reconstructs `{ code, detail }` from any error — a local `AppError` (main,
    before IPC), or the generic `Error` that Electron reconstructs on the renderer side after
    an IPC crossing. Verified empirically (Electron 43): the `.message` received is NOT the
    bare JSON that `electron.d.ts` documents ("only the message property... is provided") —
    Electron prepends a prefix to it, `Error invoking remote method 'channel': AppError: {"code":…}`.
    We therefore extract the substring between the first `{` and the last `}` rather than
    parsing the entire message: robust to the exact prefix (which could vary between Electron
    versions), and safe regarding a `detail` that might itself contain braces (it's escaped
    inside the JSON, so before the last closing brace). Any error that doesn't fit this format
    (bug, unexpected exception) falls back to `UNKNOWN`. */
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
        /* braces present but not our JSON: raw message from an unstructured error */
      }
    }
    return { code: "UNKNOWN", detail: err.message }
  }
  return { code: "UNKNOWN", detail: String(err) }
}
