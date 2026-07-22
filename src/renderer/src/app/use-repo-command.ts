/* Menu → active repo: a menu item can't reach into a RepoView (different subtree), so it
   dispatches a nonce-stamped command that the foreground RepoView executes through its store. */

import { useCallback, useRef, useState } from "react"

import type { RepoCommand, RepoCommandEnvelope } from "@/features/repo/repo-commands"

export function useRepoCommand() {
  const cmdSeq = useRef(0)
  const [repoCommand, setRepoCommand] = useState<RepoCommandEnvelope | null>(null)
  const sendRepoCommand = useCallback(
    (repoId: number, command: RepoCommand) => setRepoCommand({ repoId, command, nonce: ++cmdSeq.current }),
    []
  )
  return { repoCommand, sendRepoCommand }
}
