# Contributing

## Setup

```sh
pnpm install
pnpm dev      # the real Electron app
pnpm mock     # browser harness — see below
pnpm test
pnpm typecheck
pnpm lint
```

### The mock harness

`pnpm mock` starts a plain Vite dev server (`vite.preview.config.mjs`) that serves
`src/renderer/mock.html` instead of `index.html`. That file stubs the entire `window.amont`
bridge in-browser (a fake repo, ~25k synthetic commits, no real git process, no Electron)
and then boots the real renderer against it. Use it for any UI change: it reloads instantly
and needs nothing packaged. It's also the only sane way to exercise the graph's
virtualization at scale (page eviction, refetch, long jumps) without a huge real repository
on disk.

When you change the shape of the IPC bridge (`src/shared/ipc-contract.ts`,
`src/renderer/src/lib/git.ts`), keep the stub in `mock.html` in sync — it's a hand-written
mirror, nothing enforces it at compile time.

## Project conventions

### `components/ui` — two layers

- `components/ui/primitives/*` are close-to-pristine [shadcn](https://ui.shadcn.com/)
  components. Don't hand-edit them beyond what `shadcn` itself generates; if you need a
  variant or different density, wrap or extend rather than fork.
- `components/ui/*.tsx` (one level up) is where app-specific density, variants, and
  composition live (e.g. `h-6` controls instead of shadcn's defaults).
- Features must import from `components/ui/*`, never reach into
  `components/ui/primitives/*` directly. ESLint enforces this
  (`no-restricted-imports` in `eslint.config.js`) — a build that imports a primitive
  from outside `ui/` will fail lint.

### Everything lives in `devDependencies`

This is an Electron app, not a published library: nothing in `dependencies` ever gets
`require()`-resolved from a consumer's `node_modules`. `electron-vite` bundles the
renderer, `electron-builder` packages the main/preload output, and neither cares which
`package.json` field a package was listed under at install time. Putting runtime packages
(React, TanStack Query, etc.) in `devDependencies` alongside build tooling is intentional,
not an oversight — please don't "fix" it in a drive-by PR.

### New dependencies

Keep the dependency surface small. Before adding one, check: is there a small
first-party alternative already in `src/renderer/src/lib`? Is the license MIT/Apache-2.0/BSD?
Is it actively maintained? Prefer solving small, well-scoped problems in-repo (see
`lib/markdown.ts`, `lib/sha256.ts`, `lib/path-tree.ts` for examples of "this didn't need a
dependency") over pulling in a package for a narrow need.

### Deliberate shortcuts: `NOTE(debt):`

When you consciously ship the simpler option over the more complete one — because the
complete one isn't justified yet — say so in a comment prefixed `NOTE(debt):` explaining
the tradeoff and what would change the calculus. This is not a TODO ("do this later"); it's
a documented, deliberate decision that a future contributor should be able to evaluate on
its own terms rather than assume was an oversight. Search the codebase for existing
examples before adding a new one. Don't use it for actual bugs — file an issue for those.

## Linting and formatting

`pnpm lint` runs ESLint (flat config, `typescript-eslint` type-checked rules,
`react-hooks`, `react-refresh`). Prettier formats `.ts`/`.tsx`/`.mjs`/`.json`/`.yml`
(`pnpm format` / `pnpm format:check`). Both run in CI; a PR with lint or formatting
failures won't pass.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`,
`refactor:`, `docs:`, `test:`, `style:`, `perf:`, `ci:`, `build:`), in English, one logical
change per commit.

## Release process

Releases are Windows-only NSIS installers built by `.github/workflows/release.yml`:

1. Bump `version` in `package.json` to match the intended tag (they must agree —
   `electron-builder` reads the version from `package.json`).
2. Push a `vX.Y.Z` tag on the default branch.
3. CI builds the installer and creates a **draft** GitHub release
   (`electron-builder.yml`'s `publish.releaseType: draft` — this avoids a 422
   `already_exists` error that a non-draft `release` type would hit when the workflow
   re-uploads artifacts).
4. The workflow then flips the release from draft to published automatically.

Released binaries are **not code-signed**. Windows SmartScreen will flag them as coming
from an "unknown publisher" — this is expected today, not a bug. The intended path for
Windows code signing is the [SignPath Foundation](https://signpath.org/) program, which
offers free OV certificates to qualifying open-source projects; SmartScreen reputation
then builds up over time with signed releases (an EV certificate, which is paid, gives
instant reputation instead — out of scope for this project for now). If you're in a
position to sponsor or set this up, open an issue.
