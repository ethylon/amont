import { html as d2hHtml } from 'diff2html';
import 'diff2html/bundles/css/diff2html.min.css';
import { codeToTokens } from 'shiki';

const api = window.gitgraph;

const ROW = 28, LANE = 14, PAD = 10, R = 4, CHUNK = 500, PAGE = 1000;
/* Les teintes vivent dans le @theme Tailwind : var() dans un attribut de présentation SVG suit le thème seul. */
const LANES = 10;
const laneColor = i => `var(--color-lane-${i % LANES})`;

let DATA = [], TOTAL = 0, NCHUNKS = 0, exhausted = false, fetching = null;
let MODE = 'all';   // 'all' | 'mainline' (first-parent de HEAD)
let gen = 0;        // invalide les fetchs en vol après un reset

/* État de layout persistant entre les pages — le graphe se construit en streaming. */
let S;
function resetState() {
  S = {
    lanes: [], meta: [], pending: new Map(), next: 0,
    rowOf: new Map(),
    nodes: Array.from({ length: NCHUNKS }, () => []),
    edges: Array.from({ length: NCHUNKS }, () => []),
    long: [], ms: 0,
    laneOf: [],               // lane de chaque ligne
    fpEdge: [],               // arête first-parent partant de chaque ligne
    fpChildren: new Map(),    // hash -> lignes des enfants dont il est le first-parent
    mergedBy: new Map(),      // hash -> ligne du merge qui l'a absorbé (second parent)
  };
}

function alloc() { let i = S.lanes.indexOf(null); if (i < 0) { i = S.lanes.length; S.lanes.push(null); } return i; }

function layoutChunk() {
  const t0 = performance.now();
  const end = Math.min(S.next + CHUNK, DATA.length);
  for (let row = S.next; row < end; row++) {
    const c = DATA[row];
    const waiting = [];
    S.lanes.forEach((h, i) => { if (h === c.h) waiting.push(i); });
    let lane = waiting.find(i => S.meta[i] === 0);           // continuité first-parent d'abord
    if (lane === undefined) lane = waiting.length ? Math.min(...waiting) : alloc();
    waiting.forEach(i => { S.lanes[i] = null; S.meta[i] = -1; });

    (S.pending.get(c.h) || []).forEach(e => {
      e.r2 = row; e.l2 = lane;
      const c1 = Math.floor(e.r1 / CHUNK);
      (c1 === Math.floor(row / CHUNK) ? S.edges[c1] : S.long).push(e);
    });
    S.pending.delete(c.h);
    S.rowOf.set(c.h, row);
    S.laneOf[row] = lane;
    S.nodes[Math.floor(row / CHUNK)].push({ row, lane, merge: c.p.length > 1 });

    c.p.forEach((p, k) => {
      let travel;
      const e = S.lanes.indexOf(p);
      if (k === 0) {
        if (e >= 0) travel = e;         // fusion : rejoint la ligne qui vise déjà ce parent
        else { travel = lane; S.lanes[lane] = p; S.meta[lane] = 0; }
      } else {
        travel = e >= 0 ? e : alloc();
        S.lanes[travel] = p;
        if (e < 0 && S.meta[travel] !== 0) S.meta[travel] = k;
      }
      if (!S.pending.has(p)) S.pending.set(p, []);
      const rec = { r1: row, l1: lane, travel, k };
      S.pending.get(p).push(rec);
      if (k === 0) {
        S.fpEdge[row] = rec;
        if (!S.fpChildren.has(p)) S.fpChildren.set(p, []);
        S.fpChildren.get(p).push(row);
      } else {
        S.mergedBy.set(p, row);
      }
    });
  }
  S.next = end;
  S.ms += performance.now() - t0;
}

const X = l => PAD + l * LANE + LANE / 2;
const Y = r => r * ROW + ROW / 2;

function edgePath(e, yEnd) {
  const x1 = X(e.l1), y1 = Y(e.r1), xt = X(e.travel);
  const x2 = e.r2 !== undefined ? X(e.l2) : xt;
  const y2 = e.r2 !== undefined ? Y(e.r2) : yEnd;
  if (x1 === xt && xt === x2) return `M${x1} ${y1}V${y2}`;
  if (e.r2 !== undefined && e.r2 - e.r1 === 1)
    return `M${x1} ${y1}C${x1} ${y1 + ROW * .7} ${x2} ${y2 - ROW * .7} ${x2} ${y2}`;
  let d = `M${x1} ${y1}`;
  d += x1 === xt ? `V${y1 + ROW}` : `C${x1} ${y1 + ROW * .9} ${xt} ${y1 + ROW * .1} ${xt} ${y1 + ROW}`;
  d += `V${e.r2 !== undefined ? y2 - ROW : y2}`;
  if (e.r2 !== undefined) d += xt === x2 ? `V${y2}` : `C${xt} ${y2 - ROW * .1} ${x2} ${y2 - ROW * .9} ${x2} ${y2}`;
  return d;
}

const stroke = e => laneColor(e.travel);

function edgesSvg(list) {
  return list.map(e => `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6"/>`).join('');
}
function nodesSvg(list) {
  return list.map(n => {
    const c = laneColor(n.lane);
    return n.merge
      ? `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R - .8}" fill="var(--color-surface)" stroke="${c}" stroke-width="1.8"/>`
      : `<circle cx="${X(n.lane)}" cy="${Y(n.row)}" r="${R}" fill="${c}" stroke="var(--color-surface)" stroke-width="1.5"/>`;
  }).join('');
}

/* Badges de type : conventions internes, typos incluses.
   ponytail: table d'alias explicite — passer en config si les conventions bougent. */
const TYPE_OF = {};
Object.entries({
  feature: ['FEATURE', 'FEAUTRE', 'FEATTURE'],
  hotfix:  ['HOTFIX', 'HOTFIXE', 'HTOFIX', 'HOTIFX', 'HOFTIX'],
  bugfix:  ['BUGFIX', 'BUGFIXE', 'BUFGIXE'],
  plugin:  ['PLUGIN', 'PLUGINS'],
  release: ['RELEASE'],
  beta:    ['BETA'],
  backup:  ['AUTOBACKUP'],
  wip:     ['WIP'],
}).forEach(([type, aliases]) => aliases.forEach(a => TYPE_OF[a] = type));

/* Conventional Commits : seuls les types connus donnent un badge,
   un "truc: machin" quelconque reste du texte. */
const CONVENTIONAL = {
  feat: 'feature', fix: 'bugfix', hotfix: 'hotfix', perf: 'perf',
  refactor: 'refactor', chore: 'chore', docs: 'docs', test: 'test',
  tests: 'test', style: 'style', ci: 'ci', build: 'build',
  release: 'release', revert: 'revert', wip: 'wip',
};

function parseSubject(s) {
  let m = /^\s*\[([^\]]+)\]\s*(.*)/.exec(s);
  if (m) {
    const type = TYPE_OF[m[1].toUpperCase().replace(/[^A-Z]/g, '')];
    return { type: type || 'other', label: type || m[1].toLowerCase(), text: m[2] || s };
  }
  m = /^([A-Za-z]+)(\([^)]*\))?!?:\s+(.*)/.exec(s);
  if (m) {
    const type = CONVENTIONAL[m[1].toLowerCase()];
    if (type) return { type, label: type, text: (m[2] ? m[2] + ' ' : '') + m[3] };
  }
  return { type: null, label: null, text: s };
}

function typeChip(ps) {
  const b = document.createElement('span');
  b.className = 'chip type type-' + ps.type;
  b.textContent = ps.label;
  return b;
}

/* Merges gitflow : "Merge branch 'X' into Y" → chips X → Y.
   Un merge de synchro (remote-tracking ou 'X' of <url> vers la même branche) est du bruit. */
function parseMerge(s) {
  let m = /^Merge (remote-tracking )?branch '([^']+)'( of \S+)?(?: into '?(.+?)'?)?$/.exec(s);
  if (m) {
    const from = m[2], to = m[4] || null;
    const noise = !!(m[1] || m[3]) && (!to || from.replace(/^origin\//, '') === to);
    return { from, to, noise };
  }
  m = /^Merge tag '([^']+)'(?: into '?(.+?)'?)?$/.exec(s);
  if (m) return { from: m[1], to: m[2] || null, tag: true, noise: false };
  return null;
}

const MAIN_TARGETS = /^(develop|master|main|release\/.+)$/;

const svg = document.getElementById('graph');
const inner = document.getElementById('inner');
const board = document.getElementById('board');
const svgNS = 'http://www.w3.org/2000/svg';
const overlay = document.createElementNS(svgNS, 'g');   // long + dangling, toujours monté
svg.appendChild(overlay);

const mountedG = new Map(), mountedRows = new Map();

function chunkG(ci) {
  const g = document.createElementNS(svgNS, 'g');
  g.innerHTML = edgesSvg(S.edges[ci]) + nodesSvg(S.nodes[ci]);
  return g;
}

function rowDiv(i) {
  const c = DATA[i];
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.i = i;
  if (SELECTION.has(i)) row.classList.add('sel');
  const ps = parseSubject(c.s);
  const badge = document.createElement('div');
  badge.className = 'badge-cell';
  if (ps.label) badge.appendChild(typeChip(ps));
  row.appendChild(badge);
  const subj = document.createElement('div');
  subj.className = 'subject';
  (c.r ? c.r.split(', ') : []).filter(Boolean).forEach(ref => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    if (ref.startsWith('HEAD')) { chip.classList.add('head'); ref = ref.replace('HEAD -> ', ''); }
    if (ref.startsWith('tag: ')) { chip.classList.add('tag'); ref = ref.slice(5); }
    chip.textContent = ref; chip.title = ref;
    subj.appendChild(chip);
  });
  const mg = c.p.length > 1 ? parseMerge(c.s) : null;
  if (mg) {
    if (mg.noise) row.classList.add('noise');
    subj.title = c.s;
    const from = document.createElement('span');
    from.className = 'chip' + (mg.tag ? ' tag' : '') +
      (!mg.noise && mg.to && MAIN_TARGETS.test(mg.to) ? ' head' : '');
    from.textContent = mg.from; from.title = mg.from;
    subj.appendChild(from);
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    subj.appendChild(arrow);
    const to = document.createElement('span');
    to.className = 'chip';
    to.textContent = mg.to || 'HEAD'; to.title = mg.to || '';
    subj.appendChild(to);
  } else {
    const s = document.createElement('span');
    s.textContent = ps.text; s.title = c.s;
    subj.appendChild(s);
  }
  row.appendChild(subj);
  for (const [cls, val] of [['author', c.a], ['date mono', c.d], ['hash mono', c.h]]) {
    const el = document.createElement('span');
    el.className = cls; el.textContent = val;
    row.appendChild(el);
  }
  return row;
}

function chunkRows(ci) {
  const div = document.createElement('div');
  div.className = 'rowchunk';
  div.style.top = ci * CHUNK * ROW + 'px';
  const end = Math.min((ci + 1) * CHUNK, S.next);
  for (let i = ci * CHUNK; i < end; i++) div.appendChild(rowDiv(i));
  return div;
}

let graphW = 0;
function refresh() {
  graphW = PAD * 2 + S.lanes.length * LANE;
  const h = S.next * ROW;
  svg.setAttribute('width', graphW);
  svg.setAttribute('height', h);
  svg.setAttribute('viewBox', `0 0 ${graphW} ${h}`);
  inner.style.height = h + 'px';
  inner.style.minWidth = graphW + 706 + 'px';   // graphe + place pour les colonnes texte
  /* sur <body> et pas sur .inner : la ligne d'arbre de travail vit hors du scroller */
  document.body.style.setProperty('--graphw', graphW + 'px');
  let dang = '';
  S.pending.forEach(list => list.forEach(e => {
    dang += `<path d="${edgePath(e, h)}" fill="none" stroke="${stroke(e)}" stroke-width="1.6" stroke-dasharray="2 4" opacity="0.45"/>`;
  }));
  overlay.innerHTML = edgesSvg(S.long) + dang;
  const nd = [...S.pending.values()].reduce((n, l) => n + l.length, 0);
  document.getElementById('stats').innerHTML =
    `<span class="stat"><b>${S.next.toLocaleString('fr')}</b> / ${TOTAL.toLocaleString('fr')} commits</span>` +
    `<span class="stat"><b>${S.lanes.length}</b> lanes</span>` +
    `<span class="stat"><b>${nd}</b> arêtes en attente</span>` +
    `<span class="stat">layout <b>${S.ms.toFixed(0)} ms</b></span>`;
}

async function fetchMore() {
  if (exhausted) return;
  if (!fetching) {
    const g = gen;
    fetching = api.log(DATA.length, PAGE, MODE).then(page => {
      if (g !== gen) return;   // reset entre-temps : page obsolète
      DATA.push(...page);
      if (page.length < PAGE || DATA.length >= TOTAL) exhausted = true;
      fetching = null;
    });
  }
  return fetching;
}

function sync() {
  const c0 = Math.max(0, Math.floor(board.scrollTop / (CHUNK * ROW)) - 1);
  const c1 = Math.min(NCHUNKS - 1, Math.floor((board.scrollTop + board.clientHeight) / (CHUNK * ROW)) + 1);
  const need = (c1 + 1) * CHUNK;
  if (S.next < Math.min(need, DATA.length)) {
    while (S.next < Math.min(need, DATA.length)) layoutChunk();
    refresh();
  }
  if (need > DATA.length && !exhausted) fetchMore().then(sync);
  mountedG.forEach((g, ci) => { if (ci < c0 || ci > c1) { g.remove(); mountedG.delete(ci); } });
  mountedRows.forEach((d, ci) => { if (ci < c0 || ci > c1) { d.remove(); mountedRows.delete(ci); } });
  for (let ci = c0; ci <= c1 && ci * CHUNK < S.next; ci++) {
    if (!mountedG.has(ci)) { const g = chunkG(ci); svg.insertBefore(g, overlay); mountedG.set(ci, g); }
    if (!mountedRows.has(ci)) {
      const d = chunkRows(ci);
      inner.appendChild(d); mountedRows.set(ci, d);
    }
  }
}

function remount() {
  mountedG.forEach(g => g.remove()); mountedG.clear();
  mountedRows.forEach(d => d.remove()); mountedRows.clear();
  sync();
}

/* pas de throttle : sync() est un no-op quand la plage de chunks visibles n'a pas changé */
board.addEventListener('scroll', sync, { passive: true });

/* --- Hover : surligne la ligne de branche du commit survolé --- */
const hlG = document.createElementNS(svgNS, 'g');
hlG.setAttribute('class', 'hl');
svg.appendChild(hlG);
let hoverChain = null;

/* segment de branche : chaîne first-parent vers le bas, remontée tant que l'enfant first-parent est unique */
function branchChain(i) {
  const rows = [i];
  let r = i;
  for (;;) {
    const pr = S.rowOf.get(DATA[r].p[0]);
    if (pr === undefined) break;
    rows.push(pr);
    r = pr;
  }
  r = i;
  for (;;) {
    const kids = S.fpChildren.get(DATA[r].h);
    if (!kids || kids.length !== 1) break;
    r = kids[0];
    rows.unshift(r);
  }
  return rows;
}

function chainInfo(rows) {
  const tip = DATA[rows[0]];
  const ref = tip.r
    ? tip.r.split(', ').filter(x => x && !x.startsWith('tag: ')).map(x => x.replace('HEAD -> ', ''))[0]
    : null;
  const mrow = S.mergedBy.get(tip.h);
  if (mrow !== undefined) {
    const to = parseMerge(DATA[mrow].s)?.to;
    return `${ref ? ref + ' · ' : ''}mergée${to ? ' dans ' + to : ''} (${DATA[mrow].h})`;
  }
  return ref ? `${ref} · non mergée` : 'segment non mergé';
}

function clearHover() {
  hoverChain = null;
  hlG.innerHTML = '';
  svg.classList.remove('dim');
  document.getElementById('hoverinfo').hidden = true;
}

function hoverRow(i) {
  if (hoverChain?.has(i)) return;
  const rows = branchChain(i);
  hoverChain = new Set(rows);
  let sv = '';
  const nodes = [];
  rows.forEach(r => {
    const e = S.fpEdge[r];
    if (e && e.r2 !== undefined)
      sv += `<path d="${edgePath(e)}" fill="none" stroke="${stroke(e)}" stroke-width="2.6"/>`;
    nodes.push({ row: r, lane: S.laneOf[r], merge: DATA[r].p.length > 1 });
  });
  hlG.innerHTML = sv + nodesSvg(nodes);
  svg.classList.add('dim');
  const pill = document.getElementById('hoverinfo');
  pill.textContent = chainInfo(rows);
  pill.hidden = false;
}

inner.addEventListener('mouseover', ev => {
  const row = ev.target.closest('.row');
  if (row) hoverRow(+row.dataset.i);
});
board.addEventListener('mouseleave', clearHover);

/* Sélection = Set d'indices, pas un nœud DOM : survit au démontage des chunks virtualisés. */
const SELECTION = new Set();
let SELMODE = 'multi';   // 'multi' (ctrl+clic) | 'branch' (double-clic : diff net de la branche)
let panelGen = 0;   // invalide les chargements de panneau en vol

function applySel() {
  inner.querySelectorAll('.row').forEach(r => r.classList.toggle('sel', SELECTION.has(+r.dataset.i)));
}

function select(i, additive = false) {
  SELMODE = 'multi';
  VIEW = 'commits';
  if (additive) SELECTION.has(i) ? SELECTION.delete(i) : SELECTION.add(i);
  else { SELECTION.clear(); SELECTION.add(i); }
  applySel();
  renderPanel();
}

function renderPanel() {
  const gen = ++panelGen;
  closeDiff();
  const panel = document.getElementById('panel');
  wtrow.classList.toggle('sel', VIEW === 'wt');
  if (VIEW === 'wt') return renderWorktree(panel);
  const sel = [...SELECTION].sort((a, b) => a - b);
  if (!sel.length) { panel.innerHTML = '<p class="hint">Clique un commit pour le détail.</p>'; return; }
  if (sel.length === 1) renderSingle(panel, sel[0], gen);
  else if (SELMODE === 'branch') renderBranch(panel, sel, gen);
  else renderMulti(panel, sel, gen);
}

/* segment de branche : borné au fork point, contrairement à branchChain (hover) qui descend jusqu'à la racine */
function branchSegment(i) {
  const rows = [i];
  let r = i;
  for (;;) {
    const kids = S.fpChildren.get(DATA[r].h);
    if (!kids || kids.length !== 1) break;
    r = kids[0];
    rows.unshift(r);
  }
  r = i;
  for (;;) {
    const p = DATA[r].p[0];
    const pr = S.rowOf.get(p);
    if (pr === undefined) break;
    if ((S.fpChildren.get(p) || []).length !== 1) break;   // le parent est un fork : tronc commun
    rows.push(pr);
    r = pr;
  }
  return rows;
}

function renderBranch(panel, sel, gen) {
  panel.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = `Branche · ${sel.length} commit${sel.length > 1 ? 's' : ''}`;
  panel.appendChild(h2);
  const info = document.createElement('p');
  info.className = 'hint';
  info.textContent = chainInfo(sel);
  panel.appendChild(info);
  const files = document.createElement('div');
  files.className = 'files';
  files.replaceChildren(loadingEl());
  panel.appendChild(files);
  /* diff net de la branche : une seule commande git entre les extrémités */
  const ctx = { hash: DATA[sel[0]].h, parent: DATA[sel[sel.length - 1]].p[0] || null };
  api.files(ctx.hash, ctx.parent).then(list => {
    if (panelGen !== gen) return;
    renderFiles(files, list, ctx);
  }).catch(() => {
    if (panelGen === gen) files.innerHTML = '<p class="hint">Diff indisponible.</p>';
  });
}

function renderMulti(panel, sel, gen) {
  panel.innerHTML = '';
  const h2 = document.createElement('h2');
  h2.textContent = `${sel.length} commits sélectionnés`;
  panel.appendChild(h2);
  const list = document.createElement('div');
  list.className = 'multilist';
  sel.forEach(i => {
    const c = DATA[i];
    const line = document.createElement('div');
    line.className = 'multirow';
    const h = document.createElement('span');
    h.className = 'mono';
    h.textContent = c.h;
    const s = document.createElement('span');
    s.className = 'msub';
    s.textContent = parseSubject(c.s).text;
    s.title = c.s;
    line.append(h, s);
    list.appendChild(line);
  });
  panel.appendChild(list);
  const files = document.createElement('div');
  files.className = 'files';
  files.replaceChildren(loadingEl());
  panel.appendChild(files);
  Promise.all(sel.map(i => api.files(DATA[i].h, DATA[i].p[0] || null).then(l => ({ i, l }))))
    .then(results => {
      if (panelGen !== gen) return;
      /* fusion : une entrée par fichier ; DATA est du plus récent au plus ancien,
         on rejoue du plus ancien au plus récent → le statut le plus récent gagne. */
      const byPath = new Map();
      results.sort((a, b) => b.i - a.i);
      results.forEach(({ l }) => l.forEach(f => byPath.set(f.path, f)));
      /* diff par fichier pris entre le parent du plus ancien et le plus récent sélectionné */
      const ctx = { hash: DATA[sel[0]].h, parent: DATA[sel[sel.length - 1]].p[0] || null };
      renderFiles(files, [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path)), ctx);
    })
    .catch(() => { if (panelGen === gen) files.innerHTML = '<p class="hint">Diff indisponible.</p>'; });
}

function renderSingle(panel, i, gen) {
  const c = DATA[i];
  panel.innerHTML = '';
  const h2 = document.createElement('h2');
  const ps = parseSubject(c.s);
  if (ps.label) { const b = typeChip(ps); b.style.marginRight = '6px'; h2.appendChild(b); }
  h2.appendChild(document.createTextNode(ps.text));
  panel.appendChild(h2);
  const dl = document.createElement('dl');
  const add = (dt, build) => {
    const t = document.createElement('dt'); t.textContent = dt;
    const d = document.createElement('dd'); build(d);
    dl.append(t, d);
  };
  add('commit', d => { d.className = 'mono'; d.textContent = c.h; });
  add('auteur', d => d.textContent = c.a);
  add('date', d => { d.className = 'mono'; d.textContent = c.d; });
  add(c.p.length > 1 ? 'parents' : 'parent', d => {
    if (!c.p.length) d.textContent = '(racine)';
    c.p.forEach((p, k) => {
      const a = document.createElement('a');
      a.className = 'parent mono';
      a.textContent = p + (c.p.length > 1 ? (k === 0 ? '  (first-parent)' : '  (mergé)') : '');
      a.addEventListener('click', () => jumpTo(p));
      d.appendChild(a);
    });
  });
  panel.appendChild(dl);
  if (c.r) {
    const refs = document.createElement('div');
    refs.className = 'refs';
    c.r.split(', ').filter(Boolean).forEach(ref => {
      const chip = document.createElement('span');
      chip.className = 'chip' + (ref.startsWith('HEAD') ? ' head' : ref.startsWith('tag: ') ? ' tag' : '');
      chip.textContent = ref.replace('HEAD -> ', '').replace('tag: ', '');
      refs.appendChild(chip);
    });
    panel.appendChild(refs);
  }

  const files = document.createElement('div');
  files.className = 'files';
  files.replaceChildren(loadingEl());
  panel.appendChild(files);
  api.files(c.h, c.p[0] || null).then(list => {
    if (panelGen !== gen) return;   // autre sélection entre-temps
    renderFiles(files, list, { hash: c.h, parent: c.p[0] || null });
  }).catch(() => {
    if (panelGen === gen) files.innerHTML = '<p class="hint">Diff indisponible.</p>';
  });
}

/* n'apparaît qu'après 150 ms : pas de flicker sur les chargements instantanés */
function loadingEl() {
  const w = document.createElement('div');
  w.className = 'loading';
  const s = document.createElement('span');
  s.className = 'spinner';
  w.append(s, 'fichiers…');
  return w;
}

const ICONS = {
  flat: '<svg viewBox="0 0 16 16"><path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/></svg>',
  tree: '<svg viewBox="0 0 16 16"><path d="M4.5 3v9.5M4.5 7h5.5M4.5 12.5h5.5"/><circle cx="4.5" cy="3" r="1.3"/><circle cx="12" cy="7" r="1.3"/><circle cx="12" cy="12.5" r="1.3"/></svg>',
  unified: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 6.5h6M5 9.5h6"/></svg>',
  sbs: '<svg viewBox="0 0 16 16"><rect x="2" y="2.5" width="5" height="11" rx="1"/><rect x="9" y="2.5" width="5" height="11" rx="1"/></svg>',
};

function iconButton(mode, label) {
  const b = document.createElement('button');
  b.innerHTML = ICONS[mode];
  b.title = label;
  b.setAttribute('aria-label', label);
  return b;
}

let FILEVIEW = localStorage.getItem('gg.fileview') || 'flat';

function fileLine(f, depth, nameOnly, ctx) {
  const line = document.createElement('div');
  line.className = 'file';
  if (ctx) line.addEventListener('click', () => openDiff(ctx, f, line));
  if (depth) line.style.paddingLeft = depth * 12 + 'px';
  const st = document.createElement('span');
  st.className = 'st mono st-' + f.st;
  st.textContent = f.st;
  line.appendChild(st);
  const path = document.createElement('span');
  path.className = 'path mono';
  path.title = f.path + (f.old ? `  ←  ${f.old}` : '');
  const cut = f.path.lastIndexOf('/');
  if (!nameOnly && cut >= 0) {
    const dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = f.path.slice(0, cut + 1);
    path.appendChild(dir);
  }
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = nameOnly ? f.name : f.path.slice(cut + 1);
  path.appendChild(name);
  line.appendChild(path);
  return line;
}

function buildTree(list) {
  const root = { dirs: new Map(), files: [] };
  for (const f of list) {
    const parts = f.path.split('/');
    let n = root;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!n.dirs.has(parts[i])) n.dirs.set(parts[i], { dirs: new Map(), files: [] });
      n = n.dirs.get(parts[i]);
    }
    n.files.push({ ...f, name: parts[parts.length - 1] });
  }
  return root;
}

function countFiles(d) {
  let n = d.files.length;
  d.dirs.forEach(c => { n += countFiles(c); });
  return n;
}

/* Arbre en <details>/<summary> natif : repli, clavier et état gratuits. */
function renderTree(node, box, ctx) {
  [...node.dirs.keys()].sort((a, b) => a.localeCompare(b)).forEach(k => {
    const d = node.dirs.get(k);
    const det = document.createElement('details');
    det.open = true;
    det.className = 'tdir';
    const sum = document.createElement('summary');
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▸';
    const name = document.createElement('span');
    name.className = 'dname mono';
    name.textContent = k + '/';
    const cnt = document.createElement('span');
    cnt.className = 'cnt';
    cnt.textContent = countFiles(d);
    sum.append(chev, name, cnt);
    det.appendChild(sum);
    const kids = document.createElement('div');
    kids.className = 'tkids';
    renderTree(d, kids, ctx);
    det.appendChild(kids);
    box.appendChild(det);
  });
  node.files.sort((a, b) => a.name.localeCompare(b.name))
    .forEach(f => box.appendChild(fileLine(f, 0, true, ctx)));
}

function renderFiles(box, list, ctx) {
  box.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'files-head';
  const count = document.createElement('span');
  count.textContent = list.length ? `${list.length} fichier${list.length > 1 ? 's' : ''}` : 'aucun fichier';
  head.appendChild(count);
  if (list.length) {
    const tg = document.createElement('span');
    tg.className = 'viewtoggle';
    [['flat', 'Vue à plat'], ['tree', 'Arborescence']].forEach(([mode, label]) => {
      const b = iconButton(mode, label);
      b.classList.toggle('active', FILEVIEW === mode);
      b.addEventListener('click', () => {
        FILEVIEW = mode;
        localStorage.setItem('gg.fileview', mode);
        renderFiles(box, list, ctx);
      });
      tg.appendChild(b);
    });
    head.appendChild(tg);
  }
  box.appendChild(head);
  if (FILEVIEW === 'tree') renderTree(buildTree(list), box, ctx);
  else list.forEach(f => box.appendChild(fileLine(f, 0, false, ctx)));
}

/* --- Vue diff : le panneau s'élargit, une seule vue à la fois --- */
let diffGen = 0;
let DIFFVIEW = localStorage.getItem('gg.diffview') || 'unified';

/* Un ctx porte soit un couple de commits, soit la source dans l'arbre de travail. */
const diffText = (ctx, f) => ctx.wt
  ? api.wtdiff(f.path, ctx.wt)
  : api.diff(ctx.hash, ctx.parent, f.path, f.old || null);

function closeDiff() {
  diffGen++;
  document.querySelector('.layout').classList.remove('diffing', 'sbs');
  document.querySelectorAll('.file.active').forEach(e => e.classList.remove('active'));
  document.querySelector('#panel .diffbox')?.remove();
}

async function renderDiff(body, text) {
  document.querySelector('.layout').classList.toggle('sbs', DIFFVIEW === 'sbs');
  if (!text.trim()) { body.innerHTML = '<p class="hint">Diff vide.</p>'; return; }
  /* ponytail: au-delà de 3000 lignes, rendu brut sans coloration — diff2html rame, personne ne lit */
  if (text.split('\n').length > 3000) { renderDiffText(body, text); return; }
  body.innerHTML = d2hHtml(text, {
    outputFormat: DIFFVIEW === 'sbs' ? 'side-by-side' : 'line-by-line',
    drawFileList: false,
    matching: 'lines',
    colorScheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
  });
  await shikiPass(body);
}

/* Coloration shiki par-dessus le rendu diff2html.
   Les segments <ins>/<del> (word-diff) sont préservés en re-répartissant les tokens. */
/* extensions maison -> grammaire shiki */
const LANG_ALIASES = { jet: 'sql' };

async function shikiPass(body) {
  let lang = body.querySelector('.d2h-file-wrapper')?.getAttribute('data-lang');
  if (!lang || lang === 'txt') return;
  lang = LANG_ALIASES[lang] || lang;
  const ctns = [...body.querySelectorAll('.d2h-code-line-ctn')];
  if (!ctns.length) return;
  const theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'github-dark' : 'github-light';
  let lines;
  try {
    lines = (await codeToTokens(ctns.map(e => e.textContent).join('\n'), { lang, theme })).tokens;
  } catch {
    return;   // grammaire inconnue : on reste brut
  }
  ctns.forEach((ctn, i) => {
    const tokens = lines[i];
    if (!tokens || !tokens.length) return;
    const marks = [];
    let off = 0;
    for (const n of ctn.childNodes) {
      const len = n.textContent.length;
      if (n.nodeType === 1 && (n.tagName === 'INS' || n.tagName === 'DEL'))
        marks.push({ start: off, end: off + len, shell: n.cloneNode(false), el: null });
      off += len;
    }
    ctn.textContent = '';
    let pos = 0;
    for (const t of tokens) {
      let local = 0;
      while (local < t.content.length) {
        const abs = pos + local;
        const mark = marks.find(m => abs >= m.start && abs < m.end);
        const limit = mark
          ? mark.end
          : Math.min(...marks.filter(m => m.start > abs).map(m => m.start), Infinity);
        const end = Math.min(t.content.length, limit - pos);
        const span = document.createElement('span');
        span.style.color = t.color;
        span.textContent = t.content.slice(local, end);
        if (mark) {
          if (!mark.el) { mark.el = mark.shell; ctn.appendChild(mark.el); }
          mark.el.appendChild(span);
        } else {
          ctn.appendChild(span);
        }
        local = end;
      }
      pos += t.content.length;
    }
  });
}

function renderDiffText(body, text) {
  body.innerHTML = '';
  const lines = text.split('\n');
  const MAX = 3000;   // ponytail: au-delà, personne ne lit un diff dans un panneau
  if (!text.trim()) {
    body.innerHTML = '<p class="hint">Diff vide.</p>';
    return;
  }
  lines.slice(0, MAX).forEach(l => {
    const d = document.createElement('div');
    const cls =
      /^(diff |index |new file|deleted file|similarity|rename |--- |\+\+\+ )/.test(l) ? 'meta' :
      l.startsWith('@@') ? 'hunk' :
      l[0] === '+' ? 'add' :
      l[0] === '-' ? 'del' : 'ctx';
    d.className = 'dl ' + cls;
    d.textContent = l || ' ';
    body.appendChild(d);
  });
  if (lines.length > MAX) {
    const more = document.createElement('div');
    more.className = 'dl meta';
    more.textContent = `… ${(lines.length - MAX).toLocaleString('fr')} lignes tronquées`;
    body.appendChild(more);
  }
}

async function openDiff(ctx, f, lineEl) {
  const gen = ++diffGen;
  document.querySelectorAll('.file.active').forEach(e => e.classList.remove('active'));
  lineEl.classList.add('active');
  const panel = document.getElementById('panel');
  panel.querySelector('.diffbox')?.remove();
  const box = document.createElement('div');
  box.className = 'diffbox';
  const head = document.createElement('div');
  head.className = 'diffhead';
  const path = document.createElement('span');
  path.className = 'mono dpath';
  path.textContent = f.path;
  const body = document.createElement('div');
  body.className = 'diffbody';
  body.appendChild(loadingEl());
  let text = null;
  const tg = document.createElement('span');
  tg.className = 'viewtoggle';
  [['unified', 'Diff unifié'], ['sbs', 'Côte à côte']].forEach(([m, label]) => {
    const b = iconButton(m, label);
    b.dataset.m = m;
    b.classList.toggle('active', DIFFVIEW === m);
    b.addEventListener('click', () => {
      DIFFVIEW = m;
      localStorage.setItem('gg.diffview', m);
      tg.querySelectorAll('button').forEach(x => x.classList.toggle('active', x.dataset.m === m));
      if (text != null) renderDiff(body, text);
    });
    tg.appendChild(b);
  });
  const close = document.createElement('button');
  close.textContent = '✕';
  close.title = 'Fermer (Échap)';
  close.addEventListener('click', closeDiff);
  head.append(path, tg, close);
  box.append(head, body);
  panel.appendChild(box);
  document.querySelector('.layout').classList.add('diffing');
  box.scrollIntoView({ block: 'nearest' });
  try {
    text = await diffText(ctx, f);
    if (diffGen !== gen) return;
    renderDiff(body, text);
  } catch {
    if (diffGen === gen) body.innerHTML = '<p class="hint">Diff indisponible.</p>';
  }
}

/* --- Coquille : sidebar et palette. Le <dialog> natif fournit backdrop, focus trap et Échap. --- */
const palette = document.getElementById('palette');

document.getElementById('togglesidebar').addEventListener('click', () => document.body.classList.toggle('nosidebar'));
document.getElementById('opencmd').addEventListener('click', () => palette.showModal());
palette.addEventListener('click', ev => { if (ev.target.closest('.pal-item')) palette.close(); });

document.addEventListener('keydown', ev => {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); palette.showModal(); return; }
  if (ev.key === 'Escape' && !palette.open) closeDiff();
});

/* --- Opérations git ---
   Le clic lance l'opération, mais tout le retour passe par api.onOp : l'auto-fetch
   du process main émet sur le même canal sans avoir d'appelant côté renderer. */
const OP_LABEL = { fetch: 'Fetch…', pull: 'Pull…', push: 'Push…' };
const opstate = document.getElementById('opstate');
let opTimer = 0;

document.querySelectorAll('[data-op]').forEach(b => b.addEventListener('click', () => api.op(b.dataset.op)));

function showOp(text, kind, action) {
  clearTimeout(opTimer);
  opstate.className = 'opstate' + (kind ? ' ' + kind : '');
  opstate.textContent = text;
  opstate.title = text;   // la pastille tronque : le message git complet reste lisible au survol
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.addEventListener('click', action.run);
    opstate.appendChild(b);
  }
  opstate.hidden = false;
  if (kind === 'ok') opTimer = setTimeout(() => { opstate.hidden = true; }, 3000);
}

async function refreshStatus() {
  const st = await api.status().catch(() => null);
  if (!st) return;
  HEAD_SHA = st.head;
  document.getElementById('sb-branch').textContent = st.branch || 'HEAD détachée';
  /* décalage nul : rien à faire. Pas d'upstream (null) : on laisse cliquable, git dira pourquoi. */
  for (const [op, n] of [['pull', st.behind], ['push', st.ahead]]) {
    const btn = document.getElementById(op);
    const badge = btn.querySelector('.count');
    badge.textContent = n || '';
    badge.hidden = !n;
    btn.disabled = n === 0;
  }
}

api.onOp(async p => {
  document.getElementById(p.op).classList.toggle('busy', p.state === 'start');
  if (p.state === 'start') return showOp(OP_LABEL[p.op], null);
  if (p.state === 'error') { refreshStatus(); return showOp(p.message, 'error'); }

  await refreshStatus();
  if (p.op === 'pull') { await resetAndLoad(); showOp('Branche à jour', 'ok'); }
  else if (p.op === 'push') showOp('Poussé', 'ok');
  else if (p.added > 0) {
    const s = p.added > 1 ? 's' : '';
    /* le graphe n'est pas rechargé d'office : ça perdrait le scroll et la sélection en cours */
    showOp(`${p.added} nouveau${s} commit${s}`, 'news', { label: 'Recharger', run: () => { opstate.hidden = true; resetAndLoad(); } });
  }
  else if (!p.auto) showOp('Déjà à jour', 'ok');
});

/* --- Arbre de travail ---
   Une ligne épinglée au-dessus du graphe : le commit qui n'existe pas encore.
   Elle vit hors du scroller, donc la virtualisation et les indices de DATA sont intacts. */
let WT = null;
let VIEW = 'commits';   // 'commits' | 'wt'
let HEAD_SHA = null;
let COMMIT_MSG = '';

const wtrow = document.getElementById('wtrow');
const wtCount = w => w.staged.length + w.unstaged.length + w.untracked.length + w.conflicts.length;

wtrow.addEventListener('click', () => {
  SELECTION.clear();
  applySel();
  VIEW = 'wt';
  renderPanel();
});

/* git ne notifie rien : l'arbre a pu bouger dans l'éditeur pendant qu'on regardait ailleurs */
window.addEventListener('focus', () => { if (document.body.classList.contains('has-repo')) refreshWorktree(); });

async function refreshWorktree() {
  WT = await api.worktree().catch(() => null);
  if (!WT || !wtCount(WT)) {
    wtrow.hidden = true;
    if (VIEW === 'wt') { VIEW = 'commits'; renderPanel(); }
    return;
  }
  wtrow.hidden = false;
  paintWtRow();
  if (VIEW === 'wt') renderPanel();
}

function paintWtRow() {
  const counts = wtrow.querySelector('.wtcounts');
  counts.replaceChildren();
  for (const [n, cls, label] of [
    [WT.conflicts.length, 'danger', 'conflits'],
    [WT.staged.length, 'ok', 'indexés'],
    [WT.unstaged.length, 'warn', 'modifiés'],
    [WT.untracked.length, 'muted', 'non suivis'],
  ]) {
    if (!n) continue;
    const s = document.createElement('span');
    s.className = 'wtc ' + cls;
    s.textContent = n;
    s.title = label;
    counts.appendChild(s);
  }
  /* le point s'aligne sur la lane de HEAD ; tant qu'elle n'est pas posée, pas de point */
  const dot = wtrow.querySelector('.wtdot');
  const row = S && HEAD_SHA ? S.rowOf.get(HEAD_SHA) : undefined;
  const lane = row === undefined ? undefined : S.laneOf[row];
  dot.hidden = lane === undefined;
  if (lane !== undefined) {
    dot.style.left = X(lane) + 'px';
    dot.style.color = laneColor(lane);
  }
}

async function wtRun(fn, paths) {
  try { await fn(paths); } catch (e) { showOp(e.message, 'error'); return; }
  await refreshWorktree();
}

const WT_SECTIONS = [
  { key: 'conflicts', title: 'Conflits',   source: 'unstaged',  cls: 'conflict' },
  { key: 'staged',    title: 'Indexés',    source: 'staged',    icon: '−', hint: 'Désindexer', all: 'Tout désindexer', act: p => api.unstage(p) },
  { key: 'unstaged',  title: 'Modifiés',   source: 'unstaged',  icon: '+', hint: 'Indexer',    all: 'Tout indexer',    act: p => api.stage(p) },
  { key: 'untracked', title: 'Non suivis', source: 'untracked', icon: '+', hint: 'Indexer',    all: 'Tout indexer',    act: p => api.stage(p) },
];

function renderWorktree(panel) {
  panel.replaceChildren();
  const h2 = document.createElement('h2');
  h2.textContent = 'Modifications non validées';
  panel.appendChild(h2);
  if (!WT) return;
  WT_SECTIONS.forEach(s => { if (WT[s.key].length) panel.appendChild(wtSection(s, WT[s.key])); });
  panel.appendChild(commitBox());
}

function wtSection(s, list) {
  const box = document.createElement('div');
  box.className = 'files';
  const head = document.createElement('div');
  head.className = 'files-head';
  const title = document.createElement('span');
  title.textContent = `${s.title} · ${list.length}`;
  head.appendChild(title);
  if (s.act) {
    const all = document.createElement('button');
    all.className = 'ghost sm';
    all.textContent = s.all;
    all.addEventListener('click', () => wtRun(s.act, list.map(f => f.path)));
    head.appendChild(all);
  }
  box.appendChild(head);
  const ctx = { wt: s.source };
  list.forEach(f => {
    const line = fileLine(f, 0, false, ctx);
    if (s.cls) line.classList.add(s.cls);
    if (s.act) {
      const b = document.createElement('button');
      b.className = 'wtbtn';
      b.textContent = s.icon;
      b.title = s.hint;
      b.setAttribute('aria-label', s.hint);
      b.addEventListener('click', ev => { ev.stopPropagation(); wtRun(s.act, [f.path]); });
      line.appendChild(b);
    }
    box.appendChild(line);
  });
  return box;
}

function commitBox() {
  const box = document.createElement('div');
  box.className = 'commitbox';
  if (WT.conflicts.length) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Résous les conflits avant de committer.';
    box.appendChild(hint);
  }
  const ta = document.createElement('textarea');
  ta.placeholder = 'Message de commit';
  ta.value = COMMIT_MSG;
  const btn = document.createElement('button');
  btn.className = 'primary';
  const n = WT.staged.length;
  btn.textContent = n ? `Commit · ${n} fichier${n > 1 ? 's' : ''}` : 'Commit';
  const ready = () => n > 0 && ta.value.trim() && !WT.conflicts.length;
  btn.disabled = !ready();
  /* le message survit aux re-rendus que déclenche l'indexation */
  ta.addEventListener('input', () => { COMMIT_MSG = ta.value; btn.disabled = !ready(); });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try { await api.commit(ta.value); }
    catch (e) { showOp(e.message, 'error'); btn.disabled = false; return; }
    COMMIT_MSG = '';
    await refreshWorktree();
    refreshStatus();
    await resetAndLoad();
  });
  box.append(ta, btn);
  return box;
}

async function jumpTo(hash) {
  while (!S.rowOf.has(hash) && (S.next < DATA.length || !exhausted)) {
    if (S.next < DATA.length) layoutChunk();
    else await fetchMore();
  }
  if (!S.rowOf.has(hash)) return;
  refresh();
  const row = S.rowOf.get(hash);
  board.scrollTop = row * ROW - board.clientHeight / 2;
  sync();
  select(row);
  const el = inner.querySelector(`.row[data-i="${row}"]`);
  if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
}

inner.addEventListener('click', ev => {
  const row = ev.target.closest('.row');
  if (row) select(+row.dataset.i, ev.ctrlKey || ev.metaKey);
});

inner.addEventListener('dblclick', ev => {
  const row = ev.target.closest('.row');
  if (!row) return;
  SELECTION.clear();
  branchSegment(+row.dataset.i).forEach(r => SELECTION.add(r));
  SELMODE = 'branch';
  VIEW = 'commits';
  applySel();
  renderPanel();
});

document.getElementById('loadall').addEventListener('click', async () => {
  while (!exhausted) await fetchMore();
  while (S.next < DATA.length) layoutChunk();
  refresh(); remount();
});

async function resetAndLoad() {
  gen++;
  DATA = []; fetching = null;
  TOTAL = await api.total(MODE);
  exhausted = TOTAL === 0;
  NCHUNKS = Math.max(1, Math.ceil(TOTAL / CHUNK));
  resetState();
  remount();
  board.scrollTop = 0;
  SELECTION.clear();
  clearHover();
  panelGen++;
  document.getElementById('panel').innerHTML = '<p class="hint">Clique un commit pour le détail.</p>';
  await fetchMore();
  layoutChunk();
  refresh();
  sync();
  await refreshWorktree();   // après le layout : le point de la ligne a besoin de la lane de HEAD
}

async function openRepo(repo) {
  document.getElementById('title').textContent = repo.name;
  document.title = `git-graph — ${repo.name}`;
  document.body.classList.add('has-repo');   // la coquille se déplie en CSS
  await refreshStatus();                     // pose HEAD_SHA avant le premier layout
  await resetAndLoad();
}

document.getElementById('mainline').addEventListener('click', async ev => {
  MODE = MODE === 'all' ? 'mainline' : 'all';
  ev.currentTarget.classList.toggle('active', MODE === 'mainline');
  ev.currentTarget.setAttribute('aria-pressed', MODE === 'mainline');
  await resetAndLoad();
});

document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', async () => {
  const repo = await api.openRepo();
  if (!repo) return;
  if (repo.error) { alert(repo.error); return; }
  openRepo(repo);
}));

api.current().then(repo => { if (repo) openRepo(repo); });
