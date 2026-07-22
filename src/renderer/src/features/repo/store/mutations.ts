/* Every git mutation the store wraps. The "git op → invalidate → hardReload → error badge"
   quartet, copy-pasted four times in the old repo-view.tsx (checkout, stash, branch — the
   commit has its own shape in draft.ts, a failure doesn't reload there), is `runGitAction`;
   `runFlow` is its inline-error variant for the surfaces that show the failure themselves
   and stay open (git-flow banners, create dialogs). */

import { describeError } from "@/lib/errors"
import type { FlowPrefixes } from "@/lib/git"
import { messages } from "@/lib/messages"
import { invalidateRepo, invalidateWtDiffs, queryKeys } from "@/lib/queries"
import { queryClient } from "@/lib/query-client"

import type { ActionCtx, RepoStoreState } from "../repo-store"

type MutationActions = Pick<
  RepoStoreState,
  | "runGitAction"
  | "runFlow"
  | "runStash"
  | "runBranch"
  | "runFlowPublish"
  | "deleteBranch"
  | "deleteRemoteBranch"
  | "deleteTag"
  | "createBranch"
  | "createTag"
  | "resetTo"
  | "revertCommit"
  | "cherryPickCommit"
  | "checkout"
  | "runWt"
  | "runDiscard"
  | "runWorktree"
  | "openWorktree"
  | "addWorktree"
  | "addWorktreeFrom"
  | "restoreFile"
  | "resolveConflict"
  | "abortMerge"
>

export function createMutationActions({ set, get, api, repoId, onOpenRepo }: ActionCtx): MutationActions {
  return {
    async runGitAction(action, opts) {
      /* a branch pull/push/delete streams `--progress` into the footer (via onProgress); clear any
         leftover before, and once the action settles, so the live percentage never outlives it */
      get().setOpProgress(null)
      const err = await action().then(() => null, describeError)
      get().setOpProgress(null)
      if (!err) opts?.onSuccess?.()
      invalidateRepo(queryClient, repoId)
      await get().hardReload()
      if (err) get().showOp(err, "danger")
    },

    async runFlow(action) {
      get().setFlowBusy(true)
      const err = await action().then(() => null, describeError)
      get().setFlowBusy(false)
      invalidateRepo(queryClient, repoId)
      await get().hardReload()
      return err
    },

    runStash(action, name) {
      return get().runGitAction(() => api.stash(action, name), {
        onSuccess: () => {
          if (action === "push") set((s) => ({ commitDraft: { ...s.commitDraft, subject: "" } }))
        },
      })
    },

    runBranch(action, name) {
      if (action !== "finish") return get().runGitAction(() => api.branch(action, name))
      /* a feature/bugfix finish never runs straight away: every entry point (menu, sidebar
         shortcut, refs menu) lands here, and the flow banner rolls to its confirmation row
         instead — the submit goes through `api.flowFinish` with the chosen options. The kind
         comes from the flow query's cache: the finish entry points only exist once it's loaded. */
      const prefixes = queryClient.getQueryData<FlowPrefixes | null>(queryKeys.flow(repoId))
      const kind = prefixes && (["feature", "bugfix"] as const).find((k) => prefixes[k] && name.startsWith(prefixes[k]))
      if (kind) {
        get().openFlowFinish(name, kind)
        return Promise.resolve()
      }
      /* release/hotfix keep the plain `git flow finish`, flagged so the flow banner animates
         while it runs (merge + tag + back-merge can take a while) */
      return get().runGitAction(async () => {
        get().setFlowBusy(true)
        try {
          await api.branch("finish", name)
        } finally {
          get().setFlowBusy(false)
        }
      })
    },

    runFlowPublish(kind, name) {
      return get().runGitAction(async () => {
        get().setFlowBusy(true)
        try {
          await api.flowPublish(kind, name)
        } finally {
          get().setFlowBusy(false)
        }
      })
    },

    deleteBranch(name, deleteRemote) {
      return get().runGitAction(() => api.branchDelete(name, deleteRemote))
    },

    deleteRemoteBranch(name) {
      return get().runGitAction(() => api.remoteBranchDelete(name))
    },

    deleteTag(name, remote) {
      return get().runGitAction(() => api.tagDelete(name, remote))
    },

    /* through runFlow, not runGitAction: the create surfaces (banner, tag dialog) show the
       error inline and stay open for a correction, like the git-flow start banner */
    createBranch(name, from, checkout) {
      return get().runFlow(() => api.branchCreate(name, from, checkout))
    },

    createTag(name, at) {
      return get().runFlow(() => api.tagCreate(name, at))
    },

    resetTo(mode, to) {
      return get().runGitAction(() => api.reset(mode, to))
    },

    revertCommit(hash) {
      return get().runGitAction(() => api.revert(hash))
    },

    cherryPickCommit(hash) {
      return get().runGitAction(() => api.cherryPick(hash))
    },

    checkout(name) {
      return get().runGitAction(() => api.checkout(name))
    },

    async runWt(act, paths) {
      try {
        await api[act](paths)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
    },

    /* Same shape as runWt (failure = badge, no reload), plus: the diff caches refresh — the
       discarded file's diff may be on screen — and a diff open on a discarded path closes,
       there is nothing left to show. */
    async runDiscard(paths, untracked) {
      try {
        await api.discard(paths, untracked)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      const open = get().ui.diff
      if (open && "wt" in open.ctx && [...paths, ...untracked].includes(open.file.path))
        set((s) => ({ ui: { ...s.ui, diff: null } }))
      await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
      /* wt diffs only: the discard touched the tree/index, never a commit↔commit diff */
      invalidateWtDiffs(queryClient, repoId)
    },

    runWorktree(action, path) {
      return get().runGitAction(() => api.worktreeAct(action, path))
    },

    async openWorktree(path) {
      try {
        onOpenRepo(await api.worktreeOpen(path))
      } catch (e) {
        get().showOp(describeError(e), "danger")
      }
    },

    async addWorktree(branch) {
      let repo
      try {
        repo = await api.worktreeAdd(branch)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      if (!repo) return // dialog cancelled
      invalidateRepo(queryClient, repoId)
      /* soft reload: the new worktree opens as its own tab — this tab only needs the chip to
         appear on its branch tip, not a view/diff teardown */
      await get().reload()
      onOpenRepo(repo)
    },

    /* same flow as addWorktree, but the error goes back to the banner (inline, correctable)
       instead of the status badge — a cancelled picker counts as done, the banner closes */
    async addWorktreeFrom(branch, from) {
      let repo
      try {
        repo = await api.worktreeAddFrom(branch, from)
      } catch (e) {
        return describeError(e)
      }
      if (!repo) return null // dialog cancelled
      invalidateRepo(queryClient, repoId)
      await get().reload()
      onOpenRepo(repo)
      return null
    },

    /* Same shape as runDiscard (failure = badge, no reload): the restore only moves working
       files, the graph has nothing to relayout — the worktree row updates through its own
       invalidation. A success badge names the path: unlike a discard, nothing else on screen
       makes the outcome visible when the staging panel is closed. */
    async restoreFile(hash, path) {
      try {
        await api.restore(hash, path)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      get().showOp(messages.detail.restored(path), "primary")
      await queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) })
      /* wt diffs only: the restore touched the tree, never a commit↔commit diff */
      invalidateWtDiffs(queryClient, repoId)
    },

    /* Same shape as runWt (failure = badge, no reload): resolving only moves the file from
       `conflicts` to `staged`, the graph has nothing to relayout. The conflict cache is
       invalidated here rather than in `invalidateRepo` — a background refetch elsewhere
       would clobber an in-progress edit of another file (cf. conflict-queries.ts). */
    async resolveConflict(path, content) {
      try {
        await api.resolve(path, content)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      set((s) => ({ ui: { ...s.ui, conflict: null } }))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.worktree(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.conflictAll(repoId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mergeState(repoId) }),
      ])
    },

    abortMerge() {
      return get().runGitAction(() => api.mergeAbort())
    },
  }
}
