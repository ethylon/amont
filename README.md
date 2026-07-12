# Amont

A fast, keyboard-friendly Git history visualizer for Windows.

> [!WARNING]
> This project is almost entirely written by AI (Claude, via Claude Code) under human
> direction and review. Quality is not guaranteed. Read the code, file issues, and treat it
> like any other early-stage open-source project you'd audit before trusting it with
> production repositories.

<!-- Screenshots to capture, then uncomment:
     ![Amont — commit graph](docs/screenshot-graph.png)
     docs/screenshot-graph.png (main commit graph + detail panel),
     docs/screenshot-diff.png (side-by-side diff view), docs/screenshot-worktree.png
     (staging panel with file tree). -->

## What it is

Amont renders a repository's commit history as a virtualized, metro-map-style graph:
branches as lanes, merges as curves, refs as chips. It's built for repositories with tens
to hundreds of thousands of commits — the graph engine pages and virtualizes both the
layout and the DOM instead of rendering everything up front.

Highlights:

- Full commit graph with branch lanes, tags, and stash entries folded into the timeline.
- Staging panel (stage/unstage/commit/amend) with a live diff.
- Side-by-side or unified diffs, syntax-highlighted, for files and whole commits.
- git-flow aware: feature/release/hotfix branches get a context banner and a one-click finish.
- Full-text commit search (message, author, hash, optionally diff content).
- A read-only git console showing every command the app runs, for transparency.
- Keyboard-first: the graph, file lists, and popovers are all operable without a mouse.

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

Author avatars are **off by default**. When enabled (toggle in the top-right corner of the
window), the app resolves avatars either from the author's email if it's a GitHub noreply
address (no network request), or by querying Gravatar / `avatars.githubusercontent.com`
directly — which reveals the (hashed) author email and your IP address to those services.
Leave it off if you're browsing a private repository and don't want its committer roster,
even hashed, leaving your machine. With the toggle off, every author gets a colored
monogram instead.

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
