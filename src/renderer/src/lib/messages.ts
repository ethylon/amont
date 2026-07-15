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
    get close() {
      return t`Close`
    },
    get loading() {
      return t`Loading`
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
    get fetch() {
      return t`Fetch`
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
    get stash() {
      return t`stash`
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

  /* footer feed while a network op runs — the live `--progress` occupant (fetch/pull/push),
     the counterpart of maintenance's "Verifying database…" (cf. features/repo/status-bar) */
  ops: {
    get fetching() {
      return t`Fetching…`
    },
    get pulling() {
      return t`Pulling…`
    },
    get pushing() {
      return t`Pushing…`
    },
  },

  console: {
    get ready() {
      return t`Ready`
    },
    /** fallback command name in the screen-reader failure announcement */
    get aCommand() {
      return t`a command`
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
    get imagePreview() {
      return t`Image preview`
    },
    get textDiff() {
      return t`Text diff`
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
    get stageHunk() {
      return t`Stage hunk`
    },
    get unstageHunk() {
      return t`Unstage hunk`
    },
    get stageLine() {
      return t`Stage line`
    },
    get unstageLine() {
      return t`Unstage line`
    },
    get discardHunk() {
      return t`Discard hunk`
    },
    get discardLine() {
      return t`Discard line`
    },
    get before() {
      return t`Before`
    },
    get after() {
      return t`After`
    },
    get imageAdded() {
      return t`Added`
    },
    get imageDeleted() {
      return t`Deleted`
    },
    get imageNone() {
      return t`No preview on this side`
    },
    get imageTooLarge() {
      return t`Too large to preview`
    },
    get imageUnavailable() {
      return t`Preview unavailable.`
    },
    /** e.g. "800 × 600" */
    dimensions: (w: number, h: number) => t`${w} × ${h}`,
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
    get deleteBranchTitle() {
      return t`Delete branch?`
    },
    deleteBranchBody: (name: string) => t`The branch « ${name} » will be deleted.`,
    deleteBranchRemote: (upstream: string) => t`Also delete the remote branch « ${upstream} »`,
    get deleteBranchRemoteGone() {
      return t`Its remote branch has already been deleted.`
    },
    get deleteBranchConfirm() {
      return t`Delete`
    },
    get deleteBranchCancel() {
      return t`Cancel`
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

  /* Linked worktrees (`git worktree`) — distinct from `worktree` below, the working-tree
     file status. */
  worktrees: {
    get title() {
      return t`Worktrees`
    },
    get openInTab() {
      return t`Open in a new tab`
    },
    get reveal() {
      return t`Reveal in file explorer`
    },
    get remove() {
      return t`Remove worktree`
    },
    get prune() {
      return t`Prune worktrees`
    },
    get create() {
      return t`Create worktree…`
    },
    get detached() {
      return t`detached HEAD`
    },
    /** tooltip of the row of the worktree already open in this tab */
    get currentTab() {
      return t`This worktree is open in this tab`
    },
    openWorktree: (name: string) => t`Open worktree « ${name} »`,
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
    get discardFolder() {
      return t`Discard folder`
    },
    get uncommittedChanges() {
      return t`Uncommitted changes`
    },
    get stash() {
      return t`Stash`
    },
    get moreActions() {
      return t`More actions`
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
    get discard() {
      return t`Discard changes`
    },
    get discardAll() {
      return t`Discard all`
    },
    get discardTitle() {
      return t`Discard changes?`
    },
    discardOne: (path: string) => t`Changes to « ${path} » will be permanently lost.`,
    discardMany: (n: number) =>
      plural(n, {
        one: "Changes to # file will be permanently lost.",
        other: "Changes to # files will be permanently lost.",
      }),
    discardUntracked: (n: number) =>
      plural(n, { one: "# untracked file will be deleted.", other: "# untracked files will be deleted." }),
    get discardConfirm() {
      return t`Discard`
    },
    get discardCancel() {
      return t`Cancel`
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
    get description() {
      return t`Description`
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
    /** accessible name of the commit-graph listbox */
    get commits() {
      return t`Commits`
    },
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

  settings: {
    get title() {
      return t`Settings`
    },
    get intro() {
      return t`Fetch behavior, applied to every repository.`
    },
    get autoFetch() {
      return t`Auto-fetch`
    },
    get autoFetchHint() {
      return t`Fetch from all remotes in the background, on a timer.`
    },
    get interval() {
      return t`Interval`
    },
    /** unit suffix beside the interval choices */
    get minutesUnit() {
      return t`min`
    },
    get prune() {
      return t`Prune on fetch`
    },
    get pruneHint() {
      return t`Drop remote-tracking branches that no longer exist on the remote.`
    },
    get crashReports() {
      return t`Send anonymous crash reports`
    },
    get crashReportsHint() {
      return t`Helps fix crashes. No repository contents, diffs, or credentials are ever sent.`
    },
  },

  /* the auto-update card (features/updater) */
  updater: {
    get checking() {
      return t`Checking for updates…`
    },
    get upToDate() {
      return t`Amont is up to date.`
    },
    downloading: (version: string) => t`Downloading Amont ${version}…`,
    ready: (version: string) => t`Amont ${version} is ready to install.`,
    get restartNow() {
      return t`Restart now`
    },
    get later() {
      return t`Later`
    },
    get failed() {
      return t`Update check failed.`
    },
    get unavailable() {
      return t`Updates are not available in this build.`
    },
    get dismiss() {
      return t`Dismiss`
    },
  },

  menu: {
    get file() {
      return t`File`
    },
    get view() {
      return t`View`
    },
    get repository() {
      return t`Repository`
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
    get checkForUpdates() {
      return t`Check for updates…`
    },
    about: (version: string) => t`Amont ${version}`,

    /* View ▸ Language / Theme (runtime switch) */
    get language() {
      return t`Language`
    },
    get english() {
      return t`English`
    },
    get french() {
      return t`Français`
    },
    get theme() {
      return t`Theme`
    },
    get themeLight() {
      return t`Light`
    },
    get themeDark() {
      return t`Dark`
    },
    get themeSystem() {
      return t`System`
    },

    /* Repository ▸ maintenance */
    get databaseStatistics() {
      return t`Database statistics…`
    },
    get verifyDatabase() {
      return t`Verify database`
    },
    get compactDatabase() {
      return t`Compact database`
    },

    /* Repository ▸ Git Flow */
    get gitFlow() {
      return t`Git Flow`
    },
    get initializeGitFlow() {
      return t`Initialize Git Flow…`
    },
    get flowFeature() {
      return t`Feature`
    },
    get flowBugfix() {
      return t`Bugfix`
    },
    get flowRelease() {
      return t`Release`
    },
    get flowHotfix() {
      return t`Hotfix`
    },
    get flowStart() {
      return t`Start…`
    },
    get flowFinish() {
      return t`Finish`
    },
    get flowPublish() {
      return t`Publish`
    },
    get startFeature() {
      return t`Start feature…`
    },
    get startHotfix() {
      return t`Start hotfix…`
    },
    finishFeatureNamed: (name: string) => t`Finish feature ${name}`,
    finishBugfixNamed: (name: string) => t`Finish bugfix ${name}`,
    finishReleaseNamed: (name: string) => t`Finish release ${name}`,
    finishHotfixNamed: (name: string) => t`Finish hotfix ${name}`,
    publishFeatureNamed: (name: string) => t`Publish feature ${name}`,
    publishBugfixNamed: (name: string) => t`Publish bugfix ${name}`,
    publishReleaseNamed: (name: string) => t`Publish release ${name}`,
    publishHotfixNamed: (name: string) => t`Publish hotfix ${name}`,
  },

  /* Git-flow surfaces driven by the Repository menu: the initialization modal and the inline
     start banner (distinct from `flow` above, which is the read-only cockpit banner/card). */
  gitflow: {
    get initializeTitle() {
      return t`Initialize Git Flow`
    },
    get initializeIntro() {
      return t`Choose the branch names and prefixes git-flow will use. The defaults follow the git-flow convention.`
    },
    get productionBranch() {
      return t`Production branch`
    },
    get developmentBranch() {
      return t`Development branch`
    },
    get featurePrefix() {
      return t`Feature prefix`
    },
    get bugfixPrefix() {
      return t`Bugfix prefix`
    },
    get releasePrefix() {
      return t`Release prefix`
    },
    get hotfixPrefix() {
      return t`Hotfix prefix`
    },
    get supportPrefix() {
      return t`Support prefix`
    },
    get versionTagPrefix() {
      return t`Version tag prefix`
    },
    get initialize() {
      return t`Initialize`
    },
    get initializing() {
      return t`initializing…`
    },
    get cancel() {
      return t`Cancel`
    },
    get start() {
      return t`Start`
    },
    get starting() {
      return t`starting…`
    },
    /* inline start banner — feature/bugfix take a name, release/hotfix a version */
    get namePlaceholder() {
      return t`name`
    },
    get versionPlaceholder() {
      return t`version`
    },
    startLabel: (kind: string) => t`Start a ${kind} branch`,
    /* the start point of the new branch, chosen in the inline banner */
    get from() {
      return t`from`
    },
    baseLabel: (kind: string) => t`Start point for the ${kind} branch`,
    get cancelStart() {
      return t`Cancel`
    },
  },

  maintenance: {
    get title() {
      return t`Database statistics`
    },
    get intro() {
      return t`Objects stored in this repository's database. Verify checks integrity; compact repacks and prunes.`
    },
    get looseObjects() {
      return t`Loose objects`
    },
    get looseSize() {
      return t`Loose size`
    },
    get packedObjects() {
      return t`Packed objects`
    },
    get packs() {
      return t`Packs`
    },
    get packedSize() {
      return t`Packed size`
    },
    get prunable() {
      return t`Prunable objects`
    },
    get garbageFiles() {
      return t`Garbage files`
    },
    get garbageSize() {
      return t`Garbage size`
    },
    get verify() {
      return t`Verify`
    },
    get compact() {
      return t`Compact`
    },
    get loading() {
      return t`loading…`
    },
    get verifying() {
      return t`Verifying database…`
    },
    get compacting() {
      return t`Compacting database…`
    },
    get verified() {
      return t`Database verified`
    },
    get compacted() {
      return t`Database compacted`
    },
    /* status-bar healthcheck: the object DB has grown enough that git's own auto-gc would fire */
    get compactRecommended() {
      return t`Compacting recommended`
    },
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
