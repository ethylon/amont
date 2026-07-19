<div align="center">

![Amont](docs/logo.png)

# Amont

### Git history you can actually read.

A fast, keyboard-friendly Git client for Windows.

[![Latest release](https://img.shields.io/github/v/release/ethylon/amont?label=release&color=8b5cf6)](https://github.com/ethylon/amont/releases/latest)
[![CI](https://github.com/ethylon/amont/actions/workflows/ci.yml/badge.svg)](https://github.com/ethylon/amont/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078d4)

**[Download the latest release](https://github.com/ethylon/amont/releases/latest)** ·
[Website](https://amont.dev) ·
[Features](#features) · [Screenshots](#screenshots) · [Install](#install) · [Development](#development)

![Amont’s main window: the commit graph with branch lanes and ref chips, the branches sidebar, and the detail panel showing a commit’s message and file tree.](docs/graph-light.png)

<sub>Amont browsing a 25,000-commit demo repository.</sub>

</div>

Amont lays your repository out as one fast, readable commit graph: branches, merges, tags,
stashes and ahead/behind status at a glance. Smooth at 100,000+ commits. Work directly from
it: search commits, read syntax-highlighted diffs, stage down to the line, resolve merge
conflicts side by side, manage branches, worktrees and remotes. Amont drives the `git`
installed on your machine and shows every command it runs.

Try the live demo on [amont.dev](https://amont.dev): the real interface, in your browser,
on a simulated repository.

## Features

Most Git clients treat history as a side panel. Amont is built the other way around: the
graph is the workspace.

### The graph

- **One timeline.** Branches, merges, tags, stashes and ahead/behind status in a single
  scrollable view; commit subjects carry type badges (`feat`, `fix`, …).
- **Fast at scale.** A purpose-built streaming engine keeps scrolling smooth on histories
  of 100,000+ commits. The screenshots below run on a 25,000-commit history.
- **Search.** Find commits by message, author or hash prefix, or search through the
  contents of diffs.
- **Keyboard first.** The graph, file lists, sidebar, menus and popovers all work without
  a mouse.

### Work from it

- **Staging.** Stage, unstage or discard files, folders, hunks or single lines from a
  live diff, then commit or amend from the same panel.
- **Diffs.** Syntax-highlighted, unified or side-by-side, per file or for the whole
  commit. Images open in an image viewer.
- **Merge conflicts.** Both versions side by side: take a whole side, one block or single
  lines, in any order, then edit the merged result freely before marking the file
  resolved.
- **Worktrees.** Create, open, reveal or remove linked worktrees from the sidebar or the
  graph.
- **git-flow.** Start, publish and finish feature, release and hotfix branches from the
  UI.
- **Remotes.** Fetch, pull and push with live progress; optional periodic auto-fetch
  (with prune) keeps the graph current.

### It’s still git. You can watch.

- **The exact command, before you click.** Every mutation button shows the git command it
  will run, and a read-only console logs every command the app executes.
- **Your git, your repo.** Amont drives the `git` installed on your machine: no bundled
  binaries, no hidden state, no account.
- **Sandboxed UI.** The interface runs in Chromium’s sandbox with a strict CSP; only the
  main process touches git, the disk and the network.
- **Free and open.** MIT-licensed. Optional crash reports carry no repository contents
  and no personal data; see [Privacy](#privacy).

### Everything else

- **Repository healthcheck.** Runs `fsck` and `gc`, reports object counts, and finds
  stranded pack files and stale temporary files.
- **Customization.** Light and dark themes, English and French UI switchable at runtime,
  custom branch-prefix colors, configurable diff highlighting.
- **Auto-update.** Checks GitHub Releases at startup, downloads in the background, and
  installs on quit or on _Restart now_.

## Screenshots

All screenshots show Amont on its demo repository: the same simulated 25,000-commit
history as the live demo on [amont.dev](https://amont.dev).

### The commit graph

Branch lanes, merge curves, tags, stashes and ahead/behind status in a single timeline,
here a history of about 25,000 commits. Selecting a commit opens its full message,
co-authors and changed files in the detail panel.

![The commit graph and detail panel in the dark theme.](docs/graph-dark.png)

### Diffs

Unified or side-by-side, one file or the whole commit, with syntax highlighting
throughout. The two panes scroll together; images are shown in an image viewer.

![A side-by-side, syntax-highlighted diff of a TypeScript file, with the commit’s detail panel on the right.](docs/diff-light.png)

<details>
<summary>Same view, dark theme</summary>

![The same side-by-side diff in the dark theme.](docs/diff-dark.png)

</details>

### Staging

The `Uncommitted changes` row at the top of the graph opens the staging panel: stage or
unstage files, folders, hunks or single lines from a live diff, then commit or amend. The
commit button shows the exact git command before you run it.

![The staging panel: staged and unstaged file trees, a live diff with per-hunk stage and discard actions, and the commit message box.](docs/worktree-light.png)

<details>
<summary>Same view, dark theme</summary>

![The same staging panel in the dark theme.](docs/worktree-dark.png)

</details>

### Merge conflicts

When a merge, rebase or stash pop leaves conflicts, opening a conflicted file lays both
versions out in aligned, syntax-highlighted panes: **A** is the branch you’re on (_ours_),
**B** the one being merged in (_theirs_). A checkbox per pane takes a whole side, a
per-chunk checkbox takes one side of one conflict, and per-line `+`/`−` buttons take
single lines, in the order you click them. The merged output is a regular editor, so
picks and hand edits can be combined; `Mark as resolved` writes the file and stages it
once no conflict markers remain.

![The conflict resolution view: the ‘ours’ (A) and ‘theirs’ (B) versions of a file in two aligned, syntax-highlighted panes with per-side and per-line pickers, above an editable merged output.](docs/conflict-light.png)

<details>
<summary>Same view, dark theme</summary>

![The same conflict resolution view in the dark theme.](docs/conflict-dark.png)

</details>

## Install

**[Download the installer from the latest release](https://github.com/ethylon/amont/releases/latest)**
and run it. Amont then keeps itself up to date: it checks GitHub Releases at startup,
downloads updates in the background, and installs them on quit or when you click
_Restart now_.

Amont uses the `git` installed on your machine.

**Platform.** Windows only for now; macOS and Linux builds are not available yet.

**SmartScreen warning.** Released binaries are not code-signed yet, so Windows shows an
"unknown publisher" warning when you run the installer. This is expected. Update
integrity relies on HTTPS to GitHub plus the `sha512` checksum in `latest.yml`; see
[CONTRIBUTING.md](CONTRIBUTING.md) for the signing plan.

## Privacy

**Author avatars.** For authors using a GitHub noreply address, the avatar is derived
from the email without any network request. Otherwise Amont queries Gravatar /
`avatars.githubusercontent.com`, which reveals the hashed author email and your IP
address to those services. Authors without an avatar there get a colored monogram.

**Crash reporting.** Official release builds report unhandled errors and native crashes
to Sentry. Reports contain no repository contents, diffs or credentials, and no PII (IP,
hostname, user identity); see `src/main/telemetry.ts`. Reporting can be turned off from a
toggle on the home screen. Builds from source send nothing: the Sentry DSN is injected at
build time and only CI sets it. Reports are sent by the main process, never the sandboxed
renderer.

## Development

Requires Node (see `.nvmrc` / `engines.node` in `package.json`) and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev          # run the Electron app
pnpm mock         # browser-only harness: real UI against a simulated git backend
pnpm test         # vitest
pnpm build        # electron-vite build (main + preload + renderer)
pnpm build:embed  # build the browser demo embedded on the website
pnpm typecheck
```

`pnpm mock` runs the renderer in a plain browser tab against a fake `window.amont` bridge
(see `src/renderer/mock.html`) with a ~25,000-commit synthetic dataset: the fastest inner
loop for UI work, with instant reload and no git processes. Two sibling harnesses share
the same setup, both built on the Aurelia Storefront scenario in
`src/renderer/demo-scenario.mjs`: `/demo.html` is the screenshot harness behind the README
and site captures (`?merge=1` serves the conflict state; the shot list lives in
[`site/SCREENSHOTS.md`](site/SCREENSHOTS.md)), and `src/renderer/embed.html`, built with
`pnpm build:embed`, is the live demo embedded on [amont.dev](https://amont.dev).
[`site/scripts/demo-repo.mjs`](site/scripts/demo-repo.mjs) generates the same scenario as
a real git repository, for testing against the actual app.

The graph engine’s performance budget and measurements live in
[`docs/performance-audit.md`](docs/performance-audit.md).

### Crash reporting (maintainers)

Error reporting is inert unless a Sentry DSN is provided at build time via the
`MAIN_VITE_SENTRY_DSN` build-env variable (electron-vite reads it from the build
environment, no file involved). Builds without it send nothing; that includes builds from
source, `pnpm dev`, and CI on ordinary commits.

- **Official releases (CI):** set a `SENTRY_DSN` **repository variable**; the release
  workflow maps it into the build (`.github/workflows/release.yml`). The DSN ends up in
  the shipped binary, so it’s not confidential: a variable, not a secret (a secret works
  too, just swap `vars.` for `secrets.`).
- **Local testing:** prefix the command, e.g. `MAIN_VITE_SENTRY_DSN=<dsn> pnpm dev`.

See [Privacy](#privacy) for what reports contain and `src/main/telemetry.ts` for the
implementation.

## Contributing

Issues and pull requests are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) for project
conventions and the release process, and [SECURITY.md](SECURITY.md) for the app’s trust
boundaries and how to report a vulnerability.

## License

[MIT](LICENSE) © Mathieu Guey
