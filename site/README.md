# amont.dev

The product site for [Amont](https://github.com/ethylon/amont) — static, bilingual (EN at `/`,
FR at `/fr/`), built with [Astro](https://astro.build) and Tailwind CSS 4.

## Single source of truth

The site has **no assets of its own**: screenshots are imported straight from the repository's
[`../docs`](../docs) (the same files the README embeds) and the icon from
[`../resources`](../resources). Reshoot the README screenshots and the site picks them up on the
next build — Astro resizes and re-encodes them (WebP, responsive `srcset`) at build time. Copy
lives in [`src/i18n/ui.ts`](src/i18n/ui.ts), one typed dictionary per locale.

## Development

```sh
cd site
pnpm install
pnpm dev       # http://localhost:4321
pnpm build     # static output in dist/
pnpm preview
```

The site is intentionally zero-JS apart from two tiny inline behaviours (theme toggle,
reveal-on-scroll) — no framework runtime is shipped.

## The interactive hero demo

The hero swaps its static screenshot for the real renderer (`pnpm build:embed` at the repo
root, output in `public/embed/` — gitignored). The demo only mounts if `/embed/embed.html`
exists on the deployed site, so the embed **must** be built before `astro build`;
`vercel.json` overrides Vercel's install/build commands to do exactly that. To see it locally:

```sh
pnpm build:embed   # at the repo root — root deps must be installed
cd site && pnpm build && pnpm preview
```

(`astro dev` serves `public/` as-is, so the demo also appears in dev once the embed is built.)

## Deployment (Vercel)

Create a Vercel project pointing at this repository with **Root Directory = `site`** and keep
**“Include source files outside of the Root Directory”** enabled (it is by default) — the build
reaches into the repo root to compile the hero demo. `vercel.json` overrides the install/build
commands (root install without scripts + `build:embed`, then `astro build`) and adds a stable
`amont.dev/download` redirect to the latest GitHub release. DNS for `amont.dev` points at Vercel.

## CI

`.github/workflows/site.yml` mirrors the Vercel build (embed first, then Astro) on any PR touching
`site/**`, `src/renderer/**` (the embedded demo), `docs/**` (screenshots) or the root
`package.json` (the hero badge reads the app version from it).
