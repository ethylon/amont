# Security

## Reporting a vulnerability

Please report security issues privately by opening a
[GitHub security advisory](https://github.com/ethylon/amont/security/advisories/new)
rather than a public issue. If that isn't available, open a regular issue asking for a
private contact channel — don't post exploit details publicly before a fix ships.

## Trust boundaries

Amont is an Electron app that reads and displays content from local git repositories.
Its main threat model is **a hostile or compromised repository being opened in the app**,
not a hostile Amont server (there isn't one) or a hostile Electron host.

Posture already in place:

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the preload script
  is the only bridge between the renderer and Node/Electron APIs, and it exposes a small,
  typed set of methods (`src/shared/ipc-contract.ts`) rather than raw IPC.
- All git invocations use `child_process.spawn` with an argv array — never a shell —
  and repo-relative paths are passed after `--` to stop them from being read as options.
- `will-navigate` and window-open are intercepted and denied by default; only an
  allowlisted set of directories (recents, scan results, explicit user picks) can be
  opened as a repository.
- Electron fuses disable `RunAsNode`, the Node CLI inspector flag, and
  `NODE_OPTIONS`, and enforce asar integrity on the packaged binary.
- Production CSP: `default-src 'self'`, no inline scripts, `object-src`/`base-uri`/
  `form-action` all `'none'`. `img-src` is allowlisted to Gravatar and
  `avatars.githubusercontent.com` only, used solely for author avatars (see
  README's Privacy section).

### Diff rendering (diff2html)

Commit and working-tree diffs are rendered with [diff2html](https://diff2html.io/),
which builds HTML from diff text and inserts it via `innerHTML`. The diff text comes from
`git diff`/`git show` output on a repository the user chose to open — so a repository
authored by someone else (a clone of a public project, a coworker's branch) is, in effect,
untrusted input reaching an `innerHTML` sink. This is safe **today** because:

- diff2html escapes the file content it renders (it's building a diff view, not executing
  the diff's contents as markup).
- The renderer runs sandboxed with no direct filesystem/process access outside the typed
  IPC bridge, so even a rendering bug in that pipeline can't escalate to native code
  execution on its own — it would need a second, separate vulnerability (e.g. a sandbox
  escape) to matter.
- The production CSP has no `'unsafe-inline'` for scripts, so an HTML-injection bug in the
  diff pipeline can't execute arbitrary script via inline `<script>`.

This is a "safe for now, worth watching" situation rather than a solved one: diff2html and
its transitive dependencies should stay patched (Renovate/Dependabot is configured for
this), and any change to the diff-rendering pipeline that removes one of the mitigations
above (CSP relaxation, sandbox change, switching HTML-generation libraries) should be
treated as security-relevant.

### File-open guard

`repo:openFile` (opening a file from the repository in its default OS handler) blocklists
executable-associated extensions (`.exe`, `.bat`, `.cmd`, `.ps1`, `.lnk`, `.jar`, etc.) and
reveals the file in the file explorer instead of opening it when blocked. This is defense
in depth, not a guarantee: it doesn't cover third-party file-type associations registered
on other extensions, or content whose real type doesn't match its extension.

### Unsigned binaries

Released Windows binaries are not code-signed for 1.0 (see CONTRIBUTING.md). This doesn't
weaken the app's own security model, but it does mean Windows can't attribute the binary
to a verified publisher — verify you downloaded it from the official
[Releases](https://github.com/ethylon/amont/releases) page.
