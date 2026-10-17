import { MathfieldElement, convertLatexToMarkup, convertLatexToMathMl } from 'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/mathlive.min.mjs';
import { ComputeEngine } from 'https://cdn.jsdelivr.net/npm/@cortex-js/compute-engine@0.58.0/dist/compute-engine.min.esm.js';
import { evaluateDocument, formatNumber } from './calc.js';

const ce = new ComputeEngine();
const $ = s => document.querySelector(s);
const doc = $('#doc');
const PROJECTS = 'mathnotes-projects', CURRENT = 'mathnotes-current', SETTINGS = 'mathnotes-settings';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const settings = { showWorking: true, ...load(SETTINGS, {}) };

// Projects: separate named documents, each with its own equations and decimal places.
const projects = load(PROJECTS, null) ?? {
  // first run, or carrying over the single document from the earlier version
  'My notes': { blocks: load('mathnotes-doc', null) ?? [
    { section: 'Givens' }, { eq: 'y=10' }, { eq: 'z=2' },
    { section: 'Working' }, { eq: 'x=\\frac{y}{z}' }, { eq: '10=2b+x' }, { eq: '' },
  ], dp: settings.dp ?? {} },
};
delete settings.dp;
let project = projects[load(CURRENT, '')] ? load(CURRENT, '') : Object.keys(projects)[0];
const dpOf = () => projects[project].dp;

MathfieldElement.soundsDirectory = null;

// The document is a list of blocks: equation lines (.eq) and sections (.section = line + heading).
let seq = 0, current = null, result = { vars: new Map(), ghosts: {} };
const blocks = () => [...doc.children];
const lastEq = () => (current?.isConnected && current.classList.contains('eq') ? current : null);

// An equation filled in with Tab keeps what you typed in data-base; the filled part after it is
// recalculated every time, so changing decimal places or an earlier value updates the page.
function makeEq(latex = '', base) {
  const w = document.createElement('div');
  w.className = 'eq';
  w.dataset.id = ++seq;
  if (base != null) w.dataset.base = base;
  const mf = new MathfieldElement();
  mf.placeholder = '\\text{Type equation here.}';
  mf.value = latex;
  const ghost = document.createElement('span');
  ghost.className = 'ghost';
  w.append(mf, ghost);

  mf.addEventListener('focus', () => { current = w; updateDpLabel(); });
  mf.addEventListener('input', () => {
    if (w.dataset.base != null) {
      // edited the typed part: keep it filled; edited the filled part: it becomes plain text again
      const fill = w.dataset.fill ?? '';
      if (fill && mf.value.endsWith(fill)) w.dataset.base = mf.value.slice(0, -fill.length);
      else if (mf.value !== w.dataset.base) { delete w.dataset.base; delete w.dataset.fill; }
    }
    schedule();
  });
  mf.addEventListener('move-out', e => {
    e.preventDefault();
    const back = e.detail.direction === 'backward' || e.detail.direction === 'upward';
    focusBlock(back ? w.previousElementSibling : w.nextElementSibling, back);
  });
  mf.addEventListener('keydown', e => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Tab' && !e.shiftKey && w.dataset.ghost) { stop(); accept(w); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { stop(); addSection(w); }
    else if (e.key === 'Enter') { stop(); addEq(w); }
    else if (e.key === 'Backspace' && !mf.value) { stop(); removeBlock(w); }
  }, { capture: true });
  for (const type of ['copy', 'cut']) mf.addEventListener(type, e => {
    const sel = mf.selection.ranges[0], collapsed = sel[0] === sel[1];
    const latex = collapsed ? mf.value : mf.getValue(mf.selection, 'latex');
    e.clipboardData.setData('text/html', eqHtml(latex));
    e.clipboardData.setData('text/plain', mathml(latex));
    e.preventDefault(); e.stopPropagation();
    if (type === 'cut' && !collapsed) mf.executeCommand('deleteBackward');
  }, { capture: true });
  mf.addEventListener('paste', e => {
    const html = e.clipboardData.getData('text/html');
    if (!html.includes('data-latex')) return; // ordinary paste: let MathLive handle it
    e.preventDefault(); e.stopPropagation();
    pasteBlocks(html, w);
  }, { capture: true });
  return w;
}

function makeSection(title = '') {
  const s = document.createElement('div');
  s.className = 'section';
  const h = document.createElement('h2');
  h.contentEditable = 'plaintext-only';
  h.textContent = title;
  s.append(document.createElement('hr'), h);
  h.addEventListener('focus', () => { current = s; updateDpLabel(); });
  h.addEventListener('input', schedule);
  h.addEventListener('copy', e => { e.preventDefault(); copySection(s); }); // Ctrl+C on a heading copies its section
  h.addEventListener('keydown', e => {
    const o = getSelection().anchorOffset, len = h.textContent.length;
    if (e.key === 'Enter') { e.preventDefault(); addEq(s); }
    else if (e.key === 'Backspace' && !len) { e.preventDefault(); removeBlock(s); }
    else if (e.key === 'ArrowUp' || (e.key === 'ArrowLeft' && o === 0)) { e.preventDefault(); focusBlock(s.previousElementSibling, true); }
    else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && o >= len)) { e.preventDefault(); focusBlock(s.nextElementSibling); }
  });
  return s;
}

function focusBlock(b, atEnd = false) {
  if (!b) return;
  if (b.classList.contains('eq')) {
    const mf = b.firstChild;
    mf.focus();
    mf.position = atEnd ? mf.lastOffset : 0;
  } else {
    const h = b.querySelector('h2');
    h.focus();
    getSelection().selectAllChildren(h);
    getSelection().collapseToEnd();
  }
}

const after = (ref, node) => (ref?.isConnected ? ref.after(node) : doc.append(node), node);
function addEq(ref = current, latex = '') { const w = after(ref, makeEq(latex)); focusBlock(w); schedule(); return w; }
function addSection(ref = current) { const s = after(ref, makeSection()); focusBlock(s); schedule(); return s; }

function removeBlock(b) {
  if (!b?.isConnected) return;
  const prev = b.previousElementSibling, next = b.nextElementSibling;
  b.remove();
  if (!doc.children.length) addEq();
  else focusBlock(prev || next, !!prev);
  schedule();
}

const mathml = latex => `<math xmlns="http://www.w3.org/1998/Math/MathML">${convertLatexToMathMl(latex)}</math>`;
const esc = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Word turns the MathML into a real equation; data-latex lets us turn it back into an editable one on paste.
const eqHtml = latex => `<span data-latex="${esc(latex)}">${mathml(latex)}</span>`;

// equation being typed in, or a new one (like Word inserting an equation)
function activeField() {
  return (lastEq() || addEq()).firstChild;
}

function insertIntoEq(latex) {
  const mf = activeField();
  mf.focus();
  mf.insert(latex, { selectionMode: 'placeholder', focus: true });
  schedule();
}

function accept(w = lastEq()) {
  if (!w?.dataset.ghost) return;
  w.dataset.base = w.firstChild.value;
  w.dataset.fill = '';
  recompute();
  w.firstChild.focus();
  w.firstChild.executeCommand('moveToMathfieldEnd');
}

// ---------- recalculation ----------
let timer;
function schedule() { clearTimeout(timer); timer = setTimeout(recompute, 200); }

function recompute() {
  // ponytail: re-evaluates the whole document each time; cache per equation if documents get huge
  const eqs = [...doc.querySelectorAll('.eq')];
  result = evaluateDocument(ce, eqs.map(w => ({ id: w.dataset.id, latex: w.dataset.base ?? w.firstChild.value })), dpOf(), settings.showWorking);
  for (const w of eqs) {
    let g = result.ghosts[w.dataset.id] || '';
    if (w.dataset.base != null) {
      const mf = w.firstChild, value = w.dataset.base + g;
      w.dataset.fill = g;
      g = '';
      if (mf.value !== value) {
        const pos = mf.position;
        mf.value = value;
        mf.position = Math.min(pos, mf.lastOffset);
      }
    }
    if (w.dataset.ghost === g) continue;
    w.dataset.ghost = g;
    w.lastChild.innerHTML = g ? convertLatexToMarkup(g) + '<kbd>Tab</kbd>' : '';
  }
  renderVars();
  updateDpLabel();
  const n = eqs.filter(w => w.firstChild.value).length;
  $('#eq-count').textContent = `${n} equation${n === 1 ? '' : 's'}`;
  $('#var-count').textContent = `${result.vars.size} variable${result.vars.size === 1 ? '' : 's'}`;
  saveProject();
}

function saveProject() {
  projects[project] = { blocks: serialize(), dp: dpOf() };
  store(PROJECTS, projects);
  store(CURRENT, project);
}

function renderVars() {
  const rows = [...result.vars].map(([name, v]) => {
    const dp = dpOf()[name];
    const opts = ['<option value="">Auto</option>', ...Array.from({ length: 11 }, (_, i) => `<option${dp === i ? ' selected' : ''}>${i}</option>`)].join('');
    return `<tr><td data-latex="${esc(v.latex)}" title="Insert into equation">${convertLatexToMarkup(v.latex)}</td>
      <td>${convertLatexToMarkup(formatNumber(v.value, dp))}</td>
      <td><select data-var="${esc(name)}" title="Decimal places">${opts}</select></td></tr>`;
  }).join('');
  $('#vars').innerHTML = rows
    ? `<table><tr><th>Name</th><th>Value</th><th>Decimals</th></tr>${rows}</table>`
    : '<p class="hint">No variables yet. Type something like x=5.</p>';
}

function setDp(name, dp) {
  if (dp == null || Number.isNaN(dp)) delete dpOf()[name]; else dpOf()[name] = Math.max(0, Math.min(10, dp));
  recompute();
}

// the variable an equation defines (for the ribbon's decimal buttons)
const eqVar = () => lastEq() && [...result.vars].find(([, v]) => v.id === current.dataset.id)?.[0];
function updateDpLabel() {
  const name = eqVar();
  $('#dp-label').innerHTML = name ? `${convertLatexToMarkup(result.vars.get(name).latex)}: ${dpOf()[name] ?? 'Auto'} d.p.` : 'Decimals: Auto';
}
function bumpDp(delta) {
  const name = eqVar();
  if (!name) return;
  const cur = dpOf()[name] ?? Math.min(10, (String(result.vars.get(name).value).split('.')[1] || '').length);
  setDp(name, cur + delta);
}

// ---------- saving / loading ----------
const serialize = () => blocks().map(b => b.classList.contains('eq')
  ? { eq: b.firstChild.value, base: b.dataset.base }
  : { section: b.querySelector('h2').textContent });

// also reads the older HTML format (equations and headings kept, other text dropped)
function fromHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return [...t.content.querySelectorAll('[data-latex], h1, h2, h3')].map(el =>
    el.dataset.latex != null ? { eq: el.dataset.latex } : { section: el.textContent.trim() });
}

function setDocument(list) {
  if (typeof list === 'string') list = fromHtml(list);
  doc.replaceChildren(...(list?.length ? list : [{ eq: '' }]).map(b => b.section != null ? makeSection(b.section) : makeEq(b.eq, b.base)));
  current = null;
  recompute();
}

function openProject(name) {
  project = name;
  document.title = `${name} - Math Notes`;
  $('#doc-title').textContent = document.title;
  setDocument(projects[name].blocks);
  saveProject();
  focusBlock(doc.lastElementChild, true); // ready to type straight away
}

function uniqueName(base) {
  let n = base.trim() || 'Untitled', i = 2;
  while (projects[n]) n = `${base.trim() || 'Untitled'} (${i++})`;
  return n;
}

function newProject() {
  const name = prompt('Name for the new project:', 'Untitled');
  if (name == null) return;
  const n = uniqueName(name);
  projects[n] = { blocks: [], dp: {} };
  openProject(n);
}

function renameProject() {
  const name = prompt('Rename this project:', project);
  if (name == null || !name.trim() || name.trim() === project) return;
  const n = uniqueName(name);
  projects[n] = projects[project];
  delete projects[project];
  openProject(n);
}

function deleteProject() {
  if (!confirm(`Delete the project "${project}"? This cannot be undone.`)) return;
  delete projects[project];
  if (!Object.keys(projects).length) projects.Untitled = { blocks: [], dp: {} };
  openProject(Object.keys(projects)[0]);
}

function download() {
  const blob = new Blob([JSON.stringify({ blocks: serialize(), dp: dpOf() })], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: project + '.mathnotes' });
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#open-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const blocks = data.blocks ?? fromHtml(data.html ?? '');
    const n = uniqueName(f.name.replace(/\.mathnotes$/i, ''));
    projects[n] = { blocks, dp: data.dp ?? {} };
    openProject(n);
  } catch { alert('That file could not be opened. Choose a .mathnotes file saved from Math Notes.'); }
  e.target.value = '';
});

// ---------- clipboard ----------
function copyHtml(html, plain) {
  const onCopy = e => { e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', plain); e.preventDefault(); e.stopPropagation(); };
  document.addEventListener('copy', onCopy, { capture: true });
  document.execCommand('copy');
  document.removeEventListener('copy', onCopy, { capture: true });
}

// the section a line belongs to: its heading and every line down to the next heading
function sectionOf(b) {
  while (b.previousElementSibling && !b.classList.contains('section')) b = b.previousElementSibling;
  const out = [b];
  for (let n = b.nextElementSibling; n && !n.classList.contains('section'); n = n.nextElementSibling) out.push(n);
  return out;
}

const copyAll = () => copyBlocks(blocks());
const copySection = (b = current) => b?.isConnected && copyBlocks(sectionOf(b));

function copyBlocks(els) {
  const all = serialize(), list = els.map(b => all[blocks().indexOf(b)]).filter(b => b.section != null || b.eq);
  copyHtml(
    list.map(b => b.section != null ? `<hr><h2>${esc(b.section)}</h2>` : `<p>${eqHtml(b.eq)}</p>`).join(''),
    list.map(b => b.section != null ? `\n${b.section}\n` : b.eq).join('\n'));
}

function pasteBlocks(html, ref) {
  const list = fromHtml(html);
  let at = ref;
  for (const b of list) at = after(at, b.section != null ? makeSection(b.section) : makeEq(b.eq, b.base));
  if (ref?.classList.contains('eq') && !ref.firstChild.value) ref.remove();
  focusBlock(at, true);
  schedule();
}

// ---------- ribbon ----------
const actions = {
  newEq: () => addEq(),
  newSection: () => addSection(),
  deleteLine: () => removeBlock(current),
  copyAll,
  copySection: () => copySection(),
  copyEq: () => { const w = lastEq(); if (w) copyHtml(eqHtml(w.firstChild.value), mathml(w.firstChild.value)); },
  accept: () => accept(),
  dpUp: () => bumpDp(1),
  dpDown: () => bumpDp(-1),
  save: download,
  print: () => print(),
  togglePane: () => { $('#pane').hidden = !$('#pane').hidden; },
  toggleSymbols: () => { $('#sympane').hidden = !$('#sympane').hidden; },
  fileMenu: btn => openMenu(btn, [
    ['note_add', 'New project…', newProject],
    ['edit', 'Rename project…', renameProject],
    ['delete', 'Delete project…', deleteProject],
    ['download', 'Save project to a file', download],
    ['upload', 'Open project from a file…', () => $('#open-file').click()],
    ['content_copy', 'Copy all for Word', copyAll],
    ['print', 'Print', () => print()],
    ...Object.keys(projects).sort().map(n => [n === project ? 'check' : 'description', esc(n), () => openProject(n)]),
  ], true),
  rename: renameProject,
};

document.addEventListener('mousedown', e => {
  // keep the caret in the equation when a ribbon button is pressed (like Word)
  if (e.target.closest('#ribbon button, #titlebar button, .menu button, #symbols button, #vars td[data-latex]')) e.preventDefault();
});

document.addEventListener('click', e => {
  const b = e.target.closest('button, #vars td[data-latex]');
  if (!b) return;
  if (b.dataset.latex) return insertIntoEq(b.dataset.latex);
  if (b.dataset.tab) {
    document.querySelectorAll('#tabs [data-tab]').forEach(t => t.classList.toggle('on', t === b));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
  } else if (b.dataset.act) actions[b.dataset.act](b);
});

// clicking empty page space below the last line goes to the last equation (or starts a new one)
$('#page').addEventListener('click', e => {
  if (e.target !== doc && e.target !== $('#page')) return;
  const last = doc.lastElementChild;
  if (last?.classList.contains('eq') && !last.firstChild.value) focusBlock(last);
  else addEq(last);
});

// right-click menu on any line (replaces MathLive's own menu)
doc.addEventListener('contextmenu', e => {
  const b = e.target.closest?.('.eq, .section');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  current = b;
  const eq = b.classList.contains('eq') && b.firstChild.value;
  openMenu(b, [
    ...(eq ? [['function', 'Copy equation', () => copyHtml(eqHtml(eq), mathml(eq))]] : []),
    ['content_copy', 'Copy section', () => copySection(b)],
    ['select_all', 'Copy all', copyAll],
    ['add', 'New equation below', () => addEq(b)],
    ['horizontal_rule', 'New section below', () => addSection(b)],
    ['delete', 'Delete line', () => removeBlock(b)],
  ], true, { left: e.clientX, bottom: e.clientY });
}, { capture: true });

$('#vars').addEventListener('change', e => {
  if (e.target.dataset.var) setDp(e.target.dataset.var, e.target.value === '' ? null : Number(e.target.value));
});

$('#show-working').checked = settings.showWorking;
$('#show-working').addEventListener('change', e => { settings.showWorking = e.target.checked; store(SETTINGS, settings); recompute(); });

// menus (file menu and structure galleries)
let menu;
function closeMenu() { menu?.remove(); menu = null; }
function openMenu(btn, items, list = false, at = btn.getBoundingClientRect()) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'menu' + (list ? ' list' : '');
  for (const [icon, label, fn] of items) {
    const b = document.createElement('button');
    b.innerHTML = list ? `<span class="icon">${icon}</span>${label}` : convertLatexToMarkup(label);
    b.onclick = e => { e.stopPropagation(); closeMenu(); fn(); };
    menu.append(b);
  }
  document.body.append(menu);
  menu.style.left = Math.max(8, Math.min(at.left, innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(at.bottom + 2, innerHeight - menu.offsetHeight - 8)) + 'px';
}
document.addEventListener('click', e => { if (menu && !menu.contains(e.target) && !e.target.closest('[data-act=fileMenu], [data-struct]')) closeMenu(); }, true);

// Symbols panel. #0 = selection or empty box, #? = empty box (MathLive placeholders)
const STRUCTURES = {
  Fraction: ['\\frac{x}{y}', ['\\frac{#0}{#?}', '{#0}/{#?}', '\\tfrac{#0}{#?}', '\\frac{dy}{dx}']],
  Script: ['e^x', ['#0^{#?}', '#0_{#?}', '#0_{#?}^{#?}', '{}^{#?}_{#?}#0']],
  Radical: ['\\sqrt[n]{x}', ['\\sqrt{#0}', '\\sqrt[#?]{#0}', '\\sqrt[3]{#0}', '\\sqrt{a^2+b^2}']],
  Integral: ['\\int_{-x}^{x}', ['\\int #0\\,dx', '\\int_{#?}^{#?}#0\\,dx', '\\iint #0\\,dA', '\\oint #0\\,ds']],
  'Large Operator': ['\\sum_{i=0}^{n}', ['\\sum_{#?}^{#?}#0', '\\sum_{i=1}^{n}#0', '\\prod_{#?}^{#?}#0', '\\bigcup_{#?}#0']],
  Bracket: ['\\{()\\}', ['\\left(#0\\right)', '\\left[#0\\right]', '\\left\\{#0\\right\\}', '\\left|#0\\right|']],
  Function: ['\\sin\\theta', ['\\sin\\left(#0\\right)', '\\cos\\left(#0\\right)', '\\tan\\left(#0\\right)', '\\sin^{-1}\\left(#0\\right)', '\\cos^{-1}\\left(#0\\right)', '\\tan^{-1}\\left(#0\\right)', '\\sinh\\left(#0\\right)', '\\cosh\\left(#0\\right)']],
  Accent: ['\\ddot{a}', ['\\dot{#0}', '\\ddot{#0}', '\\hat{#0}', '\\bar{#0}', '\\vec{#0}', '\\overline{#0}', '\\tilde{#0}', "#0'"]],
  'Limit and Log': ['\\lim_{n\\to\\infty}', ['\\log_{#?}\\left(#0\\right)', '\\ln\\left(#0\\right)', '\\log\\left(#0\\right)', '\\lim_{#?\\to#?}#0', '\\lim_{x\\to\\infty}#0', 'e^{#0}', '#0!', '\\binom{#?}{#?}']],
  Matrix: ['\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}', ['\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}', '\\begin{bmatrix}#?&#?\\\\#?&#?\\end{bmatrix}', '\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}', '\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}']],
};
const SYMBOLS = {
  'Basic maths': '\\pm \\mp \\times \\div \\cdot \\neq \\approx \\equiv \\le \\ge \\ll \\gg \\propto \\infty \\degree \\% \\sqrt{#0} #0^{2} #0^{3} #0^{-1} \\frac{#0}{#?} \\left|#0\\right| #0! \\pi',
  'Greek': '\\alpha \\beta \\gamma \\delta \\epsilon \\zeta \\eta \\theta \\iota \\kappa \\lambda \\mu \\nu \\xi \\rho \\sigma \\tau \\upsilon \\phi \\varphi \\chi \\psi \\omega \\varepsilon',
  'Capital Greek': '\\Gamma \\Delta \\Theta \\Lambda \\Xi \\Pi \\Sigma \\Upsilon \\Phi \\Psi \\Omega',
  'Calculus': '\\frac{d}{dx} \\frac{d#0}{d#?} \\frac{\\partial}{\\partial#?} \\partial \\nabla \\int \\iint \\oint \\sum \\prod \\lim_{#?\\to#?} \\Delta',
  'Arrows': '\\rightarrow \\leftarrow \\leftrightarrow \\Rightarrow \\Leftarrow \\Leftrightarrow \\uparrow \\downarrow \\mapsto \\to',
  'Sets and logic': '\\in \\notin \\subset \\subseteq \\cup \\cap \\emptyset \\forall \\exists \\neg \\land \\lor \\mathbb{R} \\mathbb{N} \\mathbb{Z} \\mathbb{Q} \\mathbb{C} \\therefore \\because',
  'Geometry': '\\angle \\triangle \\perp \\parallel \\sim \\cong \\overline{#0} \\vec{#0} \\hat{#0} \\circ',
};
const preview = l => convertLatexToMarkup(l.replace(/#0|#\?/g, '\\square'));
$('#symbols').innerHTML = '<h3>Structures</h3><div class="grid wide">' +
  Object.entries(STRUCTURES).map(([name, [icon]]) => `<button data-struct="${name}" title="${name}"><span class="mi">${convertLatexToMarkup(icon)}</span>${name}</button>`).join('') + '</div>' +
  Object.entries(SYMBOLS).map(([group, list]) => `<h3>${group}</h3><div class="grid">` +
    list.split(' ').map(s => `<button data-ins="${esc(s)}" title="${esc(s.replace(/#0|#\?/g, '□'))}">${preview(s)}</button>`).join('') + '</div>').join('');
$('#symbols').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (b?.dataset.ins) insertIntoEq(b.dataset.ins);
  if (b?.dataset.struct) openMenu(b, STRUCTURES[b.dataset.struct][1].map(l => ['', l.replace(/#0|#\?/g, '\\square'), () => insertIntoEq(l)]));
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); download(); }
  if (e.altKey && e.key === '=') { e.preventDefault(); addEq(); }
  if (e.key === 'Escape') closeMenu();
});

if (innerWidth < 860) $('#sympane').hidden = $('#pane').hidden = true; // phones: open from View
openProject(project);
