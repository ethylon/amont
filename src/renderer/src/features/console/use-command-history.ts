/* The console's typed-command input: controlled value, submit to `repo:console`, and
   Up/Down history recall. The input sends the raw string; parsing and the security policy
   (builtin allowlist, no shell, dangerous flags refused) live main-side in git/console.ts —
   output streams back on the same trace feed as the GUI's own commands. */

import { useCallback, useRef, useState } from "react"
import type { ChangeEvent, FormEvent, KeyboardEvent } from "react"

import { repoApi } from "@/lib/git"
import { decodeError, describeError } from "@/lib/errors"
import { messages } from "@/lib/messages"

/* session-local history of typed commands, Up/Down like a terminal — bounded like the
   trace buffer's `lines` (use-trace-buffer.ts) */
const HISTORY_CAP = 50

export function useCommandHistory(repoId: number) {
  const [cmd, setCmd] = useState("")
  const [cmdError, setCmdError] = useState<string | null>(null)
  const historyRef = useRef<string[]>([])
  /* -1 = live draft; otherwise an index into the history being recalled */
  const histIdxRef = useRef(-1)
  const draftRef = useRef("")

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const text = cmd.trim()
      if (!text) return
      /* terminal feel: the input clears immediately, the echo is the `$ git …` trace line
         main emits — no separate optimistic echo that could disagree with what actually ran */
      setCmd("")
      setCmdError(null)
      const h = historyRef.current
      if (h[h.length - 1] !== text) h.push(text)
      if (h.length > HISTORY_CAP) h.shift()
      histIdxRef.current = -1
      repoApi(repoId)
        .consoleRun(text)
        .catch((err: unknown) => {
          /* a command git actually ran also traces its own failure above; the inline line is
             the only feedback for commands the policy refused (which never reach git) */
          const p = decodeError(err)
          if (p.code === "NOT_ALLOWED") setCmdError(messages.console.blocked(p.detail ?? text))
          else if (p.code === "BAD_ARG") setCmdError(messages.console.invalid(p.detail ?? text))
          else setCmdError(describeError(err))
        })
    },
    [cmd, repoId]
  )

  /* Up/Down recall, like a terminal: Up walks back saving the in-progress draft, Down walks
     forward and lands back on the draft past the newest entry. Editing resets to draft mode. */
  const onCmdKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      const h = historyRef.current
      if (e.key === "ArrowUp") {
        if (!h.length || histIdxRef.current === 0) return
        e.preventDefault()
        if (histIdxRef.current === -1) {
          draftRef.current = cmd
          histIdxRef.current = h.length - 1
        } else {
          histIdxRef.current--
        }
        setCmd(h[histIdxRef.current])
      } else if (e.key === "ArrowDown") {
        if (histIdxRef.current === -1) return
        e.preventDefault()
        histIdxRef.current++
        if (histIdxRef.current >= h.length) {
          histIdxRef.current = -1
          setCmd(draftRef.current)
        } else {
          setCmd(h[histIdxRef.current])
        }
      }
    },
    [cmd]
  )

  /* editing resets to draft mode (see the recall above) */
  const onCmdChange = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    setCmd(e.target.value)
    histIdxRef.current = -1
  }, [])

  return { cmd, cmdError, submit, onCmdKeyDown, onCmdChange }
}
