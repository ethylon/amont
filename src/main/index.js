import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

/* Repo courant, côté main uniquement — le renderer n'a jamais de chemin en direct. */
let currentRepo = null;

if (process.env.GG_DEBUG) app.commandLine.appendSwitch('remote-debugging-port', process.env.GG_DEBUG);

function git(repo, args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args], { maxBuffer: 64 * 1024 * 1024 }, (err, out) => {
      if (err) reject(err);
      else resolve(out);
    });
  });
}

async function repoInfo(path) {
  const total = parseInt(await git(path, ['rev-list', '--all', '--count']), 10);
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return { name, total };
}

/* mainline = chaîne first-parent de HEAD : une ligne par feature livrée. */
const MODES = {
  all: ['--all', '--date-order'],
  mainline: ['--first-parent', 'HEAD'],
};

/* ponytail: git log --skip re-parcourt l'historique à chaque page — OK jusqu'à ~100k commits,
   passer à un stream spawn persistant si un jour ça rame. */
async function logPage(skip, count, mode) {
  const out = await git(currentRepo.path, [
    'log', ...MODES[mode], '--date=short',
    `--skip=${skip}`, `-n${count}`,
    '--pretty=format:%H%x1f%P%x1f%ad%x1f%an%x1f%D%x1f%s%x1e',
  ]);
  return out.split('\x1e').filter(r => r.includes('\x1f')).map(r => {
    const f = r.split('\x1f');
    return {
      h: f[0].trim().slice(0, 8),
      p: f[1].split(' ').filter(Boolean).map(x => x.slice(0, 8)),
      d: f[2], a: f[3], r: f[4], s: f[5],
    };
  });
}

ipcMain.handle('repo:current', () => currentRepo);

ipcMain.handle('repo:open', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const path = res.filePaths[0];
  try {
    currentRepo = { path, ...(await repoInfo(path)) };
    return currentRepo;
  } catch {
    return { error: 'Not a git repository (or git not found)' };
  }
});

ipcMain.handle('repo:log', (_ev, skip, count, mode) => {
  if (!currentRepo) throw new Error('no repo open');
  if (!Number.isInteger(skip) || !Number.isInteger(count) || skip < 0 || count < 1 || count > 5000)
    throw new Error('bad page args');
  if (!MODES[mode]) throw new Error('bad mode');
  return logPage(skip, count, mode);
});

/* Fichiers touchés. Pour un merge, le renderer passe le first-parent :
   le diff montre ce que le merge a apporté sur la branche cible. */
ipcMain.handle('repo:files', async (_ev, hash, parent) => {
  if (!currentRepo) throw new Error('no repo open');
  if (!/^[0-9a-f]{7,40}$/.test(hash) || (parent != null && !/^[0-9a-f]{7,40}$/.test(parent)))
    throw new Error('bad hash');
  const args = parent
    ? ['diff', '--name-status', parent, hash]
    : ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', hash];
  const out = await git(currentRepo.path, args);
  return out.split('\n').filter(Boolean).map(l => {
    const f = l.split('\t');
    return { st: f[0][0], path: f[2] || f[1], old: f[2] ? f[1] : null };
  });
});

ipcMain.handle('repo:diff', async (_ev, hash, parent, path, oldPath) => {
  if (!currentRepo) throw new Error('no repo open');
  if (!/^[0-9a-f]{7,40}$/.test(hash) || (parent != null && !/^[0-9a-f]{7,40}$/.test(parent)))
    throw new Error('bad hash');
  if (typeof path !== 'string' || (oldPath != null && typeof oldPath !== 'string'))
    throw new Error('bad path');
  const paths = oldPath ? [oldPath, path] : [path];
  const args = parent
    ? ['diff', parent, hash, '--', ...paths]
    : ['show', '--format=', hash, '--', ...paths];
  return git(currentRepo.path, args);
});

ipcMain.handle('repo:total', async (_ev, mode) => {
  if (!currentRepo) throw new Error('no repo open');
  if (!MODES[mode]) throw new Error('bad mode');
  const args = mode === 'mainline' ? ['--first-parent', 'HEAD'] : ['--all'];
  return parseInt(await git(currentRepo.path, ['rev-list', '--count', ...args]), 10);
});

async function createWindow() {
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.GG_REPO) {
    try {
      currentRepo = { path: process.env.GG_REPO, ...(await repoInfo(process.env.GG_REPO)) };
      console.log(`[git-graph] repo: ${currentRepo.name} (${currentRepo.total} commits)`);
    } catch (e) {
      console.error(`[git-graph] GG_REPO invalid: ${e.message}`);
    }
  }

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
