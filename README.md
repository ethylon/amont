<div align="center">

<img src="resources/icon.png" width="96" alt="Amont" />

# Amont

**A fast, keyboard-friendly Git history visualizer for Windows.**

[![Latest release](https://img.shields.io/github/v/release/ethylon/amont)](https://github.com/ethylon/amont/releases)
[![CI](https://img.shields.io/github/actions/workflow/status/ethylon/amont/ci.yml?label=CI)](https://github.com/ethylon/amont/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078d4)

</div>

Amont renders a repository's commit history as a metro-map-style graph: branches as
lanes, merges as curves, refs as chips. It's built for repositories with tens to hundreds
of thousands of commits — the graph engine pages and virtualizes both the layout and the
DOM instead of rendering everything up front.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/graph-dark.png" />
  <img src="docs/graph-light.png" alt="Amont's main window: the commit graph with branch lanes and ref chips, the branches sidebar, and the detail panel showing a commit's message, co-authors, and file tree." />
</picture>

## Built for big histories

The graph above is a 25,000-commit repository — Amont scrolls it without loading it. Only
the visible window of commits is laid out and mounted; pages are fetched as you scroll,
evicted when you leave, and refetched on return, so a long-distance jump (search hit,
ref click) lands instantly. Branch lanes, merge curves, tags, and stash entries are all
folded into one timeline, and selecting a commit opens its full message, co-authors,
and changed files in the detail panel.

## Diffs that read like code

Diffs are syntax-highlighted (Shiki, same grammars as VS Code) and render unified or
side-by-side, for a single file or a whole commit. The two panes scroll together.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diff-dark.png" />
  <img src="docs/diff-light.png" alt="A side-by-side, syntax-highlighted diff of a TypeScript file, with the commit's detail panel on the right." />
</picture>

## Stage and commit without leaving the graph

The `Uncommitted changes` row at the top of the graph opens the staging panel: stage or
unstage files (or everything at once), review each change in a live diff, and commit or
amend — with the exact git command shown on the button before you run it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/worktree-dark.png" />
  <img src="docs/worktree-light.png" alt="The staging panel: unstaged and staged file trees, a live side-by-side diff of a modified file, and a commit message box with the Commit button." />
</picture>

## And more

- **git-flow aware** — feature/release/hotfix branches get a context banner and a
  one-click finish.
- **Full-text commit search** — message, author, hash, optionally diff content.
- **A read-only git console** — every command the app runs is traced, for transparency.
- **Keyboard-first** — the graph, file lists, and popovers are all operable without a
  mouse.
- **Light and dark** — follows the OS, or pick one; every screenshot above has both.
- **Fetch / pull / push** from the toolbar, with ahead/behind counts per branch.

> Screenshots show the built-in demo harness (`pnpm mock`) — a synthetic repository of
> ~25k commits.

## Install

Download the latest installer from the [Releases](https://github.com/ethylon/amont/releases)
page and run it. There's no auto-update yet — check the releases page for new versions.

**Platform**: Windows only for 1.0. The codebase has no macOS/Linux packaging target or
platform-specific lifecycle handling (app menu, `activate`, etc.) yet.

**About the SmartScreen warning**: released binaries are not code-signed. Windows will
show an "unknown publisher" warning (SmartScreen) when you run the installer — this is
expected, not a sign of tampering. See [CONTRIBUTING.md](CONTRIBUTING.md) for the signing
plan.

## Privacy

Author avatars resolve either from the author's email if it's a GitHub noreply address (no
network request), or by querying Gravatar / `avatars.githubusercontent.com` directly — which
reveals the (hashed) author email and your IP address to those services. An author without an
avatar there falls back to a colored monogram.

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
instant reload without packaging or spawning git processes.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for project conventions and the release process.

## Security

See [SECURITY.md](SECURITY.md) for the app's trust boundaries and how to report a
vulnerability.

## License

[MIT](LICENSE)
