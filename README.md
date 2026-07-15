<div align="center">

![Amont](docs/logo.png)

# Amont

### Git history you can actually read.

Amont renders any repository — including six-figure-commit monsters — as a metro map:
branches as lanes, merges as curves, refs as chips. Scroll it, search it, stage from it,
resolve conflicts in it. Fast, keyboard-first, built for Windows.

[![Latest release](https://img.shields.io/github/v/release/ethylon/amont?label=release&color=8b5cf6)](https://github.com/ethylon/amont/releases/latest)
[![CI](https://github.com/ethylon/amont/actions/workflows/ci.yml/badge.svg)](https://github.com/ethylon/amont/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078d4)

**[⬇ Download the latest release](https://github.com/ethylon/amont/releases/latest)** ·
[Highlights](#highlights) · [Tour](#the-tour) · [Install](#install) · [Development](#development)

![Amont's main window: the commit graph with branch lanes and ref chips, the branches sidebar, and the detail panel showing a commit's message and file tree.](docs/graph-light.png)

<sub>Every screenshot in this README is Amont browsing <strong>Amont's own repository</strong> —
the very history that produced the app you're looking at. It's turtles all the way down.</sub>

</div>

## Highlights

|                                                                                                                                                                                                                                                               |                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🚇 **A graph built for scale** — the layout and the DOM are both virtualized: only the visible window of commits is laid out and mounted, pages are fetched as you scroll and evicted when you leave. A 100,000-commit history scrolls like a 100-commit one. | 🎨 **Diffs that read like code** — syntax-highlighted by Shiki (the same grammars as VS Code), unified or side-by-side, per file or whole commit. Images get a real viewer instead of `Binary files differ`.  |
| 🧬 **Stage exactly what you mean** — stage, unstage or discard a file, a folder, a hunk, or a single line, straight from a live interactive diff. Amend included, live commit progress included.                                                              | 🧩 **Conflicts, resolved by clicking** — aligned A/B panes, take a whole side, one chunk, or one line at a time, **in the order you click**. Picks and hand edits coexist in an editable, highlighted output. |
| 🔍 **Full-text commit search** — message, author, hash prefix, and (optionally) diff content via git's pickaxe. Long-distance jumps land instantly, virtualization included.                                                                                  | 🌊 **git-flow, first-class** — feature/release/hotfix branches get a context banner, a tinted one-click finish, start/publish from their own menu, and a start-branch picker.                                 |
| 🌳 **Linked worktrees** — a sidebar section, graph chips and context menus make `git worktree` a one-click affair: create, open as a tab, reveal, or remove.                                                                                                  | ⚡ **Live operations** — fetch, pull and push stream their progress into a unified status feed; background auto-fetch (with `--prune`) keeps the graph fresh on a timer you control.                          |
| 🩺 **Repository maintenance** — one-click healthcheck: `fsck`, `gc`, object counts, and a sweep for stranded pack files and stale transfer temporaries.                                                                                                       | 🔎 **Nothing up its sleeve** — mutation buttons preview the exact git command they will run, and a read-only console traces every command the app executes.                                                   |
| ⌨️ **Keyboard-first** — the graph, file lists, sidebar, menus and popovers are all fully operable without a mouse.                                                                                                                                            | 🎛️ **Make it yours** — light/dark themes, English/French UI (switchable at runtime), custom branch-prefix colors, configurable diff highlighting.                                                             |
| 🔄 **Updates itself** — silent startup check against GitHub Releases, downloads in the background, installs on quit or on "Restart now".                                                                                                                      | 🔒 **Sandboxed by design** — the UI runs with the Chromium sandbox on and a strict CSP; only the main process touches git, your disk, or the network.                                                         |

## The tour

### Built for big histories

The graph below is a ~25,000-commit timeline — Amont scrolls it without loading it. Pages
are fetched on demand, evicted when you leave, and refetched on return, so a long jump
(search hit, ref click) lands instantly. Branch lanes, merge curves, tags, stashes and
ahead/behind divergence are folded into one timeline; commit subjects carry type badges
(`feat`, `fix`, `style`, …) so the shape of the work reads at a glance. Selecting a commit
opens its full message, co-authors and changed files in the detail panel.

![The commit graph and detail panel in the dark theme.](docs/graph-dark.png)

### Diffs that read like code

Unified or side-by-side, one file or the whole commit — the two panes scroll together, and
Shiki highlights everything with the same grammars VS Code uses. Binary images render in a
proper viewer.

![A side-by-side, syntax-highlighted diff of a TypeScript file, with the commit's detail panel on the right.](docs/diff-light.png)

<details>
<summary>🌙 Same view, dark theme</summary>

![The same side-by-side diff in the dark theme.](docs/diff-dark.png)

</details>

### Stage exactly what you mean

The `Uncommitted changes` row at the top of the graph opens the staging panel: stage or
unstage files, folders, hunks or single lines from a live split diff, review everything,
then commit or amend — with the exact git command shown on the button before you run it.

![The staging panel: staged and unstaged file trees, a live side-by-side diff with per-hunk stage/discard actions, and the commit message box.](docs/worktree-light.png)

<details>
<summary>🌙 Same view, dark theme</summary>

![The same staging panel in the dark theme.](docs/worktree-dark.png)

</details>

<sub>Inception checkpoint: the diff being staged up there is <em>this README rewrite</em>,
mid-flight, next to its freshly reshot screenshots.</sub>

### Merge conflicts, resolved on your terms

When a merge, rebase or stash pop leaves conflicts, the conflicted files get their own
block in the staging panel and a banner naming both sides — **A** is the branch you're on
(_ours_), **B** the one being merged in (_theirs_). Opening a file lays the two versions
out in aligned, syntax-highlighted panes.

You build the resolution by picking: a checkbox per pane takes a whole side, a per-chunk
checkbox takes one side of one conflict, and per-line `+`/`−` buttons take individual
lines — landing in the merged output **in the order you click them**, no forced
A-before-B. The output is a normal, highlighted editor: picks and hand edits coexist.
`Mark as resolved` writes the file and stages it once no conflict markers remain.

![The conflict resolution view: the 'ours' (A) and 'theirs' (B) versions of a file in two aligned, syntax-highlighted panes with per-side and per-line pickers, above an editable merged output.](docs/conflict-light.png)

<details>
<summary>🌙 Same view, dark theme</summary>

![The same conflict resolution view in the dark theme.](docs/conflict-dark.png)

</details>

### About these screenshots

They're not mockups. Every capture is the real renderer, driven through the built-in mock
harness (`pnpm mock`, then `/screenshots.html`), whose dataset is a snapshot of **this
repository's actual git history** — commits, branches, tags, diffs and all — with a
synthetic tail spliced below the real root so the graph still exercises virtualization at
~25k commits. When the history moves, the screenshots are reshot from it.

## Install

**[Download the installer from the latest release](https://github.com/ethylon/amont/releases/latest)**
and run it. From then on, Amont keeps itself up to date: it checks GitHub Releases at
startup, downloads updates in the background, and installs on quit — or immediately, when
you click _Restart now_.

**Platform.** Windows only for 1.0 — the codebase has no macOS/Linux packaging target or
platform-specific lifecycle handling (app menu, `activate`, …) yet.

**About the SmartScreen warning.** Released binaries are not code-signed yet, so Windows
shows an "unknown publisher" warning when you run the installer — expected, not a sign of
tampering. Update integrity meanwhile relies on HTTPS to GitHub plus the `sha512` in
`latest.yml`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the signing plan.

## Privacy

Author avatars resolve either from the author's email if it's a GitHub noreply address (no
network request), or by querying Gravatar / `avatars.githubusercontent.com` directly —
which reveals the (hashed) author email and your IP address to those services. An author
without an avatar there falls back to a colored monogram.

**Crash reporting.** Official release builds report unhandled errors and native crashes to
Sentry, so bugs surface and get fixed. Reports carry no repository contents, diffs, or
credentials, and no PII (IP, hostname, user identity) — see `src/main/telemetry.ts`. It's
**opt-out at runtime** from a toggle on the home screen. Builds from source send nothing:
the DSN is injected at build time from a build-env variable that only CI sets, so a build
you make yourself has no telemetry at all. Reports leave from the main process, never the
sandboxed renderer, so the renderer's strict CSP is unchanged.

## Development

Requires Node (see `.nvmrc` / `engines.node` in `package.json`) and [pnpm](https://pnpm.io).

```sh
pnpm install
pnpm dev      # run the real Electron app
pnpm mock     # browser-only harness: real UI, simulated git backend, ~25k synthetic commits
pnpm test     # vitest
pnpm build    # electron-vite build (main + preload + renderer)
pnpm typecheck
```

`pnpm mock` is the fastest inner loop for UI work: it boots the real renderer in a plain
browser tab against a fake `window.amont` bridge (see `src/renderer/mock.html`), so you get
instant reload without packaging or spawning git processes. The screenshot harness at
`/screenshots.html` is the same idea, fed by this repository's own history.

Performance is treated as a feature: the graph engine's budget and the receipts live in
[`docs/performance-audit.md`](docs/performance-audit.md).

### Crash reporting (maintainers)

Error reporting is inert unless a Sentry DSN is baked in at build time, via the
`MAIN_VITE_SENTRY_DSN` build-env variable (electron-vite reads it straight from the build
environment — no file involved). Every build without it — including every build from source,
`pnpm dev`, and CI on ordinary commits — sends nothing.

- **Official releases (CI):** set a `SENTRY_DSN` **repository variable**; the release workflow
  maps it into the build (`.github/workflows/release.yml`). A DSN is embedded in the shipped
  binary, so it's not confidential — a variable, not a secret (a secret works too, just swap
  `vars.` for `secrets.`).
- **Local testing:** prefix the command, e.g. `MAIN_VITE_SENTRY_DSN=<dsn> pnpm dev`.

See the [Privacy](#privacy) section for what's reported and `src/main/telemetry.ts` for how.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for project
conventions and the release process, and [SECURITY.md](SECURITY.md) for the app's trust
boundaries and how to report a vulnerability.

## License

[MIT](LICENSE) © Mathieu Guey
