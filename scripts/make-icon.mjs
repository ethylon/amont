/* Generates resources/icon.png: the Mark (cf. src/renderer/src/components/ui/mark.tsx — keep
   the paths in sync) laid on a rounded dark plate, so it holds up on any taskbar background.
   Rasterization is done by Chromium via Electron, already present: no image dependency to
   carry. Rerun this if the logo changes.

   Keep in sync (same path data) with mark.tsx and the two static no-JS splash/crash pages
   (src/renderer/index.html, src/renderer/crash.html).

     pnpm exec electron scripts/make-icon.mjs */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = 512;
const DIR = join(import.meta.dirname, '../resources');

/* The Mark's bar is `currentColor` in the app; the icon has no theme underneath it —
   it's the foam (the dark theme's foreground), readable on the plate. */
const BAR = '#ECECF2';
/* The Mark takes up ~2/3 of the plate, centered: full bleed, OS decorations (corners,
   shadows) would clip the slopes. */
const MARK = SIZE * (2 / 3);
const PAD = (SIZE - MARK) / 2;

const HTML = `<!doctype html><html>
<style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none">
  <defs>
    <linearGradient id="plaque" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1C1C23"/>
      <stop offset="1" stop-color="#101015"/>
    </linearGradient>
    <linearGradient id="courant" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="#6AA6E8"/>
      <stop offset="1" stop-color="#8F8FE8"/>
    </linearGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" rx="103" fill="url(#plaque)"/>
  <rect x="1.5" y="1.5" width="${SIZE - 3}" height="${SIZE - 3}" rx="101.5"
        stroke="${BAR}" stroke-opacity="0.07" stroke-width="3"/>
  <g transform="translate(${PAD} ${PAD}) scale(${MARK / 240})"
     stroke-width="22" stroke-linecap="round">
    <path d="M62,192 C62,132 92,112 114,70" stroke="url(#courant)"/>
    <path d="M178,192 C178,132 148,112 126,70" stroke="url(#courant)"/>
    <path d="M94,148 H146" stroke="${BAR}" stroke-width="16"/>
    <circle cx="120" cy="40" r="13" fill="#F272A8" stroke="none"/>
  </g>
</svg></html>`;

/* loadFile rather than loadURL('data:…'): Chromium refuses top-level navigations
   to a data: URL. */
const page = join(tmpdir(), 'amont-make-icon.html');
writeFileSync(page, HTML);

app.whenReady().then(async () => {
  /* capturePage needs an active compositor: a window that's never shown returns
     UnknownVizError. We show it off-screen instead of in front of the user. */
  const win = new BrowserWindow({
    x: -2 * SIZE,
    y: -2 * SIZE,
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    skipTaskbar: true,
  });

  await win.loadFile(page); // resolves at did-finish-load
  win.showInactive();
  /* requestAnimationFrame round-trip: the second rAF only runs once the first frame
     has actually been composited — where a setTimeout would just gamble on a delay */
  await win.webContents.executeJavaScript(
    'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'
  );

  /* the capture comes out at the screen's physical resolution (DPI factor): scaled back to SIZE */
  const shot = await win.webContents.capturePage();
  const image = shot.resize({ width: SIZE, height: SIZE, quality: 'best' });
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, 'icon.png'), image.toPNG());
  process.stdout.write(`resources/icon.png — ${image.getSize().width}x${image.getSize().height}\n`);
  app.exit(0);
}).catch(err => {
  process.stderr.write(`${err}\n`);
  app.exit(1);
});
