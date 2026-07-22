/* The `ui` slice's open/close switches: view toggles, the inline banners (flow start/finish,
   branch/worktree/release create, remote-ahead), and the overlay slot (diff / conflict /
   file-history — mutually exclusive, cf. RepoStoreState.ui). Pure state flips; anything that
   also runs git lives in mutations.ts. */

import { prefs } from "@/lib/prefs"

import type { ActionCtx, RepoStoreState } from "../repo-store"

type DialogActions = Pick<
  RepoStoreState,
  | "toggleSidebar"
  | "showCommits"
  | "openFlowStart"
  | "closeFlowStart"
  | "openFlowFinish"
  | "closeFlowFinish"
  | "openBranchCreate"
  | "closeBranchCreate"
  | "openWorktreeCreate"
  | "closeWorktreeCreate"
  | "openReleaseCreate"
  | "closeReleaseCreate"
  | "openRemoteAhead"
  | "closeRemoteAhead"
  | "resolveRemoteAhead"
  | "openDiff"
  | "closeDiff"
  | "setDiffMode"
  | "openFileHistory"
  | "closeFileHistory"
  | "openConflict"
  | "closeConflict"
>

export function createDialogActions({ set, api }: ActionCtx): DialogActions {
  return {
    toggleSidebar() {
      set((s) => ({ ui: { ...s.ui, sidebarOpen: !s.ui.sidebarOpen } }))
    },
    showCommits() {
      set((s) => ({ ui: { ...s.ui, view: "commits" } }))
    },
    openFlowStart(kind, base) {
      set((s) => ({ ui: { ...s.ui, flowStart: { kind, base }, flowFinish: null } }))
    },
    closeFlowStart() {
      set((s) => ({ ui: { ...s.ui, flowStart: null } }))
    },
    openFlowFinish(branch, kind) {
      set((s) => ({ ui: { ...s.ui, flowFinish: { branch, kind }, flowStart: null } }))
    },
    closeFlowFinish() {
      set((s) => ({ ui: { ...s.ui, flowFinish: null } }))
    },
    openBranchCreate(from) {
      set((s) => ({ ui: { ...s.ui, branchCreate: { from }, worktreeCreate: null } }))
    },
    closeBranchCreate() {
      set((s) => ({ ui: { ...s.ui, branchCreate: null } }))
    },
    openWorktreeCreate(from) {
      set((s) => ({ ui: { ...s.ui, worktreeCreate: { from }, branchCreate: null } }))
    },
    closeWorktreeCreate() {
      set((s) => ({ ui: { ...s.ui, worktreeCreate: null } }))
    },
    openReleaseCreate(branches) {
      if (!branches.length) return
      set((s) => ({ ui: { ...s.ui, releaseCreate: { branches } } }))
    },
    closeReleaseCreate() {
      set((s) => ({ ui: { ...s.ui, releaseCreate: null } }))
    },
    openRemoteAhead(behind) {
      set((s) => ({ ui: { ...s.ui, remoteAhead: { behind } } }))
    },
    closeRemoteAhead() {
      set((s) => ({ ui: { ...s.ui, remoteAhead: null } }))
    },
    async resolveRemoteAhead(choice) {
      /* close before running: the op's own feedback takes over (footer, badges), and a pull
         that leaves the remote still ahead would re-raise the banner on the next push anyway */
      set((s) => ({ ui: { ...s.ui, remoteAhead: null } }))
      if (choice === "pull") await api.op("pull", "ff")
      else await api.op("push", "force")
    },

    openDiff(ctx, file) {
      /* the overlay slot is exclusive: a diff opened while the history view is up replaces it */
      set((s) => ({ ui: { ...s.ui, diff: { ctx, file }, fileHistory: null } }))
    },
    closeDiff() {
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: null } }))
    },
    setDiffMode(v) {
      prefs.diffView.set(v)
      set((s) => ({ ui: { ...s.ui, diffMode: v } }))
    },
    openFileHistory(from, path) {
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: null, fileHistory: { path, from } } }))
    },
    closeFileHistory() {
      set((s) => ({ ui: { ...s.ui, fileHistory: null } }))
    },
    openConflict(file) {
      set((s) => ({ ui: { ...s.ui, diff: null, conflict: file } }))
    },
    closeConflict() {
      set((s) => ({ ui: { ...s.ui, conflict: null } }))
    },
  }
}
