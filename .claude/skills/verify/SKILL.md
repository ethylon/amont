---
name: verify
description: Verify renderer changes by driving the real UI in a browser against the mock git API — build-free, no Electron needed.
---

# Verifying Amont renderer changes

## Launch

```bash
pnpm install --frozen-lockfile
pnpm mock          # vite preview harness on http://localhost:5199
```

Open **`http://localhost:5199/mock.html`** (not `/` or `/index.html`) — it installs a
simulated `window.amont` git API before mounting the real renderer. The dataset lives
in `src/renderer/mock.html`: one repo, HEAD on `develop` (ahead 2), `feature/…` folders,
remotes, tags, one stash, ~25k synthetic commits (exercises virtualization).

Drive it with Playwright (`executablePath: "/opt/pw-browsers/chromium"` on remote
runners; install `playwright-core` in a scratch dir, not the repo). Test light and dark
via `colorScheme` on the browser context.

## Flows worth driving

- **Refs sidebar**: rows are `.amont-refrow` inside `nav[data-amont-keep-focus]`.
  Click focuses a branch (lit = `data-lit`), Ctrl+click is additive, double-click
  checks out. `data-run` (start/mid/end/solo) marks contiguous lit runs — set by
  `refs-focus-paint.ts` after any click inside the nav.
- **Filter**: `getByPlaceholder("Filter branches")` — beware, the toolbar has a second
  `input[type=search]` ("Filter commits"); a bare `input[type="search"]` selector is
  ambiguous or hits the wrong one.
- Folders (`feature/`, nested `ui/`) start collapsed; expand via the folder trigger
  before targeting leaves.
- **Merge conflicts**: the mock worktree ships a merge in progress (`feature/cost-optim`
  (B) into `develop` (A)) with two conflicted files — `threshold.ts` (UU, two blocks, one
  diff3-style) and `params.ts` (AA, no base). Click the "Uncommitted changes" graph row,
  then a file under CONFLICTS: the resolution view overlays the graph. Per-conflict
  `Take A` / `Take B` / `Take A then B` buttons patch the editable merged output
  (`getByLabel("Merged output — editable")`); "Mark as resolved" enables once no markers
  remain and moves the file to STAGED. Escape closes the overlay.
- `window.__changed()` in the console simulates an external `.git` change.

## Gotchas

- Two rapid ref clicks race (each `focusRef` awaits graph work) — pause ~500ms between
  clicks when scripting.
- Ctrl+click after a plain click replaces the focus instead of adding to it — observed
  pre-existing on `ca1516d` (mock harness); not a regression signal by itself.
- `:focus-visible` styles don't show under programmatic `.focus()` — Tab into the list
  from the filter field instead.
