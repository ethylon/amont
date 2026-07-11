/* User-facing UI strings (AUDIT.md §9, open-source readiness — language pass). Not a full i18n
   framework: the app follows the system locale for dates/numbers (cf. lib/errors.ts for
   backend-error text), but every other label, placeholder, and hint lives here instead of being
   inlined at each call site. One place to read what the app says, one place to change it. */

export const messages = {
  app: {
    somethingWentWrong: "Something went wrong",
    unexpectedError: "Unexpected error.",
    reload: "Reload",
    reloadTab: "Reload tab",
    home: "Home",
    closeTab: (name: string) => `Close ${name}`,
    newTab: "New tab",
    newCommits: (n: number) => `${n} new commit${n > 1 ? "s" : ""}`,
  },

  home: {
    noRepos: "No repositories",
    chooseRootHint: "Choose a root folder to list the repositories it contains, or open one directly.",
    chooseRoot: "Choose a root folder…",
    openRepo: "Open a repository…",
    openInNewTab: "Open a repository in a new tab.",
    recents: "Recent",
    rootFolder: "Root folder",
    change: "Change…",
    choose: "Choose…",
    noRootFolder: "No root folder. Choose one to list its repositories.",
    scanningRepos: "scanning for repositories…",
    noReposFoundUnderRoot: "No repositories found under this root.",
  },

  repo: {
    clickCommitForDetail: "Click a commit for its detail.",
    hideSidebar: "Hide sidebar",
    showSidebar: "Show sidebar",
    flatView: "Flat view",
    treeView: "Tree view",
    openInFileExplorer: "Open in file explorer",
    fileCount: (n: number) => (n ? `${n} file${n > 1 ? "s" : ""}` : "no files"),
  },

  detail: {
    loadingFiles: "loading files…",
    branchHeading: (n: number) => `Branch · ${n} commit${n > 1 ? "s" : ""}`,
    commitsSelected: (n: number) => `${n} commits selected`,
    unmergedSuffix: (refs: string) => `${refs} · unmerged`,
    unmergedSegment: "unmerged segment",
    merged: (refs: string | null, mergedInto: string | null, hash: string) =>
      `${refs ? refs + " · " : ""}merged${mergedInto ? " into " + mergedInto : ""} (${hash})`,
    commit: "commit",
    author: "author",
    coAuthors: "co-authors",
    date: "date",
    parent: "parent",
    parents: "parents",
    root: "(root)",
    firstParent: "  (first-parent)",
    mergeParent: "  (merge)",
  },

  console: {
    ready: "Ready",
    gitConsole: "Git console",
    clear: "Clear",
    close: "Close",
    noCommandsYet: "No commands yet.",
    failed: "✗ failed",
    commandFailed: (cmd: string) => `Command failed: ${cmd}`,
  },

  diff: {
    unified: "Unified diff",
    sideBySide: "Side by side",
    close: "Close (Esc)",
    unavailable: "Diff unavailable.",
    empty: "Empty diff.",
    loading: "diff…",
    truncated: (n: string) => `… ${n} lines truncated`,
  },

  search: {
    placeholder: "Filter commits — message, author, hash",
    searchDiffContent: "Also search diff content",
    prevResult: "Previous result",
    nextResult: "Next result",
    error: (msg: string) => `Error: ${msg}`,
    errorShort: "error",
    noResults: "No results",
    results: (n: number) => `${n} result${n > 1 ? "s" : ""}`,
  },

  refs: {
    branches: "Branches",
    remotes: "Remotes",
    tags: "Tags",
    filterBranches: "Filter branches",
    checkout: "Checkout",
    mergeInto: (branch: string) => `Merge into « ${branch} »`,
    pull: "Pull",
    push: "Push",
    pushTo: (upstream: string) => `Push to « ${upstream} »`,
    deleteBranch: "Delete branch",
    finishFeature: "Finish feature",
    finishBugfix: "Finish bugfix",
    finishRelease: "Finish release",
    finishHotfix: "Finish hotfix",
    branchesUnavailable: "Branches unavailable.",
    loadingBranches: "branches…",
    noMatchingRef: "No matching ref.",
  },

  stash: {
    apply: "Apply",
    applyAndDrop: "Apply and drop",
    drop: "Drop",
  },

  worktree: {
    stage: "Stage",
    unstage: "Unstage",
    stageFolder: "Stage folder",
    unstageFolder: "Unstage folder",
    uncommittedChanges: "Uncommitted changes",
    stashChanges: "Stash changes (git stash push -u)",
    unstaged: "Unstaged",
    noChangesToStage: "No changes to stage.",
    staged: "Staged",
    stageAll: "Stage all",
    unstageAll: "Unstage all",
    noStagedFiles: "No staged files.",
    resolveConflictsFirst: "Resolve conflicts before committing.",
    commitMessage: "Commit message",
    amend: "Amend",
    commit: "Commit",
    commitCaption: (verb: string, staged: number) =>
      staged ? `${verb} · ${staged} file${staged > 1 ? "s" : ""}` : verb,
  },

  graph: {
    extraRefs: "Additional references",
    extraRefsCount: (n: number) => `${n} additional reference${n > 1 ? "s" : ""}`,
    extraBranchesOnTip: (n: number) => `${n} other branch${n > 1 ? "es" : ""} on this tip`,
    commitsLoaded: (loaded: string, total: string) => `${loaded} of ${total} commits loaded`,
  },

  avatars: {
    enable: "Enable network avatars (Gravatar/GitHub) — off by default for privacy",
    disable: "Disable network avatars (Gravatar/GitHub)",
  },

  theme: {
    light: "Light theme",
    dark: "Dark theme",
  },

  flow: {
    minutes: (n: number) => `${n} min`,
    hours: (n: number) => `${n} h`,
    days: (n: number) => `${n} d`,
    commitCount: (n: number) => (n ? `${n} commit${n > 1 ? "s" : ""}` : "no commits"),
    to: (targets: string) => `to ${targets}`,
    tag: (tag: string) => ` · tag ${tag}`,
    base: "base",
    commits: "commits",
    none: "none",
    finishTargets: "finish targets",
    finishTarget: "finish target",
    expectedTag: "expected tag",
    inProgress: (kind: string, since: string | null) => `${kind} in progress${since ? ` for ${since}` : ""}`,
  },
}
