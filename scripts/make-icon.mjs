/* Génère resources/icon.png à partir du Mark. La rasterisation est faite par Chromium via
   Electron, déjà présent : aucune dépendance d'image à porter. À relancer si le logo bouge.

     pnpm exec electron scripts/make-icon.mjs

   Le fond est transparent, donc l'anneau du milieu ne peut pas masquer les traits qui le
   traversent avec un fill : un masque les coupe à son bord extérieur (r = 2.3 + 1.6/2). */
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SIZE = 512;
const DIR = join(import.meta.dirname, '../resources');

/* lightness relevée par rapport aux lanes du thème clair : l'icône doit tenir sur fond noir */
const A = 'oklch(0.62 0.16 250)';
const B = 'oklch(0.62 0.19 322)';

const HTML = `<!doctype html><html>
<style>html,body{margin:0;overflow:hidden;background:transparent}svg{display:block}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="-1.15 -0.85 22 22"
     fill="none" stroke-linecap="round">
  <mask id="ring">
    <rect x="-2" y="-2" width="25" height="25" fill="#fff"/>
    <circle cx="5" cy="9" r="3.1" fill="#000"/>
  </mask>
  <g mask="url(#ring)">
    <path d="M5 17.2V3.4" stroke="${A}" stroke-width="1.7"/>
    <path d="M15 17.2v-3.7C15 10 5 12.5 5 9" stroke="${B}" stroke-width="1.7"/>
    <circle cx="5" cy="3.4" r="2.4" fill="${A}"/>
    <circle cx="15" cy="17.2" r="2.1" fill="${B}"/>
  </g>
  <circle cx="5" cy="9" r="2.3" stroke="${A}" stroke-width="1.6"/>
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

  await win.loadFile(page);
  win.showInactive();
  await new Promise(r => setTimeout(r, 200)); // laisser passer une frame composée

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
