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
  then a file under CONFLICTS: the resolution view overlays the graph. Selection is
  click-ordered: header checkboxes (`Take A/B in every conflict`) take a side everywhere,
  per-chunk checkboxes (`Take A`/`Take B`, indeterminate when partial) take one side of one
  conflict, per-line `+`/`−` buttons (`Add/Remove line …`) pick single lines — the output
  region lists picked lines in click order (each shows its 1-based position). An unpicked
  conflict shows as a `<merge conflict>` placeholder in the output (never raw markers);
  unpicking everything brings the placeholder back. Panes AND the editable output are
  shiki-highlighted — the output is a transparent textarea (`getByLabel("Merged output —
editable")`) over a scroll-synced `<pre>`; count its colored spans via
  `textarea.parentElement.querySelector("pre")`. Target the chunk checkboxes with
  `span[role="checkbox"][aria-label="Take A"]` (getByLabel also matches base-ui's hidden
  input). Picks and hand edits COEXIST: typing does NOT lock the pickers, and toggling a
  pick splices only that conflict's block, preserving edits elsewhere ("Reset to selection"
  regenerates the output from the current picks). "Mark as resolved" enables once no
  placeholder or marker remains and moves the file to STAGED. Escape closes the overlay.
- **Partial staging**: opening a tracked staged/unstaged file from the worktree panel shows
  the interactive diff (wt-diff-body.tsx) instead of diff2html — it honors the
  unified/side-by-side toggle (side-by-side pairs lines via diff-split.ts; an unpaired line
  faces a blank `bg-muted/30` cell). Each hunk has a `@@ …` header row with a "Stage
  hunk"/"Unstage hunk" ghost button; each add/del line has an icon button (`aria-label`
  "Stage line" / "Unstage line" — "Indexer/Désindexer …" under the fr locale). Clicks apply
  immediately (`repo:applyPatch`), then the worktree lists and both wt diffs refetch. The
  mock backs `constraints.ts` (2 unstaged hunks) and `pricing.ts` (1 staged hunk) with real
  hunks (`WT_DIFFS`); a line-level patch moves its whole hunk in the mock, and a partially
  staged file appears in BOTH lists. Untracked files keep the old non-interactive render.
- **Discard**: the unstaged view adds red ↩ discard actions — per line ("Discard line" /
  "Abandonner la ligne"), per hunk ("Discard hunk" / "Abandonner le bloc"), both via
  `repo:discardPatch` with no confirmation; the staged view has none. In the panel, each
  unindexed row has a ↩ button ("Discard changes" / "Abandonner les modifications") and the
  Unstaged header a "Discard all" / "Tout abandonner" bulk — both open a confirmation dialog
  (`[data-slot=dialog-content]`, destructive "Discard"/"Abandonner" button) before calling
  `repo:discard(paths, untracked)`; the mock drops the files/hunks without staging them.
  Discarding the file whose wt diff is open closes the diff.
- `window.__changed()` in the console simulates an external `.git` change.

## Gotchas

- Two rapid ref clicks race (each `focusRef` awaits graph work) — pause ~500ms between
  clicks when scripting.
- Ctrl+click after a plain click replaces the focus instead of adding to it — observed
  pre-existing on `ca1516d` (mock harness); not a regression signal by itself.
- `:focus-visible` styles don't show under programmatic `.focus()` — Tab into the list
  from the filter field instead.
