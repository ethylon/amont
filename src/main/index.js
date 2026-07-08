import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from 'electron';
import { execFile } from 'node:child_process';
import { join } from 'node:path';

/* Repo courant, côté main uniquement — le renderer n'a jamais de chemin en direct. */
let currentRepo = null;
let mainWindow = null;

if (process.env.GG_DEBUG) app.commandLine.appendSwitch('remote-debugging-port', process.env.GG_DEBUG);

/* GIT_TERMINAL_PROMPT=0 : sans TTY, un git qui demande un mot de passe se bloquerait
   indéfiniment. Les helpers de credentials graphiques (GCM) restent utilisables. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

/* git noie ses erreurs sous des lignes `hint:` : on ne garde que les fatal/error. */
function gitError(err, stderr) {
  if (err.killed) return 'git timed out';
  const lines = (stderr || err.message).split('\n').map(l => l.trim()).filter(Boolean);
  const fatal = lines.filter(l => /^(fatal|error):/.test(l)).slice(0, 2);
  const msg = (fatal.length ? fatal : lines.slice(-1)).map(l => l.replace(/^(fatal|error):\s*/, '')).join(' — ');
  return msg || 'git failed';
}

function git(repo, args, timeout = 0) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', repo, ...args],
      { maxBuffer: 64 * 1024 * 1024, env: GIT_ENV, windowsHide: true, timeout },
      (err, out, errOut) => err ? reject(new Error(gitError(err, errOut))) : resolve(out));
  });
}

async function repoInfo(path) {
  const total = parseInt(await git(path, ['rev-list', '--all', '--count']), 10);
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return { name, total };
}

/* Branche courante + décalage avec sa distante. Absence d'upstream ou HEAD détachée
   ne sont pas des erreurs : le renderer affiche simplement des tirets. */
async function repoStatus() {
  const branch = (await git(currentRepo.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const head = (await git(currentRepo.path, ['rev-parse', 'HEAD']).catch(() => '')).trim().slice(0, 8) || null;
  if (branch === 'HEAD') return { branch: null, head, ahead: null, behind: null };
  try {
    const [behind, ahead] = (await git(currentRepo.path,
      ['rev-list', '--left-right', '--count', '@{upstream}...HEAD'])).trim().split(/\s+/).map(Number);
    return { branch, head, ahead, behind };
  } catch {
    return { branch, head, ahead: null, behind: null };
  }
}

/* --- Arbre de travail ---
   `status --porcelain=v1 -z` : chaque entrée est `XY<espace>chemin`, X = index, Y = arbre.
   Pour un rename, l'ancien chemin occupe le champ NUL suivant — d'où le ++i. */
const CONFLICT = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function parsePorcelain(out) {
  const parts = out.split('\0');
  const wt = { staged: [], unstaged: [], untracked: [], conflicts: [] };
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1], path = e.slice(3);
    if (x === '?') { wt.untracked.push({ st: '?', path }); continue; }
    if (CONFLICT.has(x + y)) { wt.conflicts.push({ st: x + y, path }); continue; }
    const old = (x === 'R' || x === 'C') ? parts[++i] : null;
    if (x !== ' ') wt.staged.push({ st: x, path, old });
    if (y !== ' ') wt.unstaged.push({ st: y, path });
  }
  return wt;
}

/* Un fichier non suivi n'a pas de contrepartie dans l'index : on le diffe contre le vide.
   `--no-index` sort en 1 dès qu'il y a une différence, ce qui est le cas nominal ici. */
function diffUntracked(repo, path) {
  return new Promise(resolve => {
    execFile('git', ['-C', repo, 'diff', '--no-index', '--', '/dev/null', path],
      { maxBuffer: 64 * 1024 * 1024, env: GIT_ENV, windowsHide: true },
      (_err, out) => resolve(out || ''));
  });
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

/* --- Opérations réseau ---
   Une seule à la fois (git pose ses propres verrous, mais deux fetch concurrents
   se soldent par une erreur inutile). Le résultat part par événement, pas par
   retour d'invoke : l'auto-fetch n'a pas d'appelant côté renderer. */
const OPS = {
  fetch: ['fetch', '--all', '--prune'],
  pull:  ['pull', '--ff-only'],
  push:  ['push'],
};
const OP_TIMEOUT = 90_000;
const AUTOFETCH_MS = 5 * 60_000;

let running = null;
let autoFetchTimer = null;

const emit = payload => mainWindow?.webContents.send('git:op', payload);
const countAll = () => git(currentRepo.path, ['rev-list', '--all', '--count']).then(o => parseInt(o, 10));

async function runOp(name, auto = false) {
  if (!currentRepo || running) return;
  running = name;
  emit({ op: name, state: 'start', auto });
  try {
    const before = name === 'push' ? 0 : await countAll();
    await git(currentRepo.path, OPS[name], OP_TIMEOUT);
    const added = name === 'push' ? 0 : (await countAll()) - before;
    emit({ op: name, state: 'done', auto, added });
  } catch (e) {
    emit({ op: name, state: 'error', auto, message: e.message });
  } finally {
    running = null;
  }
}

function scheduleAutoFetch() {
  clearInterval(autoFetchTimer);
  autoFetchTimer = currentRepo ? setInterval(() => runOp('fetch', true), AUTOFETCH_MS) : null;
}

ipcMain.handle('repo:op', (_ev, name) => {
  if (!OPS[name]) throw new Error('bad op');
  return runOp(name);
});

ipcMain.handle('repo:status', () => {
  if (!currentRepo) throw new Error('no repo open');
  return repoStatus();
});

/* Les chemins arrivent du renderer : ils passent toujours après `--`, jamais comme options. */
function assertPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !p))
    throw new Error('bad paths');
}

ipcMain.handle('repo:worktree', () => {
  if (!currentRepo) throw new Error('no repo open');
  return git(currentRepo.path, ['status', '--porcelain=v1', '-z', '-uall']).then(parsePorcelain);
});

const WT_DIFF = { staged: ['diff', '--cached'], unstaged: ['diff'] };

ipcMain.handle('repo:wtdiff', (_ev, path, source) => {
  if (!currentRepo) throw new Error('no repo open');
  assertPaths([path]);
  if (source === 'untracked') return diffUntracked(currentRepo.path, path);
  if (!WT_DIFF[source]) throw new Error('bad source');
  return git(currentRepo.path, [...WT_DIFF[source], '--', path]);
});

ipcMain.handle('repo:stage', (_ev, paths) => {
  if (!currentRepo) throw new Error('no repo open');
  assertPaths(paths);
  return git(currentRepo.path, ['add', '--', ...paths]).then(() => {});
});

ipcMain.handle('repo:unstage', async (_ev, paths) => {
  if (!currentRepo) throw new Error('no repo open');
  assertPaths(paths);
  /* avant le premier commit il n'y a pas de HEAD, donc rien à restaurer depuis :
     sortir le chemin de l'index le laisse non suivi, ce qui est le résultat attendu. */
  const cmd = await git(currentRepo.path, ['rev-parse', '--verify', '-q', 'HEAD'])
    .then(() => ['restore', '--staged'], () => ['rm', '--cached', '-q']);
  await git(currentRepo.path, [...cmd, '--', ...paths]);
});

ipcMain.handle('repo:commit', (_ev, message) => {
  if (!currentRepo) throw new Error('no repo open');
  if (typeof message !== 'string' || !message.trim()) throw new Error('empty message');
  return git(currentRepo.path, ['commit', '-m', message]).then(() => {});
});

ipcMain.handle('repo:current', () => currentRepo);

ipcMain.handle('repo:open', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  const path = res.filePaths[0];
  try {
    currentRepo = { path, ...(await repoInfo(path)) };
    scheduleAutoFetch();
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
    /* le fond de la fenêtre est peint avant le premier rendu ; sans lui, flash blanc en
       thème sombre. `show: false` + ready-to-show évite d'exposer une fenêtre vide. */
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    icon: join(app.getAppPath(), 'resources/icon.png'),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { mainWindow = null; clearInterval(autoFetchTimer); });

  if (process.env.GG_REPO) {
    try {
      currentRepo = { path: process.env.GG_REPO, ...(await repoInfo(process.env.GG_REPO)) };
      scheduleAutoFetch();
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
