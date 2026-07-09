import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { existsSync, watch } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

/* Repos ouverts, côté main uniquement : le renderer ne les désigne que par un id opaque.
   Un onglet = un repo ouvert ; la fermeture d'onglet passe par repo:close. */
const repos = new Map();
let nextId = 1;
let mainWindow = null;

if (process.env.GG_DEBUG) app.commandLine.appendSwitch('remote-debugging-port', process.env.GG_DEBUG);

/* GIT_TERMINAL_PROMPT=0 : sans TTY, un git qui demande un mot de passe se bloquerait
   indéfiniment. Les helpers de credentials graphiques (GCM) restent utilisables.
   GIT_EDITOR : git n'ouvre pas d'éditeur sans TTY, mais `git flow` est un script shell qui,
   lui, en réclame un pour son tag annoté. `true` le transforme en échec propre. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_MERGE_AUTOEDIT: 'no' };

/* git noie ses erreurs sous des lignes `hint:` : on ne garde que les fatal/error. */
function gitError(err, stderr) {
  if (err.killed) return 'git timed out';
  const lines = (stderr || err.message).split('\n').map(l => l.trim()).filter(Boolean);
  const fatal = lines.filter(l => /^(fatal|error):/.test(l)).slice(0, 2);
  const msg = (fatal.length ? fatal : lines.slice(-1)).map(l => l.replace(/^(fatal|error):\s*/, '')).join(' — ');
  return msg || 'git failed';
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

function git(repo, args, timeout = 0) {
  const id = traceId(repo);
  emitTrace({ id, kind: 'cmd', text: `git ${args.join(' ')}` });
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', repo, ...args], { env: GIT_ENV, windowsHide: true });
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
  persisted.recents = persisted.recents.filter(isRepo);
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
    return { error: 'Not a git repository (or git not found)' };
  }
  /* pas de comptage de commits à l'ouverture : le renderer demandera `total` quand il en
     aura besoin, et restaurer N onglets ne doit pas coûter N `rev-list --all --count`. */
  const r = { id: nextId++, path, name: basename(path), gitDir, running: null, muted: 0, dirty: false, timer: null, watcher: null };
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
   `--all` qui suit. ponytail: idem pour `refs/notes/*` le jour où quelqu'un en pose. */
const ALL_REFS = ['--exclude=refs/stash', '--all'];

/* ponytail: git log --skip re-parcourt l'historique à chaque page — OK jusqu'à ~100k commits,
   passer à un stream spawn persistant si un jour ça rame. */
async function logPage(r, skip, count) {
  /* --decorate=full : `%D` sort alors `refs/heads/x` / `refs/remotes/origin/x` / `refs/tags/x`.
     Sous sa forme courte, `origin/x` et une branche locale `origin/x` sont indistinguables. */
  const out = await git(r.path, [
    'log', ...ALL_REFS, '--date-order', '--date=short', '--decorate=full',
    `--skip=${skip}`, `-n${count}`,
    '--pretty=format:%H%x1f%P%x1f%ad%x1f%an%x1f%ae%x1f%D%x1f%s%x1e',
  ]);
  return out.split('\x1e').filter(row => row.includes('\x1f')).map(row => {
    const f = row.split('\x1f');
    return {
      h: f[0].trim().slice(0, 8),
      p: f[1].split(' ').filter(Boolean).map(x => x.slice(0, 8)),
      d: f[2], a: f[3], e: f[4], r: f[5], s: f[6],
    };
  });
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
const countAll = r => git(r.path, ['rev-list', ...ALL_REFS, '--count']).then(o => parseInt(o, 10));

async function runOp(r, name, auto = false) {
  if (r.running) return;
  r.running = name;
  traceGroup(r.id, auto ? 'Auto-fetch' : OP_GROUP[name]);
  emit({ id: r.id, op: name, state: 'start', auto });
  try {
    const before = name === 'push' ? 0 : await countAll(r);
    await git(r.path, OPS[name], OP_TIMEOUT);
    const added = name === 'push' ? 0 : (await countAll(r)) - before;
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
const WATCHED = /^(?:HEAD|packed-refs)$|^refs[\\/](?:heads|tags)[\\/]/;

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
  if (source === 'untracked') return diffUntracked(r.path, path);
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
   commencerait par `-` et se ferait passer pour une option de git. */
const BRANCH = /^(?!-)(?!.*\.\.)[\w./+-]+$/;

/* L'arbre sale part au stash et revient après la bascule. Bascule refusée : on repose l'arbre
   où on l'a trouvé. `pop` en conflit : git garde l'entrée de stash et pose ses marqueurs —
   on le dit et on n'essaie pas de rattraper, l'utilisateur est déjà sur la bonne branche.
   Son message part sur stdout, que gitError ne voit pas : d'où le nôtre. */
ipcMain.handle('repo:checkout', async (_ev, id, name) => {
  const r = use(id);
  if (typeof name !== 'string' || !BRANCH.test(name)) throw new Error('bad branch');
  traceGroup(r.id, `Checkout ${name}`);
  const dirty = !!(await git(r.path, ['status', '--porcelain', '-uall'])).trim();
  if (dirty) await git(r.path, ['stash', 'push', '-u', '-m', `git-graph: ${name}`]);
  try {
    await git(r.path, ['checkout', name]);
  } catch (e) {
    if (dirty) await git(r.path, ['stash', 'pop']);
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
    /* release et hotfix posent un tag annoté : sans `-m`, `git tag -a` réclamerait un éditeur */
    const tagged = type === 'release' || type === 'hotfix';
    await git(r.path, ['flow', type, 'finish', ...(tagged ? ['-m', version] : []), version], OP_TIMEOUT);
  },
};

ipcMain.handle('repo:flow', (_ev, id) => flowPrefixes(use(id)));

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
    '--format=%(refname)\x1f%(HEAD)\x1f%(upstream:track,nobracket)\x1f%(symref:short)\x1f%(upstream:short)\x1f%(objectname)',
    'refs/heads', 'refs/remotes', 'refs/tags',
  ]);

  /* `<remote>/HEAD` est un symref vers la branche par défaut de la distante : c'est la référence
     de fusion. Plusieurs distantes ? la première dans l'ordre alphabétique tranche. */
  let base = '';
  const refs = out.split('\n').filter(Boolean).flatMap(line => {
    const [refname, head, track = '', symref = '', upstream = '', tip = ''] = line.split('\x1f');
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
       ce qui pointe sur le tronc, tip courant comme commit ancien. */
    const trunk = new Set((await git(r.path, ['rev-list', '--first-parent', base])).split('\n').filter(Boolean));
    for (const ref of refs)
      ref.merged =
        ref.kind === 'head' &&
        ref.name !== mainline &&
        !TRUNK.has(ref.name) &&
        !trunk.has(ref.tip) &&
        merged.has(ref.name);
  }
  for (const ref of refs) delete ref.tip;

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
    ? ['diff', '--name-status', parent, hash]
    : ['diff-tree', '-r', '--root', '--no-commit-id', '--name-status', hash];
  const out = await git(r.path, args);
  return out.split('\n').filter(Boolean).map(l => {
    const f = l.split('\t');
    return { st: f[0][0], path: f[2] || f[1], old: f[2] ? f[1] : null };
  });
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

ipcMain.handle('repo:total', async (_ev, id) =>
  parseInt(await git(use(id).path, ['rev-list', '--count', ...ALL_REFS]), 10));

function createWindow() {
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
  /* liens des messages de commit : au navigateur, jamais dans la fenêtre de l'app */
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
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
