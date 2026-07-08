/* Génère resources/icon.png à partir du Mark. La rasterisation est faite par Chromium via
   Electron, déjà présent : aucune dépendance d'image à porter. À relancer si le logo bouge.

     pnpm exec electron scripts/make-icon.mjs

   Tous les tracés sont en stroke et se rejoignent bord à bord (les segments partent du bord des
   cercles, jamais de leur centre) : rien ne se recouvre, le fond transparent ne pose donc pas de
   problème et aucun masque n'est nécessaire. */
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
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24"
     fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <g stroke="${A}">
    <circle cx="5" cy="6" r="3"/>
    <path d="M5 9v6"/>
    <circle cx="5" cy="18" r="3"/>
    <path d="M12 3v18"/>
  </g>
  <g stroke="${B}">
    <circle cx="19" cy="6" r="3"/>
    <path d="M16 15.7C16.9428 14.8567 17.6972 13.8242 18.2142 12.6698C18.7311 11.5153 18.9988 10.2649 19 9"/>
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
