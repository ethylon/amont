/* The bridge between the declarative menus and the foreground repository. Runs the same
   flow/status queries RepoView uses (shared cache keys — no extra fetch), classifies HEAD, and
   packages it all — plus the menu-triggered actions — into the `MenuRepo` the Repository menu
   reads. `null` whenever the foreground tab isn't a repo. Consumed by AppMenu (not App): these
   queries refetch on every git change, and subscribing App to them re-rendered every mounted
   tab for a menu-only concern (perf audit, finding 4d) — `build(ctx)` stays a pure function of
   live state either way. */

import { useMemo } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"

import { repoApi } from "@/lib/git"
import { branchFlow } from "@/lib/gitflow"
import { queryKeys } from "@/lib/queries"
import { useFlowInfoQuery } from "@/features/flow/flow-queries"
import type { RepoCommand } from "@/features/repo/repo-commands"
import type { MenuRepo } from "@/app/menu/types"

export function useMenuRepo(
  activeRepoId: number | null,
  send: (repoId: number, command: RepoCommand) => void
): MenuRepo | null {
  /* a stable placeholder id keeps the hooks unconditional; `enabled` gates the actual fetch */
  const id = activeRepoId ?? -1
  const api = useMemo(() => repoApi(id), [id])
  const enabled = activeRepoId != null

  const flowPrefixes =
    useQuery({ queryKey: queryKeys.flow(id), queryFn: () => api.flow(), enabled, placeholderData: keepPreviousData })
      .data ?? null
  const status =
    useQuery({
      queryKey: queryKeys.status(id),
      queryFn: () => api.status(),
      enabled,
      placeholderData: keepPreviousData,
    }).data ?? null
  const branch = status?.branch ?? null
  const workFlow = branch ? branchFlow(branch, flowPrefixes) : null
  const flowInfo = useFlowInfoQuery(api, id, enabled ? branch : null, enabled ? workFlow : null).data ?? null

  return useMemo(() => {
    if (activeRepoId == null) return null
    return {
      id: activeRepoId,
      flowPrefixes,
      branch,
      workFlow,
      flowInfo,
      initFlow: () => send(activeRepoId, { type: "flowInit" }),
      startFlow: (kind) => send(activeRepoId, { type: "flowStart", kind }),
      finishFlow: (name) => send(activeRepoId, { type: "flowFinish", name }),
      publishFlow: (kind, name) => send(activeRepoId, { type: "flowPublish", kind, name }),
      openStats: () => send(activeRepoId, { type: "stats" }),
      verifyDatabase: () => send(activeRepoId, { type: "maint", op: "fsck" }),
      compactDatabase: () => send(activeRepoId, { type: "maint", op: "gc" }),
    }
  }, [activeRepoId, flowPrefixes, branch, workFlow, flowInfo, send])
}
