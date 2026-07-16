# Product Marketing Context

*Last updated: 2026-07-16*

## Product Overview
**One-liner:** Amont is a fast, keyboard-friendly Git client for Windows that shows your history as a readable commit graph — and shows every git command it runs.
**What it does:** Amont displays a repository's history as a commit graph and lets you work directly from it: search commits, read syntax-highlighted diffs, stage down to the line, resolve merge conflicts side by side, manage branches, worktrees and remotes. It drives the `git` installed on your machine and logs every command it executes.
**Product category:** Git GUI client (Windows desktop app). People search: "git client windows", "git gui", "gitkraken alternative", "sourcetree alternative".
**Product type:** Open-source desktop app (Electron), distributed via GitHub Releases with auto-update.
**Business model:** Free, MIT-licensed. No account, no paywall, no telemetry beyond optional anonymous crash reports.

## Target Audience
**Target companies:** Individual developers and small teams on Windows; any org where devs pick their own tools.
**Decision-makers:** The developer themself (zero-friction adoption: download, run).
**Primary use case:** Reading and working a repo's history daily — understanding what happened, staging precisely, committing, keeping branches in order.
**Jobs to be done:**
- "Show me what's going on in this repo, instantly" — history, branches, divergence at a glance.
- "Let me stage and commit exactly what I mean" — line-level staging without CLI incantations.
- "Get me through this merge without fear" — conflict resolution I can see and control.
**Use cases:**
- Daily driver next to the editor: graph open all day, auto-fetch keeping it current.
- Large / old monorepos where other GUIs choke (100k+ commits).
- Reviewing a teammate's branch: search a commit, read the diff, trace the merge.

## Problems & Pain Points
**Core problem:** On Windows, the Git GUI options are either slow and heavy, abandoned, or visually stuck in 2010. Devs fall back to the CLI and lose the one thing a GUI is for: a readable picture of history.
**Why alternatives fall short:**
- Slow on real repos — the graph lags, scrolling stutters, big histories time out.
- Cluttered: accounts, tabs, integrations, upsells between you and your repo.
- Opaque: the GUI does *something* to your repo and you're never sure what.
**What it costs them:** Minutes lost per day waiting or re-checking in the CLI; botched merges; fear-driven workflows ("I only commit from the terminal").
**Emotional tension:** Distrust ("what did that button actually do?"), frustration with jank in a tool used 50 times a day, mild shame at using a dated tool.

## Competitive Landscape
**Direct:**
- GitKraken — polished but heavy and slow on large repos; account required; key features paywalled.
- SourceTree — free but effectively abandoned by Atlassian; slow, buggy, dated.
- Git Extensions — capable but visually dated (WinForms), steep and cluttered.
- Fork — good and fast, but paid and macOS-first in spirit.
- GitHub Desktop — simple but no real graph; too limited beyond GitHub flows.
- TortoiseGit — shell-extension model, dated UX, no live graph.
**Secondary:** Git CLI + `git log --graph` — powerful, transparent, but unreadable at scale and slow to operate for staging/conflicts.
**Indirect:** IDE-integrated git (VS/VS Code/Rider) — fine for quick commits, weak for history reading, graph navigation and conflict control.

## Differentiation
**Key differentiators:**
- Graph performance at scale: stays fluid on 100,000+ commit histories (proof: the screenshots show a ~25,000-commit repo — Amont's own).
- Command transparency: every mutation button shows the exact git command it will run; a read-only console logs everything executed. No magic, no hidden state.
- Keyboard-first: graph, file lists, sidebar, menus, popovers — all drivable without a mouse.
- Precision tools: line-level staging; conflict resolution that takes a side, a block or a single line, in any order, then lets you edit the result.
- Honest engineering: uses your installed git; sandboxed renderer; MIT; crash reporting optional and PII-free.
**How we do it differently:** Purpose-built graph engine (streaming, virtualized) instead of a generic web view over `git log`; the graph is the workspace, not a side panel.
**Why that's better:** The picture of history is the product. If it's fast and readable, everything else (staging, merging, branching) hangs off it naturally.
**Why customers choose us:** It opens fast, scrolls smooth, tells the truth about what it runs, and costs nothing.

## Objections
| Objection | Response |
|-----------|----------|
| "Electron = bloated" | Purpose-built graph engine, measured perf budget (docs/performance-audit.md); judge it on the scroll, not the stack. |
| "Unknown publisher warning" | Binaries not code-signed yet; updates verified via HTTPS + sha512. Documented openly on the site. |
| "I trust the CLI, not GUIs" | Amont shows the exact command behind every button and logs everything — it's the CLI with a picture. |
| "Windows only?" | Yes, deliberately — it's built *for* Windows rather than ported to it. macOS/Linux later. |

**Anti-persona:** Devs who want a GUI that hides git entirely (Amont exposes git, not abstracts it); macOS/Linux users (for now); teams needing hosted-platform integrations (PRs, issues) inside the client.

## Switching Dynamics
**Push:** Daily jank and clutter in GitKraken/SourceTree; abandonment anxiety (SourceTree); paywalls; dated UX (Git Extensions).
**Pull:** Fast readable graph, keyboard flow, command transparency, free/MIT.
**Habit:** Muscle memory in the current tool or CLI; "it mostly works".
**Anxiety:** "Will a new GUI wreck my repo state?" → transparency + it runs your own git, every command visible. "Is it maintained?" → active releases, open development on GitHub.

## Customer Language
**How they describe the problem:**
- "GitKraken takes forever to open our repo."
- "SourceTree is dead, what do I switch to?"
- "I just want to *see* my branches without lag."
- "I never know what these GUIs actually run."
**How they describe us:**
- "It's fast and it shows the git commands."
- "The graph is actually readable."
**Words to use:** fast, readable, graph, keyboard, exact command, your git, free, open source, smooth scrolling.
**Words to avoid:** blazingly, revolutionary, AI-powered, seamless, all-in-one, platform, workspace hub, robust, comprehensive.
**Glossary:**
| Term | Meaning |
|------|---------|
| Commit graph | The scrollable timeline of commits with branch lanes, merges, tags, stashes |
| Command transparency | Buttons show the exact git command; a console logs every command executed |
| Line-level staging | Stage/unstage/discard single lines from the diff |

## Brand Voice
**Tone:** Sober, precise, technical-friendly. Confidence through specifics, not adjectives.
**Style:** Short sentences. Concrete numbers. Show, don't claim.
**Personality:** honest, fast, exacting, quiet, craftsmanlike.

## Proof Points
**Metrics:**
- Graph stays fast on histories of 100,000+ commits.
- Hero screenshot = a real ~25,000-commit history (Amont's own repo), not a toy.
- 3,000-line diffs syntax-highlighted with graceful fallback.
**Customers:** none citable yet (pre-1.0, no testimonials). Do not invent any.
**Value themes:**
| Theme | Proof |
|-------|-------|
| Speed at scale | 100k+ commit graph; perf budget documented in docs/performance-audit.md |
| Trust / transparency | Exact command on every button; read-only command console; runs your installed git |
| Precision | Line-level staging; per-line conflict picks; editable merged output |
| Honest distribution | MIT, GitHub Releases, sha512-verified auto-update, SmartScreen caveat stated upfront |

## Goals
**Business goal:** Adoption — downloads and GitHub stars; become the default Git GUI recommendation for Windows devs.
**Conversion action:** Download the installer (GitHub latest release).
**Current metrics:** unknown (no analytics on site by design).
