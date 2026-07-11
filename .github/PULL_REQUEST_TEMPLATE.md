## What and why

<!-- What does this change do, and why is it needed? Link any related issue. -->

## How it was tested

<!-- pnpm typecheck / pnpm test / pnpm build all pass locally? Anything checked manually
     via `pnpm dev` or `pnpm mock`? -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm build` all pass locally
- [ ] No new runtime dependency added without discussing it in the PR description (see
      CONTRIBUTING.md's "New dependencies" section)
- [ ] UI-facing strings go through `src/renderer/src/lib/messages.ts`, not inlined
