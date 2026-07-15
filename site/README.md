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

## Deployment (Vercel)

Create a Vercel project pointing at this repository with **Root Directory = `site`**; the Astro
framework preset does the rest. `vercel.json` adds a stable `amont.dev/download` redirect to the
latest GitHub release. DNS for `amont.dev` points at Vercel.

## CI

`.github/workflows/site.yml` builds the site on any PR touching `site/**`, `docs/**` (screenshots)
or the root `package.json` (the hero badge reads the app version from it).
