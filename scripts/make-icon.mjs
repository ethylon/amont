/* Génère resources/icon.png : le Mark (cf. src/renderer/src/components/ui/mark.tsx — garder
   les tracés synchronisés) posé sur une plaque sombre arrondie, pour tenir sur n'importe
   quel fond de taskbar. La rasterisation est faite par Chromium via Electron, déjà
   présent : aucune dépendance d'image à porter. À relancer si le logo bouge.

     pnpm exec electron scripts/make-icon.mjs */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = 512;
const DIR = join(import.meta.dirname, '../resources');

/* La barre du Mark est `currentColor` dans l'app ; l'icône n'a pas de thème sous elle —
   c'est l'écume (le foreground du thème sombre), lisible sur la plaque. */
const BAR = '#ECECF2';
/* Le Mark occupe ~2/3 de la plaque, centré : plein cadre, les fioritures d'OS (coins,
   ombres) rogneraient les pentes. */
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

/* loadFile plutôt que loadURL('data:…') : Chromium refuse les navigations de premier niveau
   vers une URL data:. */
const page = join(tmpdir(), 'gg-make-icon.html');
writeFileSync(page, HTML);

app.whenReady().then(async () => {
  /* capturePage a besoin d'un compositeur actif : une fenêtre jamais affichée renvoie
     UnknownVizError. On la montre hors écran plutôt que sous le nez de l'utilisateur. */
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

  await win.loadFile(page); // résolu à did-finish-load
  win.showInactive();
  /* aller-retour requestAnimationFrame : le second rAF ne tourne qu'une fois la première
     frame réellement composée — là où un setTimeout pariait sur un délai */
  await win.webContents.executeJavaScript(
    'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))'
  );

  /* la capture sort à la résolution physique de l'écran (facteur DPI) : on ramène à SIZE */
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
