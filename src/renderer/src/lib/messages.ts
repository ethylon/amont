/* User-facing UI strings (AUDIT.md §9, open-source readiness — language pass). The single
   catalogue: every label, placeholder, and hint lives here instead of being inlined at each call
   site. One place to read what the app says, one place to change it — and, now, one place to
   translate it.

   Each string is a Lingui `t` template (plurals via `plural`); `lingui extract` collects them into
   the PO catalogs under ./locales, and the active locale is chosen at boot from the system language
   (cf. lib/i18n.ts). Entries are getters/functions so they re-read the active locale on access.
   Dates/numbers still follow the system locale; backend-error text lives in lib/errors.ts. */

import { t, plural } from "@lingui/core/macro"

export const messages = {
  app: {
    get somethingWentWrong() {
      return t`Something went wrong`
    },
    get unexpectedError() {
      return t`Unexpected error.`
    },
    get reload() {
      return t`Reload`
    },
    get reloadTab() {
      return t`Reload tab`
    },
    get home() {
      return t`Home`
    },
    closeTab: (name: string) => t`Close ${name}`,
    get newTab() {
      return t`New tab`
    },
    newCommits: (n: number) => plural(n, { one: "# new commit", other: "# new commits" }),
  },

  home: {
    get noRepos() {
      return t`No repositories`
    },
    get chooseRootHint() {
      return t`Choose a root folder to list the repositories it contains, or open one directly.`
    },
    get chooseRoot() {
      return t`Choose a root folder…`
    },
    get openRepo() {
      return t`Open a repository…`
    },
    get openInNewTab() {
      return t`Open a repository in a new tab.`
    },
    get recents() {
      return t`Recent`
    },
    get rootFolder() {
      return t`Root folder`
    },
    get change() {
      return t`Change…`
    },
    get choose() {
      return t`Choose…`
    },
    get noRootFolder() {
      return t`No root folder. Choose one to list its repositories.`
    },
    get scanningRepos() {
      return t`scanning for repositories…`
    },
    get noReposFoundUnderRoot() {
      return t`No repositories found under this root.`
    },
  },

  create: {
    get title() {
      return t`Create a repository`
    },
    get intro() {
      return t`Create a local repository, a bare remote repository, or clone an existing one.`
    },
    get destination() {
      return t`Destination folder`
    },
    get destinationHint() {
      return t`New repositories and clones are created inside this folder.`
    },
    get noDestination() {
      return t`Choose a destination folder first.`
    },
    get localTitle() {
      return t`Local repository`
    },
    get localHint() {
      return t`Initialize an empty repository in a new folder.`
    },
    get bareTitle() {
      return t`Remote repository (bare)`
    },
    get bareHint() {
      return t`A repository without a working tree, ready to be used as a remote.`
    },
    get cloneTitle() {
      return t`Clone a repository`
    },
    get cloneHint() {
      return t`Clone an existing repository from a URL or a local path.`
    },
    get name() {
      return t`Name`
    },
    get url() {
      return t`URL`
    },
    get urlPlaceholder() {
      return t`https://… or git@…`
    },
    get create() {
      return t`Create`
    },
    get clone() {
      return t`Clone`
    },
    get creating() {
      return t`creating…`
    },
    get cloning() {
      return t`cloning…`
    },
    createdAt: (path: string) => t`Repository created: ${path}`,
  },

  repo: {
    get clickCommitForDetail() {
      return t`Click a commit for its detail.`
    },
    get hideSidebar() {
      return t`Hide sidebar`
    },
    get showSidebar() {
      return t`Show sidebar`
    },
    get flatView() {
      return t`Flat view`
    },
    get treeView() {
      return t`Tree view`
    },
    get openInFileExplorer() {
      return t`Open in file explorer`
    },
    fileCount: (n: number) => plural(n, { 0: "no files", one: "# file", other: "# files" }),
  },

  detail: {
    get loadingFiles() {
      return t`loading files…`
    },
    branchHeading: (n: number) => t`Branch · ${plural(n, { one: "# commit", other: "# commits" })}`,
    commitsSelected: (n: number) => plural(n, { one: "# commit selected", other: "# commits selected" }),
    unmergedSuffix: (refs: string) => t`${refs} · unmerged`,
    get unmergedSegment() {
      return t`unmerged segment`
    },
    merged: (refs: string | null, mergedInto: string | null, hash: string) => {
      const core = mergedInto ? t`merged into ${mergedInto}` : t`merged`
      return `${refs ? refs + " · " : ""}${core} (${hash})`
    },
    get commit() {
      return t`commit`
    },
    get author() {
      return t`author`
    },
    get coAuthors() {
      return t`co-authors`
    },
    get date() {
      return t`date`
    },
    get parent() {
      return t`parent`
    },
    get parents() {
      return t`parents`
    },
    get root() {
      return t`(root)`
    },
    /* leading indent is structural alignment, kept outside the translated text */
    get firstParent() {
      return "  " + t`(first-parent)`
    },
    get mergeParent() {
      return "  " + t`(merge)`
    },
  },

  console: {
    get ready() {
      return t`Ready`
    },
    get gitConsole() {
      return t`Git console`
    },
    get clear() {
      return t`Clear`
    },
    get close() {
      return t`Close`
    },
    get noCommandsYet() {
      return t`No commands yet.`
    },
    get failed() {
      return t`✗ failed`
    },
    commandFailed: (cmd: string) => t`Command failed: ${cmd}`,
  },

  diff: {
    get unified() {
      return t`Unified diff`
    },
    get sideBySide() {
      return t`Side by side`
    },
    get close() {
      return t`Close (Esc)`
    },
    get unavailable() {
      return t`Diff unavailable.`
    },
    get empty() {
      return t`Empty diff.`
    },
    get loading() {
      return t`diff…`
    },
    truncated: (n: string) => t`… ${n} lines truncated`,
  },

  search: {
    get placeholder() {
      return t`Filter commits — message, author, hash`
    },
    get searchDiffContent() {
      return t`Also search diff content`
    },
    get prevResult() {
      return t`Previous result`
    },
    get nextResult() {
      return t`Next result`
    },
    error: (msg: string) => t`Error: ${msg}`,
    get errorShort() {
      return t`error`
    },
    get noResults() {
      return t`No results`
    },
    results: (n: number) => plural(n, { one: "# result", other: "# results" }),
  },

  refs: {
    get branches() {
      return t`Branches`
    },
    get remotes() {
      return t`Remotes`
    },
    get tags() {
      return t`Tags`
    },
    get filterBranches() {
      return t`Filter branches`
    },
    get checkout() {
      return t`Checkout`
    },
    mergeInto: (branch: string) => t`Merge into « ${branch} »`,
    get pull() {
      return t`Pull`
    },
    get push() {
      return t`Push`
    },
    pushTo: (upstream: string) => t`Push to « ${upstream} »`,
    get deleteBranch() {
      return t`Delete branch`
    },
    get finishFeature() {
      return t`Finish feature`
    },
    get finishBugfix() {
      return t`Finish bugfix`
    },
    get finishRelease() {
      return t`Finish release`
    },
    get finishHotfix() {
      return t`Finish hotfix`
    },
    get branchesUnavailable() {
      return t`Branches unavailable.`
    },
    get loadingBranches() {
      return t`branches…`
    },
    get noMatchingRef() {
      return t`No matching ref.`
    },
  },

  stash: {
    get apply() {
      return t`Apply`
    },
    get applyAndDrop() {
      return t`Apply and drop`
    },
    get drop() {
      return t`Drop`
    },
  },

  worktree: {
    get stage() {
      return t`Stage`
    },
    get unstage() {
      return t`Unstage`
    },
    get stageFolder() {
      return t`Stage folder`
    },
    get unstageFolder() {
      return t`Unstage folder`
    },
    get uncommittedChanges() {
      return t`Uncommitted changes`
    },
    get stashChanges() {
      return t`Stash changes (git stash push -u)`
    },
    get unstaged() {
      return t`Unstaged`
    },
    get noChangesToStage() {
      return t`No changes to stage.`
    },
    get staged() {
      return t`Staged`
    },
    get stageAll() {
      return t`Stage all`
    },
    get unstageAll() {
      return t`Unstage all`
    },
    get noStagedFiles() {
      return t`No staged files.`
    },
    get resolveConflictsFirst() {
      return t`Resolve conflicts before committing.`
    },
    get commitMessage() {
      return t`Commit message`
    },
    get amend() {
      return t`Amend`
    },
    get commit() {
      return t`Commit`
    },
    commitCaption: (verb: string, staged: number) =>
      staged ? `${verb} · ${plural(staged, { one: "# file", other: "# files" })}` : verb,
  },

  conflict: {
    get conflicts() {
      return t`Conflicts`
    },
    /* the A/B letters are deliberately literal (not translated): they're the visual anchor
       shared by the banner, the pane headers and the per-conflict buttons */
    mergeBanner: (theirs: string, ours: string) => t`Merging ${theirs} (B) into ${ours} (A)`,
    get abortMerge() {
      return t`Abort merge`
    },
    sideA: (label: string) => t`A · ${label}`,
    sideB: (label: string) => t`B · ${label}`,
    get oursHint() {
      return t`ours — current branch`
    },
    get theirsHint() {
      return t`theirs — incoming`
    },
    get deletedOnThisSide() {
      return t`deleted on this side`
    },
    conflictN: (n: number) => t`Conflict ${n}`,
    get takeA() {
      return t`Take A`
    },
    get takeB() {
      return t`Take B`
    },
    get takeAllA() {
      return t`Take A in every conflict`
    },
    get takeAllB() {
      return t`Take B in every conflict`
    },
    get addLine() {
      return t`Add line to the output`
    },
    get removeLine() {
      return t`Remove line from the output`
    },
    get resetToSelection() {
      return t`Reset to selection`
    },
    get mergedOutput() {
      return t`Merged output — editable`
    },
    remaining: (n: number) => plural(n, { one: "# conflict remaining", other: "# conflicts remaining" }),
    get noMarkersLeft() {
      return t`No conflict markers left.`
    },
    get markResolved() {
      return t`Mark as resolved`
    },
    get restoreFile() {
      return t`Undo edits`
    },
    get unavailable() {
      return t`Conflict unavailable.`
    },
    get loading() {
      return t`conflict…`
    },
    get close() {
      return t`Close (Esc)`
    },
  },

  graph: {
    get extraRefs() {
      return t`Additional references`
    },
    extraRefsCount: (n: number) => plural(n, { one: "# additional reference", other: "# additional references" }),
    extraBranchesOnTip: (n: number) =>
      plural(n, {
        one: "# other branch on this tip",
        other: "# other branches on this tip",
      }),
    commitsLoaded: (loaded: string, total: string) => t`${loaded} of ${total} commits loaded`,
  },

  theme: {
    get light() {
      return t`Light theme`
    },
    get dark() {
      return t`Dark theme`
    },
  },

  menu: {
    get file() {
      return t`File`
    },
    get view() {
      return t`View`
    },
    get help() {
      return t`Help`
    },
    get newRepo() {
      return t`New repository…`
    },
    get openRepo() {
      return t`Open repository…`
    },
    get closeTab() {
      return t`Close tab`
    },
    get goHome() {
      return t`Home`
    },
    get darkTheme() {
      return t`Dark theme`
    },
    get reload() {
      return t`Reload`
    },
    get documentation() {
      return t`Documentation`
    },
    get sourceCode() {
      return t`Source code`
    },
    get reportIssue() {
      return t`Report an issue…`
    },
    about: (version: string) => t`Amont ${version}`,
  },

  flow: {
    minutes: (n: number) => t`${n} min`,
    hours: (n: number) => t`${n} h`,
    days: (n: number) => t`${n} d`,
    commitCount: (n: number) => plural(n, { 0: "no commits", one: "# commit", other: "# commits" }),
    to: (targets: string) => t`to ${targets}`,
    tag: (tag: string) => ` · ` + t`tag ${tag}`,
    get base() {
      return t`base`
    },
    get commits() {
      return t`commits`
    },
    get none() {
      return t`none`
    },
    get finishTargets() {
      return t`finish targets`
    },
    get finishTarget() {
      return t`finish target`
    },
    get expectedTag() {
      return t`expected tag`
    },
    inProgress: (kind: string, since: string | null) =>
      since ? t`${kind} in progress for ${since}` : t`${kind} in progress`,
  },
}
