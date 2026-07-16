/* The foreground repository's end of the app-menu command channel. Owns the transient UI the
   Repository menu drives — the init modal, the stats modal, and the live maintenance job — and
   executes the fire-and-forget commands (finish/publish/start) through the repo store (the
   inline start banner's state lives there: the sidebar's flow shortcut opens it too). A single
   hook, consumed by RepoView, so the surfaces stay thin. */

import { useCallback, useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { describeError } from "@/lib/errors"
import { onProgress, type MaintKind, type RepoApi } from "@/lib/git"
import { messages } from "@/lib/messages"
import { queryKeys } from "@/lib/queries"
import type { RepoCommandEnvelope } from "@/features/repo/repo-commands"
import { useRepoStoreApi } from "@/features/repo/repo-store"
import type { MaintState } from "@/features/maintenance/maintenance-status"

export interface RepoMenuTools {
  initOpen: boolean
  statsOpen: boolean
  maint: MaintState | null
  closeInit(): void
  setStatsOpen(open: boolean): void
  runMaint(op: MaintKind): void
}

const DONE_TEXT: Record<MaintKind, () => string> = {
  fsck: () => messages.maintenance.verified,
  gc: () => messages.maintenance.compacted,
}

export function useRepoMenuTools(api: RepoApi, repoId: number, command: RepoCommandEnvelope | null): RepoMenuTools {
  const storeApi = useRepoStoreApi()
  const queryClient = useQueryClient()
  const [initOpen, setInitOpen] = useState(false)
  const [statsOpen, setStatsOpen] = useState(false)
  const [maint, setMaint] = useState<MaintState | null>(null)

  const runMaint = useCallback(
    (op: MaintKind) => {
      setMaint({ op, percent: null, running: true, result: null })
      void (op === "fsck" ? api.fsck() : api.gc()).then(
        () => {
          setMaint({ op, percent: 100, running: false, result: { ok: true, text: DONE_TEXT[op]() } })
          /* the object DB just changed: the still-open stats modal reflects it on refetch */
          if (op === "gc") void queryClient.invalidateQueries({ queryKey: queryKeys.countObjects(repoId) })
        },
        (e) => setMaint({ op, percent: null, running: false, result: { ok: false, text: describeError(e) } })
      )
    },
    [api, queryClient, repoId]
  )

  /* live percentage from git's stderr while a job runs (a late event past completion is ignored) */
  useEffect(
    () =>
      onProgress((p) => {
        if (p.id !== repoId) return
        setMaint((m) => (m && m.running && m.op === p.op ? { ...m, percent: p.percent } : m))
      }),
    [repoId]
  )

  /* clear the completion/error notice after a short while */
  useEffect(() => {
    if (!maint || maint.running || !maint.result) return
    const t = window.setTimeout(() => setMaint(null), 6000)
    return () => clearTimeout(t)
  }, [maint])

  /* dispatch a menu command exactly once — when its nonce changes and it's addressed to this repo */
  const lastNonce = useRef(0)
  useEffect(() => {
    if (!command || command.repoId !== repoId || command.nonce === lastNonce.current) return
    lastNonce.current = command.nonce
    const c = command.command
    switch (c.type) {
      case "flowInit":
        setInitOpen(true)
        break
      case "flowStart":
        storeApi.getState().openFlowStart(c.kind, c.base)
        break
      case "stats":
        setStatsOpen(true)
        break
      case "flowFinish":
        void storeApi.getState().runBranch("finish", c.name)
        break
      case "flowPublish":
        void storeApi.getState().runGitAction(() => api.flowPublish(c.kind, c.name))
        break
      case "maint":
        runMaint(c.op)
        break
    }
  }, [command, repoId, api, storeApi, runMaint])

  const closeInit = useCallback(() => setInitOpen(false), [])

  return { initOpen, statsOpen, maint, closeInit, setStatsOpen, runMaint }
}
