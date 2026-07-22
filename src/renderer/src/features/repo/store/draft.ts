/* The commit draft: subject/description/amend, and the two message-writing commands that
   consume it (`doCommit`) or bypass it (`rewordHead`). They live together because of
   `draftBackup` — the draft set aside while an amend borrows the last commit's message. */

import { describeError } from "@/lib/errors"
import { invalidateRepo, invalidateWtDiffs } from "@/lib/queries"
import { queryClient } from "@/lib/query-client"

import type { ActionCtx, RepoStoreState } from "../repo-store"

type DraftActions = Pick<RepoStoreState, "setSubject" | "setDescription" | "toggleAmend" | "doCommit" | "rewordHead">

export function createDraftActions({ set, get, api, repoId }: ActionCtx): DraftActions {
  /* message draft set aside while an amend borrows the last commit's */
  let draftBackup: { subject: string; description: string } | null = null

  return {
    setSubject(v) {
      set((s) => ({ commitDraft: { ...s.commitDraft, subject: v } }))
    },
    setDescription(v) {
      set((s) => ({ commitDraft: { ...s.commitDraft, description: v } }))
    },
    async toggleAmend(on) {
      if (!on) {
        const draft = draftBackup
        draftBackup = null
        set(() => ({
          commitDraft: { subject: draft?.subject ?? "", description: draft?.description ?? "", amend: false },
        }))
        return
      }
      const msg = await api.headMessage().catch(() => null)
      if (!msg) return
      draftBackup = { subject: get().commitDraft.subject, description: get().commitDraft.description }
      set(() => ({ commitDraft: { subject: msg.subject, description: msg.body, amend: true } }))
    },

    async doCommit() {
      const { subject, description, amend } = get().commitDraft
      const subj = subject.trim()
      const body = description.trim()
      try {
        await api.commit(body ? `${subj}\n\n${body}` : subj, amend)
      } catch (e) {
        get().showOp(describeError(e), "danger")
        return
      }
      set(() => ({ commitDraft: { subject: "", description: "", amend: false } }))
      draftBackup = null
      /* a staged-source diff shows content that just left the tree — close it; unstaged/
         untracked files weren't touched by the commit, their diff stays */
      const open = get().ui.diff
      if (open && "wt" in open.ctx && open.ctx.wt === "staged") set((s) => ({ ui: { ...s.ui, diff: null } }))
      invalidateRepo(queryClient, repoId)
      invalidateWtDiffs(queryClient, repoId)
      /* soft reload: committing from the staging panel must not eject the user from it — with
         nothing left to commit, RepoView's emptied-tree effect switches views on its own */
      await get().reload()
    },

    async rewordHead(subject, description) {
      const subj = subject.trim()
      const body = description.trim()
      const err = await api.reword(body ? `${subj}\n\n${body}` : subj).then(() => null, describeError)
      if (err) return err
      invalidateRepo(queryClient, repoId)
      /* soft reload: the edit happens in the side panel, nothing to tear down; the reload's
         re-resolution drops the selection (the amended hash no longer exists), so re-anchor
         it on the new HEAD — the panel keeps showing the commit that was just reworded */
      await get().reload()
      const head = await api.status().then(
        (s) => s.head,
        () => null
      )
      if (head) await get().graphRef.current?.jumpTo(head)
      return null
    },
  }
}
