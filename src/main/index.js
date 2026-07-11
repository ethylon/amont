import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { appendFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { parseNameStatus } from './name-status.js';

/* Repos ouverts, côté main uniquement : le renderer ne les désigne que par un id opaque.
   Un onglet = un repo ouvert ; la fermeture d'onglet passe par repo:close. */
const repos = new Map();
let nextId = 1;
let mainWindow = null;

/* Journal d'incidents (crash renderer, erreurs console) : `incidents.log` sous userData.
   En dev il double sur stderr. L'écriture est best-effort — un disque plein ne casse rien. */
function report(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(' ')}`;
  console.error(line);
  appendFile(join(app.getPath('userData'), 'incidents.log'), line + '\n').catch(() => {});
}

if (process.env.GG_DEBUG) app.commandLine.appendSwitch('remote-debugging-port', process.env.GG_DEBUG);

/* GIT_TERMINAL_PROMPT=0 : sans TTY, un git qui demande un mot de passe se bloquerait
   indéfiniment. Les helpers de credentials graphiques (GCM) restent utilisables.
   GIT_EDITOR : git n'ouvre pas d'éditeur sans TTY, mais `git flow` est un script shell qui,
   lui, en réclame un pour son tag annoté. `true` le transforme en échec propre. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' };

/* git noie ses erreurs sous des lignes `hint:` : on ne garde que les fatal/error. */
function gitError(err, stderr) {
  if (err.killed) return 'git ne répond pas (délai dépassé)';
  const lines = (stderr || err.message).split('\n').map(l => l.trim()).filter(Boolean);
  const fatal = lines.filter(l => /^(fatal|error):/.test(l)).slice(0, 2);
  const msg = (fatal.length ? fatal : lines.slice(-1)).map(l => l.replace(/^(fatal|error):\s*/, '')).join(' — ');
  return msg || 'échec de git';
}

/* --- Console (lecture seule) ---
   Toute commande git passe par `git()` : c'est le point unique d'où la console lit ce que
   l'app exécute. On streame stderr ligne à ligne — progression, résumés fetch/push, hints —,
   la seule sortie que git destine à un humain ; stdout est la donnée machine que le renderer
   consomme, jamais affichée. La trace est taguée par l'id de l'onglet, comme `git:op`. */
const emitTrace = payload => mainWindow?.webContents.send('git:trace', payload);
const traceId = repo => { for (const r of repos.values()) if (r.path === repo) return r.id; return 0; };

/* En-tête d'opération : borne le flux au niveau de l'action utilisateur (un push, un pull,
   l'auto-fetch), là où `git()` ne voit que des commandes isolées. Les lectures de fond
   (statut, pages de log) restent sans en-tête, ce qui les distingue à l'œil. */
const traceGroup = (id, text) => emitTrace({ id, kind: 'group', text, ts: Date.now() });

/* `input` part sur stdin (`--stdin` de rev-list) : des listes d'oids y passent sans buter
   sur la limite de longueur de ligne de commande de Windows. */
function git(repo, args, timeout = 0, input = '') {
  const id = traceId(repo);
  emitTrace({ id, kind: 'cmd', text: `git ${args.join(' ')}` });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repo, ...args], { env: GIT_ENV, windowsHide: true });
    child.stdin.on('error', () => {}); // git peut se terminer sans lire : EPIPE sans conséquence
    child.stdin.end(input);
    let out = '', errAll = '', pending = '', killed = false;
    /* setEncoding pose un StringDecoder : une séquence UTF-8 coupée entre deux chunks est
       recollée, là où `buf += chunk` la corromprait. */
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; });
    /* git réécrit sa progression avec \r sur une même ligne : on ne pousse qu'aux \n, donc une
       ligne par étape terminée (« Receiving objects: 100% … »), sans inonder le flux d'IPC. */
    child.stderr.on('data', d => {
      errAll += d;
      pending += d;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const l of lines) { const t = l.replace(/\r+$/, ''); if (t) emitTrace({ id, kind: 'out', text: t }); }
    });
    const timer = timeout ? setTimeout(() => { killed = true; child.kill(); }, timeout) : null;
    child.on('error', err => { clearTimeout(timer); emitTrace({ id, kind: 'exit', ok: false, ms: Date.now() - started }); reject(new Error(gitError(err, errAll))); });
    child.on('close', code => {
      clearTimeout(timer);
      const t = pending.replace(/\r+$/, '');
      if (t) emitTrace({ id, kind: 'out', text: t });
      const ms = Date.now() - started;
      if (killed) { emitTrace({ id, kind: 'exit', ok: false, ms }); return reject(new Error('git timed out')); }
      if (code !== 0) { emitTrace({ id, kind: 'exit', ok: false, ms }); return reject(new Error(gitError({ message: errAll }, errAll))); }
      emitTrace({ id, kind: 'exit', ok: true, ms });
      resolve(out);
    });
  });
}

const basename = p => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const pub = r => ({ id: r.id, path: r.path, name: r.name });

function use(id) {
  const r = repos.get(id);
  if (!r) throw new Error('no repo open');
  return r;
}

/* --- État persisté ---
   userData/state.json. Fichier minuscule, écrit à chaque mutation : une perte au crash
   ne coûte qu'une liste d'onglets. */
let persisted = { root: null, recents: [], tabs: [], active: null };
const stateFile = () => join(app.getPath('userData'), 'state.json');
const saveState = () => writeFile(stateFile(), JSON.stringify(persisted)).catch(() => {});

/* Le renderer n'ouvre que des chemins qu'on lui a montrés : récents, résultats de scan,
   ou choix dans le dialogue système. Sans ce filtre, un renderer compromis (le diff affiche
   du contenu arbitraire) pourrait pointer git — et ses hooks — sur n'importe quel dossier. */
const openable = new Set();

async function loadState() {
  try {
    Object.assign(persisted, JSON.parse(await readFile(stateFile(), 'utf8')));
  } catch { /* premier lancement */ }
  /* un state.json corrompu (JSON valide, forme inattendue) ne doit pas empêcher la fenêtre
     de s'ouvrir : on rabote vers la forme attendue au lieu de laisser le boot échouer */
  const paths = list => (Array.isArray(list) ? list.filter(p => typeof p === 'string') : []);
  persisted.tabs = paths(persisted.tabs);
  persisted.recents = paths(persisted.recents).filter(isRepo);
  if (typeof persisted.root !== 'string') persisted.root = null;
  persisted.tabs.forEach(p => openable.add(p));
  persisted.recents.forEach(p => openable.add(p));
}

const isRepo = p => existsSync(join(p, '.git'));

function remember(path) {
  persisted.recents = [path, ...persisted.recents.filter(p => p !== path)].slice(0, 12);
  openable.add(path);
  saveState();
}

/* --- Cycle de vie d'un repo --- */
async function openRepo(path) {
  const already = [...repos.values()].find(r => r.path === path);
  if (already) return pub(already);

  let gitDir;
  try {
    gitDir = (await git(path, ['rev-parse', '--absolute-git-dir'])).trim();
  } catch {
    return { error: 'Pas un dépôt git (ou git introuvable)' };
  }
  /* pas de comptage de commits à l'ouverture : le renderer demandera `total` quand il en
     aura besoin, et restaurer N onglets ne doit pas coûter N `rev-list --all --count`. */
  const r = { id: nextId++, path, name: basename(path), gitDir, running: null, muted: 0, dirty: false, timer: null, watcher: null, trunk: null };
  r.timer = setInterval(() => runOp(r, 'fetch', true), AUTOFETCH_MS);
  watchGit(r);
  repos.set(r.id, r);
  remember(path);
  return pub(r);
}

function closeRepo(id) {
  const r = repos.get(id);
  if (!r) return;
  clearInterval(r.timer);
  r.watcher?.close();
  repos.delete(id);
}

/* Branche courante + décalage avec sa distante. Absence d'upstream ou HEAD détachée
   ne sont pas des erreurs : le renderer affiche simplement des tirets. */
async function repoStatus(r) {
  const branch = (await git(r.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const head = (await git(r.path, ['rev-parse', 'HEAD']).catch(() => '')).trim().slice(0, 8) || null;
  if (branch === 'HEAD') return { branch: null, head, ahead: null, behind: null };
  try {
    const [behind, ahead] = (await git(r.path,
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

/* `--all` embarque `refs/stash`, dont les commits de plomberie (« On x », « index on x »,
   « untracked files on x ») n'ont rien à faire dans le graphe. `--exclude` s'applique au
   `--all` qui suit. Les stash reviennent quand même dans le log : chaque entrée est passée en
   tip explicite (cf. stashTips), et le renderer replie sa plomberie (cf. graph-canvas).
   ponytail: idem pour `refs/notes/*` le jour où quelqu'un en pose. */
const ALL_REFS = ['--exclude=refs/stash', '--all'];

/* --- Stash ---
   `refs/stash` ne pointe que la dernière entrée : les autres vivent dans le reflog, d'où
   `stash list`. `%as` plutôt que `--date=short` : ce dernier daterait aussi `%gd`, et
   « stash@{2026-07-08} » n'est plus un nom d'entrée exploitable. */
async function stashList(r) {
  const out = await git(r.path, [
    'stash', 'list', '--format=%H%x1f%P%x1f%gd%x1f%as%x1f%an%x1f%ae%x1f%gs%x1e',
  ]).catch(() => '');
  return out.split('\x1e')
    .map(row => row.split('\x1f'))
    .filter(f => f.length >= 7)
    .map(f => ({
      h: f[0].trim().slice(0, 8),
      p: f[1].split(' ').filter(Boolean).map(x => x.slice(0, 8)),
      name: f[2], d: f[3], a: f[4], e: f[5], s: f.slice(6).join(' '),
    }));
}

const stashTips = r => git(r.path, ['stash', 'list', '--format=%H']).catch(() => '')
  .then(o => o.split('\n').filter(Boolean));

/* ponytail: git log --skip re-parcourt l'historique à chaque page — OK jusqu'à ~100k commits,
   passer à un stream spawn persistant si un jour ça rame. */
async function logPage(r, skip, count) {
  /* --decorate=full : `%D` sort alors `refs/heads/x` / `refs/remotes/origin/x` / `refs/tags/x`.
     Sous sa forme courte, `origin/x` et une branche locale `origin/x` sont indistinguables. */
  const out = await git(r.path, [
    'log', ...ALL_REFS, ...await stashTips(r), '--date-order', '--date=short', '--decorate=full',
    `--skip=${skip}`, `-n${count}`,
    '--pretty=format:%H%x1f%P%x1f%ad%x1f%an%x1f%ae%x1f%D%x1f%s%x1e',
  ]);
  /* git ne filtre pas les octets de contrôle de `%s` : un sujet qui contiendrait nos
     séparateurs fabriquerait des champs en trop (recollés au sujet, il est en dernier)
     ou des lignes bancales (écartées par le compte de champs). */
  return out.split('\x1e')
    .map(row => row.split('\x1f'))
    .filter(f => f.length >= 7)
    .map(f => ({
      h: f[0].trim().slice(0, 8),
      p: f[1].split(' ').filter(Boolean).map(x => x.slice(0, 8)),
      d: f[2], a: f[3], e: f[4], r: f[5], s: f.slice(6).join(' '),
    }));
}

/* --- Recherche ---
   git ET-alise `--grep` et `--author` : chaque critère est donc une invocation séparée dont on
   prend l'union. `-F` rend les motifs littéraux, `-S` fouille le contenu des diffs (la pioche).
   ponytail: plafond par critère, pas de pagination — la barre n'affiche qu'un compteur et saute
   de résultat en résultat. */
const SEARCH_MAX = 2000;
const SEARCH_TIMEOUT = 30_000;

async function searchCommits(r, q, content) {
  const base = ['log', ...ALL_REFS, '--format=%H', `-n${SEARCH_MAX}`, '-i', '-F'];
  const runs = [
    git(r.path, [...base, `--grep=${q}`]),
    git(r.path, [...base, `--author=${q}`]),
  ];
  /* un préfixe de hash n'est pas un motif : rev-parse le résout, ou échoue (inconnu, ambigu) */
  if (/^[0-9a-f]{4,40}$/i.test(q))
    runs.push(git(r.path, ['rev-parse', '--verify', '-q', `${q}^{commit}`]).catch(() => ''));
  /* la pioche relit le diff de chaque commit : lente, donc jamais implicite */
  if (content) runs.push(git(r.path, [...base, `-S${q}`], SEARCH_TIMEOUT));

  const outs = await Promise.all(runs);
  return [...new Set(outs.join('\n').split('\n').filter(Boolean).map(h => h.slice(0, 8)))];
}

/* --- Opérations réseau ---
   Une par repo à la fois (git pose ses propres verrous, mais deux fetch concurrents sur le
   même dépôt se soldent par une erreur inutile). Le résultat part par événement, pas par
   retour d'invoke : l'auto-fetch n'a pas d'appelant côté renderer. */
/* --progress : sans TTY git tait sa progression ; on la force pour que la console la streame. */
const OPS = {
  fetch: ['fetch', '--all', '--prune', '--progress'],
  pull:  ['pull', '--ff-only', '--progress'],
  push:  ['push', '--progress'],
};
const OP_GROUP = { fetch: 'Fetch', pull: 'Pull', push: 'Push' };
const OP_TIMEOUT = 90_000;
const AUTOFETCH_MS = 5 * 60_000;

const emit = payload => mainWindow?.webContents.send('git:op', payload);

/* Tips de toutes les refs, dédupliqués et triés : deux instantanés égaux = rien n'a bougé.
   Bien moins cher que le `rev-list --all --count` intégral qu'on payait deux fois par fetch. */
const refTips = r => git(r.path, ['for-each-ref', '--format=%(objectname)', 'refs/heads', 'refs/remotes', 'refs/tags'])
  .then(o => [...new Set(o.split('\n').filter(Boolean))].sort());

/* Commits joignables des refs actuelles mais pas des anciens tips : les « nouveaux » du fetch.
   Plus juste que la différence de deux comptages, qu'un `--prune` faisait mentir. */
const countNew = (r, before) =>
  git(r.path, ['rev-list', '--count', ...ALL_REFS, '--stdin'], 0, before.map(h => `^${h}\n`).join(''))
    .then(o => parseInt(o, 10));

async function runOp(r, name, auto = false) {
  if (r.running) {
    /* jamais en silence : la fenêtre entre le clic et l'état `busy` du renderer est réelle */
    if (!auto) emit({ id: r.id, op: name, state: 'error', auto, message: 'Une opération est déjà en cours' });
    return;
  }
  r.running = name;
  traceGroup(r.id, auto ? 'Auto-fetch' : OP_GROUP[name]);
  emit({ id: r.id, op: name, state: 'start', auto });
  try {
    /* seul le fetch affiche un compteur ; pull recharge le graphe, push n'ajoute rien */
    const before = name === 'fetch' ? await refTips(r) : null;
    await git(r.path, OPS[name], OP_TIMEOUT);
    let added = 0;
    if (before) {
      const after = await refTips(r);
      if (after.join() !== before.join()) added = await countNew(r, before);
    }
    emit({ id: r.id, op: name, state: 'done', auto, added });
  } catch (e) {
    emit({ id: r.id, op: name, state: 'error', auto, message: e.message });
  } finally {
    mute(r);
    r.running = null;
  }
}

/* --- Surveillance de .git ---
   git ne notifie rien : on regarde bouger les seuls fichiers qui changent le graphe — HEAD
   (bascule), les refs locales, et `packed-refs` (gc, suppression de branche). L'index relève
   de l'arbre de travail, `objects/` n'est que du bruit, et `refs/remotes/` appartient au fetch,
   qui annonce déjà son résultat.

   Hors premier plan on retient l'événement au lieu de l'émettre : relire un dépôt que personne
   ne regarde ne sert à rien, et Windows ne suspend rien de lui-même.

   ponytail: dans un worktree lié, `--absolute-git-dir` pointe `.git/worktrees/<nom>` — HEAD y est,
   mais pas les refs. Surveiller aussi `--git-common-dir` le jour où le cas se présente. */
const WATCH_DEBOUNCE = 300;
const MUTE_MS = 1500;
/* `refs/stash` et son reflog : un `git stash` lancé d'un terminal change le graphe. Un drop
   d'une entrée ancienne ne touche que `logs/refs/stash`, d'où la surveillance des deux. */
const WATCHED = /^(?:HEAD|packed-refs)$|^refs[\\/](?:heads|tags)[\\/]|^(?:logs[\\/])?refs[\\/]stash$/;

/* Nos propres commandes réveillent le watcher, alors que le renderer a déjà rechargé derrière
   elles. On ne sait pas distinguer ces événements des autres : on se tait un instant. */
const mute = r => { r.muted = Date.now() + MUTE_MS; };

const emitChange = r => mainWindow?.webContents.send('git:changed', { id: r.id });

function watchGit(r) {
  let timer;
  const fire = () => {
    if (r.running || Date.now() < r.muted) return;
    if (mainWindow?.isFocused()) emitChange(r);
    else r.dirty = true;
  };
  try {
    r.watcher = watch(r.gitDir, { recursive: true }, (_type, file) => {
      if (!file || file.endsWith('.lock') || !WATCHED.test(file)) return;
      clearTimeout(timer);
      timer = setTimeout(fire, WATCH_DEBOUNCE);
    });
    r.watcher.on('error', () => {}); // volume démonté, dépôt effacé : on cesse de surveiller, sans bruit
  } catch { /* pas de watcher : l'app reste utilisable, le rafraîchissement redevient manuel */ }
}

app.on('browser-window-focus', () => repos.forEach(r => {
  if (!r.dirty) return;
  r.dirty = false;
  emitChange(r);
}));

/* --- Découverte des dépôts sous la racine ---
   ponytail: profondeur 3 et pas de dépôt dans un dépôt. Couvre `~/Projets/<client>/<repo>` ;
   à revoir si des dépôts se cachent plus bas. */
const DEPTH = 3;
const SKIP = new Set(['node_modules', 'bin', 'obj', 'dist', 'out', 'target', 'vendor']);

async function scan(dir, depth, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dossier illisible : il n'a rien à nous dire
  }
  if (entries.some(e => e.name === '.git')) return void found.push(dir);
  if (depth === DEPTH) return;
  await Promise.all(entries
    .filter(e => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
    .map(e => scan(join(dir, e.name), depth + 1, found)));
}

/* --- IPC : état de l'application --- */

/* Appelé une fois au démarrage du renderer. Ouvre les repos des onglets restaurés — ceux
   qui ont disparu du disque sont simplement omis. */
ipcMain.handle('app:state', async () => {
  const paths = process.env.GG_REPO ? [process.env.GG_REPO, ...persisted.tabs] : persisted.tabs;
  const tabs = [];
  for (const path of [...new Set(paths)]) {
    const r = await openRepo(path);
    if (!r.error) tabs.push(r);
  }
  return {
    root: persisted.root,
    recents: persisted.recents.map(path => ({ path, name: basename(path) })),
    tabs,
    active: tabs.find(t => t.path === persisted.active)?.id ?? tabs[0]?.id ?? null,
  };
});

/* Ce que l'écran d'accueil connaît des dépôts. Séparé de app:state, qui ouvre des repos. */
ipcMain.handle('app:repos', () => ({
  root: persisted.root,
  recents: persisted.recents.map(path => ({ path, name: basename(path) })),
}));

ipcMain.handle('app:tabs', (_ev, paths, active) => {
  persisted.tabs = paths.filter(p => openable.has(p));
  persisted.active = active;
  saveState();
});

ipcMain.handle('repo:openDialog', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return openRepo(res.filePaths[0]);
});

ipcMain.handle('repo:openPath', (_ev, path) => {
  if (!openable.has(path)) throw new Error('bad path');
  return openRepo(path);
});

ipcMain.handle('repo:close', (_ev, id) => closeRepo(id));

ipcMain.handle('root:choose', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths.length) return persisted.root;
  persisted.root = res.filePaths[0];
  saveState();
  return persisted.root;
});

ipcMain.handle('root:scan', async () => {
  if (!persisted.root) return [];
  const found = [];
  await scan(persisted.root, 0, found);
  found.forEach(p => openable.add(p));
  return found
    .map(path => ({ path, name: basename(path) }))
    .sort((a, b) => a.name.localeCompare(b.name));
});

/* --- IPC : opérations sur un repo, id en premier argument --- */

ipcMain.handle('repo:op', (_ev, id, name) => {
  if (!OPS[name]) throw new Error('bad op');
  return runOp(use(id), name);
});

ipcMain.handle('repo:status', (_ev, id) => repoStatus(use(id)));

/* Les chemins arrivent du renderer : ils passent toujours après `--`, jamais comme options. */
function assertPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.some(p => typeof p !== 'string' || !p))
    throw new Error('bad paths');
}

/* Chemin absolu confiné au dépôt : git nous protège du `--`, pas d'un `../..` passé à shell. */
function inRepo(r, path) {
  assertPaths([path]);
  const full = resolve(r.path, path);
  if (!full.startsWith(r.path + sep)) throw new Error('bad path');
  return full;
}

/* Icône Windows du fichier. Absent du disque (supprimé, vieux commit) : le renderer retombe
   sur son icône générique. */
ipcMain.handle('repo:fileIcon', (_ev, id, path) =>
  app.getFileIcon(inRepo(use(id), path), { size: 'small' }).then(i => i.toDataURL(), () => null));

ipcMain.handle('repo:openFile', (_ev, id, path) => shell.openPath(inRepo(use(id), path)));

ipcMain.handle('repo:worktree', (_ev, id) =>
  git(use(id).path, ['status', '--porcelain=v1', '-z', '-uall']).then(parsePorcelain));

const WT_DIFF = { staged: ['diff', '--cached'], unstaged: ['diff'] };

ipcMain.handle('repo:wtdiff', (_ev, id, path, source) => {
  const r = use(id);
  assertPaths([path]);
  /* `--no-index` lit n'importe quel chemin du disque : confiné au dépôt, comme fileIcon */
  if (source === 'untracked') return diffUntracked(r.path, inRepo(r, path));
  if (!WT_DIFF[source]) throw new Error('bad source');
  return git(r.path, [...WT_DIFF[source], '--', path]);
});

ipcMain.handle('repo:stage', (_ev, id, paths) => {
  const r = use(id);
  assertPaths(paths);
  return git(r.path, ['add', '--', ...paths]).then(() => {});
});

ipcMain.handle('repo:unstage', async (_ev, id, paths) => {
  const r = use(id);
  assertPaths(paths);
  /* avant le premier commit il n'y a pas de HEAD, donc rien à restaurer depuis :
     sortir le chemin de l'index le laisse non suivi, ce qui est le résultat attendu. */
  const cmd = await git(r.path, ['rev-parse', '--verify', '-q', 'HEAD'])
    .then(() => ['restore', '--staged'], () => ['rm', '--cached', '-q']);
  await git(r.path, [...cmd, '--', ...paths]);
});

ipcMain.handle('repo:commit', (_ev, id, message, amend) => {
  const r = use(id);
  if (typeof message !== 'string' || !message.trim()) throw new Error('empty message');
  traceGroup(r.id, amend ? 'Amend' : 'Commit');
  const args = ['commit', ...(amend ? ['--amend'] : []), '-m', message];
  return git(r.path, args).then(() => mute(r));
});

/* ponytail: filtre de sûreté, pas un parseur de refname — refuse surtout le nom qui
   commencerait par `-` et se ferait passer pour une option de git. Liste noire plutôt que
   blanche : `[\w./+-]` refusait les lettres accentuées et `@`, pourtant légaux dans un refname. */
const BRANCH = /^(?!-)(?!.*\.\.)(?!.*@\{)[^\x00-\x20\x7f~^:?*[\\]+$/;

/* L'arbre sale part au stash et revient après la bascule. Bascule refusée : on repose l'arbre
   où on l'a trouvé. `pop` en conflit : git garde l'entrée de stash et pose ses marqueurs —
   on le dit et on n'essaie pas de rattraper, l'utilisateur est déjà sur la bonne branche.
   Son message part sur stdout, que gitError ne voit pas : d'où le nôtre. */
ipcMain.handle('repo:checkout', async (_ev, id, name) => {
  const r = use(id);
  if (typeof name !== 'string' || !BRANCH.test(name)) throw new Error('bad branch');
  traceGroup(r.id, `Checkout ${name}`);
  const dirty = !!(await git(r.path, ['status', '--porcelain', '-uall'])).trim();
  if (dirty) await git(r.path, ['stash', 'push', '-u', '-m', `amont: ${name}`]);
  try {
    await git(r.path, ['checkout', name]);
  } catch (e) {
    /* le pop de rattrapage peut lui-même échouer (conflit) : l'entrée de stash survit,
       et c'est l'échec du checkout — la cause — qu'on remonte, pas celui du pop */
    if (dirty) await git(r.path, ['stash', 'pop']).catch(() => {});
    throw e;
  } finally {
    mute(r); // HEAD a bougé : le renderer recharge de lui-même, le watcher n'a rien à ajouter
  }
  if (dirty) await git(r.path, ['stash', 'pop']).catch(() => {
    throw new Error(`Sur ${name}, mais le stash entre en conflit — entrée conservée`);
  });
});

/* --- Actions de branche (menu contextuel) ---
   Aucun événement : le renderer a lancé l'action, c'est lui qui recharge et affiche l'erreur.
   `running` est le verrou des opérations réseau — il tient l'auto-fetch et le watcher à l'écart
   le temps d'un merge ou d'un `git flow finish`. */

const FLOW_TYPES = ['feature', 'bugfix', 'release', 'hotfix'];
const BRANCH_GROUP = { merge: 'Fusion', delete: 'Suppression', pull: 'Pull', push: 'Push', finish: 'Clôture flow' };

/** Les préfixes posés par `git flow init` dans la config, ou `null` : le dépôt ignore git-flow. */
async function flowPrefixes(r) {
  const out = await git(r.path, ['config', '--get-regexp', '^gitflow\\.prefix\\.']).catch(() => '');
  const prefixes = {};
  for (const line of out.split('\n').filter(Boolean)) {
    const [key, value = ''] = line.split(' ');
    prefixes[key.slice('gitflow.prefix.'.length)] = value;
  }
  return FLOW_TYPES.some(t => prefixes[t]) ? prefixes : null;
}

/** La distante suivie par une branche, telle que sa config la déclare. */
async function upstreamOf(r, name) {
  const read = key => git(r.path, ['config', '--get', `branch.${name}.${key}`]).then(o => o.trim(), () => '');
  const [remote, merge] = await Promise.all([read('remote'), read('merge')]);
  if (!remote || !merge) throw new Error(`${name} ne suit aucune branche distante`);
  return { remote, merge };
}

const BRANCH_OPS = {
  merge: (r, name) => git(r.path, ['merge', name], OP_TIMEOUT),

  /* `-d`, jamais `-D` : le refus de git sur une branche non fusionnée est le seul garde-fou
     qu'on ait — le menu ne demande pas confirmation. La distante, elle, reste en place. */
  delete: (r, name) => git(r.path, ['branch', '-d', name]),

  /* On ne fetche pas dans une branche sortie : sur HEAD, c'est un pull. Ailleurs, le refspec
     explicite est fast-forward-only, et git en profite pour remettre `refs/remotes/…` à jour. */
  async pull(r, name) {
    const { remote, merge } = await upstreamOf(r, name);
    const current = (await git(r.path, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    await git(r.path, name === current
      ? ['pull', '--ff-only', '--progress']
      : ['fetch', remote, `${merge}:refs/heads/${name}`, '--progress'], OP_TIMEOUT);
  },

  /* Le refspec nomme les deux côtés : `git push <remote> <branche>` pousserait vers une branche
     de même nom, quand bien même l'upstream en porte un autre. */
  async push(r, name) {
    const { remote, merge } = await upstreamOf(r, name);
    await git(r.path, ['push', remote, `refs/heads/${name}:${merge}`, '--progress'], OP_TIMEOUT);
  },

  /* `git flow` fait tout — merge, tag, back-merge, suppression de la branche. Le réimplémenter,
     c'est s'écarter en silence de la sémantique que l'utilisateur attend de son outil.
     ponytail: l'extension n'est pas installée ? le message de git le dira au clic. */
  async finish(r, name) {
    const prefixes = (await flowPrefixes(r)) ?? {};
    const type = FLOW_TYPES.find(t => prefixes[t] && name.startsWith(prefixes[t]));
    if (!type) throw new Error(`${name} n'est pas une branche git-flow`);
    const version = name.slice(prefixes[type].length);
    /* BRANCH n'interdit le `-` qu'en tête du nom complet : `feature/-D` donnerait
       version = '-D', que git-flow lirait comme une option (suppression forcée) */
    if (version.startsWith('-')) throw new Error(`${name} : suffixe de branche invalide`);
    /* release et hotfix posent un tag annoté : sans `-m`, `git tag -a` réclamerait un éditeur */
    const tagged = type === 'release' || type === 'hotfix';
    await git(r.path, ['flow', type, 'finish', ...(tagged ? ['-m', version] : []), version], OP_TIMEOUT);
  },
};

ipcMain.handle('repo:flow', (_ev, id) => flowPrefixes(use(id)));

/* --- Contexte de flow de la branche courante ---
   Lecture seule : ce que la branche a produit et où son finish atterrira. Le renderer classe
   la branche (préfixes gitflow ou conventions) ; main ne fait que mesurer. */
const SEMVER_RE = /^v?\d+\.\d+\.\d+/;
const cfgOf = (r, key) => git(r.path, ['config', '--get', key]).then(o => o.trim(), () => '');

async function flowInfo(r, branch, kind) {
  const [headsOut, cfgMaster, cfgDevelop] = await Promise.all([
    git(r.path, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    cfgOf(r, 'gitflow.branch.master'),
    cfgOf(r, 'gitflow.branch.develop'),
  ]);
  const heads = new Set(headsOut.split('\n').filter(Boolean));
  const master = cfgMaster || ['master', 'main'].find(b => heads.has(b)) || null;
  const develop = cfgDevelop || (heads.has('develop') ? 'develop' : null);
  /* un hotfix part du tronc de production, tout le reste du tronc d'intégration */
  const parent = kind === 'hotfix' ? master : develop ?? master;
  if (!parent || !heads.has(parent) || parent === branch) return null;

  const tagged = kind === 'release' || kind === 'hotfix';
  /* ponytail: describe prend le tag le plus proche, semver ou non — le bump s'en protège par regex */
  const [commits, lastTag] = await Promise.all([
    git(r.path, ['rev-list', '--count', `${parent}..${branch}`]).then(o => parseInt(o, 10)),
    tagged ? git(r.path, ['describe', '--tags', '--abbrev=0', branch]).then(o => o.trim(), () => null) : null,
  ]);
  const startedAt = commits
    ? parseInt((await git(r.path, ['log', '--format=%ct', '--reverse', `${parent}..${branch}`])).split('\n', 1)[0], 10)
    : null;

  /* le tag du finish : gitflow nomme la branche par sa version ; sinon, bump du dernier tag —
     patch pour un hotfix, minor pour une release */
  let nextTag = null;
  if (tagged) {
    const prefixes = (await flowPrefixes(r)) ?? {};
    const prefix = prefixes[kind] && branch.startsWith(prefixes[kind]) ? prefixes[kind] : `${kind}/`;
    /* même garde que finish : un suffixe en `-…` n'est jamais une version */
    const raw = branch.startsWith(prefix) ? branch.slice(prefix.length) : '';
    const suffix = raw.startsWith('-') ? '' : raw;
    const m = !SEMVER_RE.test(suffix) && lastTag && /^(v?)(\d+)\.(\d+)\.(\d+)/.exec(lastTag);
    nextTag = SEMVER_RE.test(suffix) ? suffix
      : m ? (kind === 'hotfix' ? `${m[1]}${m[2]}.${m[3]}.${+m[4] + 1}` : `${m[1]}${m[2]}.${+m[3] + 1}.0`)
        : null;
  }

  return {
    commits,
    startedAt: Number.isFinite(startedAt) ? startedAt : null,
    base: lastTag ?? parent,
    targets: tagged ? [master, develop].filter(Boolean) : [parent],
    nextTag,
  };
}

ipcMain.handle('repo:flowInfo', (_ev, id, branch, kind) => {
  const r = use(id);
  if (typeof branch !== 'string' || !BRANCH.test(branch)) throw new Error('bad branch');
  if (!FLOW_TYPES.includes(kind)) throw new Error('bad kind');
  return flowInfo(r, branch, kind);
});

ipcMain.handle('repo:branch', async (_ev, id, action, name) => {
  const r = use(id);
  if (!Object.hasOwn(BRANCH_OPS, action)) throw new Error('bad action');
  if (typeof name !== 'string' || !BRANCH.test(name)) throw new Error('bad branch');
  if (r.running) throw new Error('Une opération est déjà en cours sur ce dépôt');
  r.running = action;
  traceGroup(r.id, `${BRANCH_GROUP[action]} ${name}`);
  try {
    await BRANCH_OPS[action](r, name);
  } finally {
    mute(r);
    r.running = null;
  }
});

ipcMain.handle('repo:log', (_ev, id, skip, count) => {
  const r = use(id);
  if (!Number.isInteger(skip) || !Number.isInteger(count) || skip < 0 || count < 1 || count > 5000)
    throw new Error('bad page args');
  return logPage(r, skip, count);
});

/* Refs telles que git les voit. `origin/HEAD` est un alias d'affichage : il ferait doublon
   avec la branche par défaut de la distante. */
const REF_KINDS = [['refs/heads/', 'head'], ['refs/remotes/', 'remote'], ['refs/tags/', 'tag']];
/* Branches d'intégration : jamais signalées « fusionnées », on ne les nettoie pas. */
const TRUNK = new Set(['main', 'master', 'develop']);

ipcMain.handle('repo:refs', async (_ev, id) => {
  const r = use(id);
  const out = await git(r.path, [
    'for-each-ref', '--sort=refname',
    '--format=%(refname)\x1f%(HEAD)\x1f%(upstream:track,nobracket)\x1f%(symref:short)\x1f%(upstream:short)\x1f%(objectname)\x1f%(*objectname)',
    'refs/heads', 'refs/remotes', 'refs/tags',
  ]);

  /* `<remote>/HEAD` est un symref vers la branche par défaut de la distante : c'est la référence
     de fusion. Plusieurs distantes ? la première dans l'ordre alphabétique tranche. */
  let base = '';
  const refs = out.split('\n').filter(Boolean).flatMap(line => {
    const [refname, head, track = '', symref = '', upstream = '', oid = '', peeled = ''] = line.split('\x1f');
    /* `%(*objectname)` pèle un tag annoté vers son commit ; vide pour une branche ou un tag léger */
    const tip = peeled || oid;
    const kind = REF_KINDS.find(([prefix]) => refname.startsWith(prefix));
    if (!kind) return [];
    const name = refname.slice(kind[0].length);
    if (kind[1] === 'remote' && name.endsWith('/HEAD')) {
      base ||= symref;
      return [];
    }
    const ahead = /ahead (\d+)/.exec(track);
    const behind = /behind (\d+)/.exec(track);
    return [{
      name,
      kind: kind[1],
      head: head === '*',
      upstream,
      ahead: ahead ? +ahead[1] : 0,
      behind: behind ? +behind[1] : 0,
      merged: false,
      gone: track === 'gone',
      tip,
    }];
  });

  /* Sans distante, on retombe sur la convention. Sans convention non plus, personne n'est
     « mergé » : mieux vaut ne rien dire que désigner une base arbitraire. */
  base ||= ['main', 'master', 'develop'].find(b => refs.some(x => x.kind === 'head' && x.name === b)) || '';
  if (base) {
    /* `origin/main` → `main` ; une base déjà locale traverse inchangée. La branche
       d'intégration est ancêtre d'elle-même : la marquer n'apprendrait rien. */
    const mainline = base.slice(base.indexOf('/') + 1);
    const out = await git(r.path, ['for-each-ref', '--merged', base, '--format=%(refname:short)', 'refs/heads']);
    const merged = new Set(out.split('\n').filter(Boolean));
    /* `--merged` inclut tout ancêtre de la base : une branche fraîche ou en retard, posée sur un
       commit du tronc, y figure sans rien avoir « fini ». Son tip est alors sur la chaîne
       first-parent de la base — un simple signet dans l'historique. Seule une branche dont le tip
       quitte le tronc (côté second parent d'un merge) a réellement été fusionnée : on écarte tout
       ce qui pointe sur le tronc, tip courant comme commit ancien.

       La chaîne parcourt tout l'historique et les refs sont relues à chaque rafraîchissement :
       on la met en cache tant que le tip de la base n'a pas bougé. */
    const baseTip = (await git(r.path, ['rev-parse', base])).trim();
    if (r.trunk?.key !== `${base} ${baseTip}`) {
      const chain = (await git(r.path, ['rev-list', '--first-parent', base])).split('\n').filter(Boolean);
      r.trunk = { key: `${base} ${baseTip}`, set: new Set(chain) };
    }
    const trunk = r.trunk.set;
    for (const ref of refs)
      ref.merged =
        ref.kind === 'head' &&
        ref.name !== mainline &&
        !TRUNK.has(ref.name) &&
        !trunk.has(ref.tip) &&
        merged.has(ref.name);
  }
  /* le graphe indexe les commits par hash court : `merged` s'est servi du SHA complet, on rabote */
  for (const ref of refs) ref.tip = ref.tip.slice(0, 8);

  /* Une branche suivie annonce `gone` d'elle-même. Sans upstream — poussée sans `-u`, ou config
     jamais posée — la suppression distante emporte jusqu'au reflog de `refs/remotes/…` : ne
     reste que le reflog local, où `branch: Created from origin/x` témoigne du lien passé. Une
     branche née localement n'y mentionne jamais son propre nom distant, et n'est donc pas barrée.

     ponytail: un reflog expiré (gc, 90 j) rend la branche indiscernable d'une branche locale. */
  const remoteRefs = refs.filter(x => x.kind === 'remote').map(x => x.name);
  const present = new Set(remoteRefs.map(n => n.slice(n.indexOf('/') + 1)));
  const remoteNames = [...new Set(remoteRefs.map(n => n.slice(0, n.indexOf('/'))))];

  await Promise.all(refs.map(async ref => {
    if (ref.kind !== 'head' || ref.gone || !remoteNames.length || present.has(ref.name)) return;
    const reflog = await git(r.path, ['reflog', 'show', '--format=%gs', ref.name]).catch(() => '');
    ref.gone = remoteNames.some(remote => reflog.includes(`${remote}/${ref.name}`));
  }));
  return refs;
});

/* Fichiers touchés. Pour un merge, le renderer passe le first-parent :
   le diff montre ce que le merge a apporté sur la branche cible. */
ipcMain.handle('repo:files', async (_ev, id, hash, parent) => {
  const r = use(id);
  if (!/^[0-9a-f]{7,40}$/.test(hash) || (parent != null && !/^[0-9a-f]{7,40}$/.test(parent)))
    throw new Error('bad hash');
  const args = parent
    ? ['diff', '--name-status', '-z', parent, hash]
    : ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', '-z', hash];
  return parseNameStatus(await git(r.path, args));
});

/* Corps du message, à la demande. Le joindre au log coûterait, pour n'en afficher qu'un,
   une copie de tous les messages longs de l'historique. */
ipcMain.handle('repo:body', (_ev, id, hash) => {
  const r = use(id);
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('bad hash');
  return git(r.path, ['show', '-s', '--format=%b', hash]);
});

/* Sujet et corps du dernier commit, pour préremplir un amend. `%B` est le message brut :
   la première ligne est le sujet, le reste (après la ligne vide) la description. */
ipcMain.handle('repo:headMessage', async (_ev, id) => {
  const r = use(id);
  const raw = await git(r.path, ['show', '-s', '--format=%B', 'HEAD']);
  const nl = raw.indexOf('\n');
  const subject = (nl < 0 ? raw : raw.slice(0, nl)).trim();
  const body = (nl < 0 ? '' : raw.slice(nl + 1)).replace(/^\n+/, '').trimEnd();
  return { subject, body };
});

ipcMain.handle('repo:diff', async (_ev, id, hash, parent, path, oldPath) => {
  const r = use(id);
  if (!/^[0-9a-f]{7,40}$/.test(hash) || (parent != null && !/^[0-9a-f]{7,40}$/.test(parent)))
    throw new Error('bad hash');
  if (typeof path !== 'string' || (oldPath != null && typeof oldPath !== 'string'))
    throw new Error('bad path');
  const paths = oldPath ? [oldPath, path] : [path];
  const args = parent
    ? ['diff', parent, hash, '--', ...paths]
    : ['show', '--format=', hash, '--', ...paths];
  return git(r.path, args);
});

ipcMain.handle('repo:search', (_ev, id, q, content) => {
  const r = use(id);
  if (typeof q !== 'string' || q.trim().length < 2) return [];
  return searchCommits(r, q.trim(), content === true);
});

/* Le comptage embarque les tips de stash, comme le log. Chaque entrée traîne 1 à 2 commits
   de plomberie (index, non suivis) que le renderer replie : on les soustrait pour que
   `total` reste le nombre de lignes réellement affichables. Dédupliqués : deux stash créés
   dans la même seconde partagent le même commit d'index (même arbre, même parent, même date). */
ipcMain.handle('repo:total', async (_ev, id) => {
  const r = use(id);
  const stashes = await stashList(r);
  const plumbing = new Set(stashes.flatMap(s => s.p.slice(1)));
  const count = parseInt(await git(r.path,
    ['rev-list', '--count', ...ALL_REFS, ...stashes.map(s => s.h)]), 10);
  return count - plumbing.size;
});

ipcMain.handle('repo:stashes', (_ev, id) => stashList(use(id)));

/* --- Actions de stash ---
   apply/pop/drop visent une entrée par son nom `stash@{N}` — les indices glissent après un
   drop, le renderer recharge la liste derrière chaque action. push remise l'arbre entier,
   non suivis compris, avec le message fourni. */
const STASH_NAME = /^stash@\{\d+\}$/;
const STASH_GROUP = { push: 'Stash', apply: 'Stash apply', pop: 'Stash pop', drop: 'Stash drop' };

ipcMain.handle('repo:stash', async (_ev, id, action, arg) => {
  const r = use(id);
  if (!Object.hasOwn(STASH_GROUP, action)) throw new Error('bad stash action');
  let args;
  if (action === 'push') {
    const msg = typeof arg === 'string' && arg.trim() ? arg.trim() : null;
    args = ['stash', 'push', '-u', ...(msg ? ['-m', msg] : [])];
  } else {
    if (typeof arg !== 'string' || !STASH_NAME.test(arg)) throw new Error('bad stash name');
    args = ['stash', action, arg];
  }
  traceGroup(r.id, action === 'push' ? STASH_GROUP.push : `${STASH_GROUP[action]} ${arg}`);
  try {
    await git(r.path, args);
  } finally {
    mute(r);
  }
});

function createWindow() {
  /* pas de menu File|Edit|View : l'app n'en expose aucun, les raccourcis vivent dans le renderer */
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1300,
    height: 850,
    /* sous cette largeur, sidebar + colonne détail (556px fixes) écraseraient le graphe */
    minWidth: 900,
    minHeight: 600,
    /* le fond de la fenêtre est peint avant le premier rendu ; sans lui, flash blanc en
       thème sombre. `show: false` + ready-to-show évite d'exposer une fenêtre vide. */
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    icon: join(app.getAppPath(), 'resources/icon.png'),
    webPreferences: {
      /* le preload est bundlé en CJS (cf. electron.vite.config) : un preload ESM
         exigerait sandbox: false, et l'app affiche du contenu de dépôt non maîtrisé —
         le bac à sable Chromium est la dernière ligne de défense du renderer. */
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  /* Un renderer mort laisse une fenêtre noire et sourde (plus de clavier, F5 inopérant) :
     on journalise l'incident puis on recharge d'office. Le journal survit au crash —
     c'est lui qu'on lit après coup pour comprendre. */
  win.webContents.on('render-process-gone', (_ev, d) => {
    report('renderer gone:', d.reason, `(exit ${d.exitCode})`);
    if (d.reason !== 'clean-exit') win.webContents.reload();
  });
  win.webContents.on('unresponsive', () => report('renderer unresponsive'));
  win.webContents.on('responsive', () => report('renderer responsive again'));
  win.webContents.on('console-message', (...a) => {
    /* Electron ≥ 32 passe un objet évènement ; forme positionnelle (level 3 = error) en repli.
       Les 404 de ressources (avatars) ne sont pas des incidents. */
    const m = a[0] && a[0].message !== undefined ? a[0] : { level: a[1], message: a[2] };
    const error = m.level === 'error' || Number(m.level) >= 3;
    if (error && !String(m.message).includes('Failed to load resource')) {
      report('[renderer]', String(m.message).slice(0, 500));
    }
  });
  win.once('ready-to-show', () => win.show());
  /* liens des messages de commit : au navigateur, jamais dans la fenêtre de l'app */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  /* la fenêtre ne navigue jamais (un fichier glissé dessus chargerait son file://) ;
     seul le rechargement du serveur de dev garde le droit de passage */
  win.webContents.on('will-navigate', (ev, url) => {
    if (!process.env.ELECTRON_RENDERER_URL || !url.startsWith(process.env.ELECTRON_RENDERER_URL)) ev.preventDefault();
  });
  win.on('closed', () => {
    mainWindow = null;
    repos.forEach(r => { clearInterval(r.timer); r.watcher?.close(); });
    repos.clear();
  });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(loadState).then(createWindow);
app.on('window-all-closed', () => app.quit());
