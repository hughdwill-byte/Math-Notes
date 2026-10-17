import { MathfieldElement, convertLatexToMarkup, convertLatexToMathMl } from 'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/mathlive.min.mjs';
import { ComputeEngine } from 'https://cdn.jsdelivr.net/npm/@cortex-js/compute-engine@0.58.0/dist/compute-engine.min.esm.js';
import { evaluateDocument, formatNumber } from './calc.js';

const ce = new ComputeEngine();
const $ = s => document.querySelector(s);
const editor = $('#editor');
const ZW = '\u200B'; // zero-width space around equations so the caret can sit next to them
const STORE = 'mathnotes-doc', SETTINGS = 'mathnotes-settings';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const settings = { dp: {}, showWorking: true, ...load(SETTINGS, {}) };

MathfieldElement.soundsDirectory = null;
document.execCommand('defaultParagraphSeparator', false, 'p');

// ---------- equations ----------
let seq = 0, lastEq = null, lastRange = null, lastWasEq = false, result = { vars: new Map(), ghosts: {} };

function makeEq(latex = '') {
  const w = document.createElement('span');
  w.className = 'eq';
  w.contentEditable = 'false';
  w.dataset.id = ++seq;
  const mf = new MathfieldElement();
  mf.placeholder = '\\text{Type equation here.}';
  mf.value = latex;
  const ghost = document.createElement('span');
  ghost.className = 'ghost';
  w.append(mf, ghost);

  mf.addEventListener('focus', () => { lastEq = w; lastWasEq = true; updateDpLabel(); });
  mf.addEventListener('input', schedule);
  mf.addEventListener('move-out', e => { e.preventDefault(); caretBeside(w, e.detail.direction === 'backward'); });
  mf.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && w.dataset.ghost) { e.preventDefault(); e.stopPropagation(); accept(w); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); caretBeside(w); document.execCommand('insertParagraph'); }
    else if (e.key === 'Escape') { e.preventDefault(); caretBeside(w); }
    else if (e.key === 'Backspace' && !mf.value) { e.preventDefault(); e.stopPropagation(); caretBeside(w, true); w.remove(); schedule(); }
  }, { capture: true });
  for (const type of ['copy', 'cut']) mf.addEventListener(type, e => {
    const sel = mf.selection.ranges[0], collapsed = sel[0] === sel[1];
    const latex = collapsed ? mf.value : mf.getValue(mf.selection, 'latex');
    e.clipboardData.setData('text/html', eqHtml(latex));
    e.clipboardData.setData('text/plain', mathml(latex));
    e.preventDefault(); e.stopPropagation();
    if (type === 'cut' && !collapsed) mf.executeCommand('deleteBackward');
  }, { capture: true });
  return w;
}

const mathml = latex => `<math xmlns="http://www.w3.org/1998/Math/MathML">${convertLatexToMathMl(latex)}</math>`;
const escAttr = s => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Word turns the MathML into a real equation; data-latex lets us turn it back into an editable one on paste.
const eqHtml = latex => `<span data-latex="${escAttr(latex)}">${mathml(latex)}</span>`;

function caretBeside(w, before = false) {
  const r = document.createRange();
  if (before) r.setStartBefore(w); else r.setStartAfter(w);
  r.collapse(true);
  editor.focus();
  const s = getSelection();
  s.removeAllRanges(); s.addRange(r);
}

function insertNodes(nodes) {
  editor.focus();
  const s = getSelection();
  let r = lastRange && editor.contains(lastRange.startContainer) ? lastRange : null;
  if (!r) { r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); }
  if (!editor.firstChild) { const p = document.createElement('p'); editor.append(p); r.setStart(p, 0); r.collapse(true); }
  r.deleteContents();
  const frag = document.createDocumentFragment();
  frag.append(...nodes);
  const last = frag.lastChild;
  r.insertNode(frag);
  r.setStartAfter(last); r.collapse(true);
  s.removeAllRanges(); s.addRange(r);
}

function insertEquation(latex = '') {
  const w = makeEq(latex);
  insertNodes([ZW, w, ZW]);
  requestAnimationFrame(() => { w.firstChild.focus(); w.firstChild.executeCommand('moveToMathfieldEnd'); });
  schedule();
  return w;
}

// equation being typed in, or a new one if the caret is in normal text (like Word)
function activeField() {
  if (lastWasEq && lastEq?.isConnected) return lastEq.firstChild;
  return insertEquation().firstChild;
}

function insertIntoEq(latex) {
  const mf = activeField();
  mf.focus();
  mf.insert(latex, { selectionMode: 'placeholder', focus: true });
  schedule();
}

function accept(w = lastEq) {
  if (!w?.dataset.ghost) return;
  const mf = w.firstChild;
  mf.focus();
  mf.executeCommand('moveToMathfieldEnd');
  mf.insert(w.dataset.ghost);
  recompute();
}

// ---------- recalculation ----------
let timer;
function schedule() { clearTimeout(timer); timer = setTimeout(recompute, 200); }

function recompute() {
  // ponytail: re-evaluates the whole document each time; cache per equation if documents get huge
  const eqs = [...editor.querySelectorAll('.eq')];
  result = evaluateDocument(ce, eqs.map(w => ({ id: w.dataset.id, latex: w.firstChild.value })), settings.dp, settings.showWorking);
  for (const w of eqs) {
    const g = result.ghosts[w.dataset.id] || '';
    if (w.dataset.ghost === g) continue;
    w.dataset.ghost = g;
    w.lastChild.innerHTML = g ? convertLatexToMarkup(g) + '<kbd>Tab</kbd>' : '';
  }
  renderVars();
  updateDpLabel();
  const words = editor.innerText.replace(/\u200B/g, '').trim().split(/\s+/).filter(Boolean).length;
  $('#words').textContent = `${words} word${words === 1 ? '' : 's'}`;
  $('#var-count').textContent = `${result.vars.size} variable${result.vars.size === 1 ? '' : 's'}`;
  save();
}

function renderVars() {
  const rows = [...result.vars].map(([name, v]) => {
    const dp = settings.dp[name];
    const opts = ['<option value="">Auto</option>', ...Array.from({ length: 11 }, (_, i) => `<option${dp === i ? ' selected' : ''}>${i}</option>`)].join('');
    return `<tr><td data-latex="${escAttr(v.latex)}" title="Insert into equation">${convertLatexToMarkup(v.latex)}</td>
      <td>${convertLatexToMarkup(formatNumber(v.value, dp))}</td>
      <td><select data-var="${escAttr(name)}" title="Decimal places">${opts}</select></td></tr>`;
  }).join('');
  $('#vars').innerHTML = rows
    ? `<table><tr><th>Name</th><th>Value</th><th>Decimals</th></tr>${rows}</table>`
    : '<p class="hint">No variables yet. Insert an equation (Alt+=) and type something like x=5.</p>';
}

function setDp(name, dp) {
  if (dp == null || Number.isNaN(dp)) delete settings.dp[name]; else settings.dp[name] = Math.max(0, Math.min(10, dp));
  store(SETTINGS, settings);
  recompute();
}

// the variable an equation defines (for the ribbon's decimal buttons)
const eqVar = () => lastEq && [...result.vars].find(([, v]) => v.id === lastEq.dataset.id)?.[0];
function updateDpLabel() {
  const name = eqVar();
  $('#dp-label').innerHTML = name ? `${convertLatexToMarkup(result.vars.get(name).latex)}: ${settings.dp[name] ?? 'Auto'} d.p.` : 'Decimals: Auto';
}
function bumpDp(delta) {
  const name = eqVar();
  if (!name) return;
  const cur = settings.dp[name] ?? Math.min(10, (String(result.vars.get(name).value).split('.')[1] || '').length);
  setDp(name, cur + delta);
}

// ---------- saving / loading ----------
function serialize() {
  const t = document.createElement('template'), live = editor.querySelectorAll('.eq');
  t.innerHTML = editor.innerHTML; // inert copy: no MathLive instances get created
  const clone = t.content;
  clone.querySelectorAll('.eq').forEach((c, i) => { c.replaceChildren(); c.dataset.latex = live[i].firstChild.value; delete c.dataset.ghost; });
  const div = document.createElement('div');
  div.append(clone);
  return div.innerHTML;
}

function hydrate(root) {
  root.querySelectorAll('[data-latex]').forEach(el => el.replaceWith(ZW, makeEq(el.dataset.latex), ZW));
  return root;
}

function setDocument(html) {
  const t = document.createElement('template');
  t.innerHTML = html || '<p><br></p>';
  editor.replaceChildren(hydrate(t.content));
  recompute();
}

const save = () => store(STORE, serialize());

function download() {
  const blob = new Blob([JSON.stringify({ html: serialize(), dp: settings.dp })], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'Document.mathnotes' });
  a.click();
  URL.revokeObjectURL(a.href);
}

$('#open-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    Object.assign(settings.dp, data.dp);
    store(SETTINGS, settings);
    setDocument(data.html);
  } catch { alert('That file could not be opened. Choose a .mathnotes file saved from Math Notes.'); }
  e.target.value = '';
});

// ---------- clipboard ----------
function onCopy(e, cut) {
  const s = getSelection();
  if (s.isCollapsed || !editor.contains(s.anchorNode)) return;
  const div = document.createElement('div');
  div.append(s.getRangeAt(0).cloneContents());
  const live = new Map([...editor.querySelectorAll('.eq')].map(w => [w.dataset.id, w.firstChild.value]));
  const eqs = [...div.querySelectorAll('.eq')];
  const other = div.cloneNode(true);
  other.querySelectorAll('.eq').forEach(n => n.remove());
  const onlyEq = eqs.length === 1 && !other.textContent.replace(/\u200B/g, '').trim();
  for (const c of eqs) {
    const t = document.createElement('template');
    t.innerHTML = eqHtml(live.get(c.dataset.id) ?? '');
    c.replaceWith(t.content);
  }
  const html = div.innerHTML.replace(/\u200B/g, '');
  e.clipboardData.setData('text/html', html);
  e.clipboardData.setData('text/plain', onlyEq ? mathml(live.get(eqs[0].dataset.id)) : s.toString().replace(/\u200B/g, ''));
  e.preventDefault();
  if (cut) { s.deleteFromDocument(); schedule(); }
}
editor.addEventListener('copy', e => onCopy(e, false));
editor.addEventListener('cut', e => onCopy(e, true));

function pasteHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  t.content.querySelectorAll('meta, style, script, title').forEach(n => n.remove());
  insertNodes([...hydrate(t.content).childNodes]);
  schedule();
}
editor.addEventListener('paste', e => {
  const html = e.clipboardData.getData('text/html');
  if (!html.includes('data-latex')) return; // ordinary paste
  e.preventDefault();
  pasteHtml(html);
});

// ---------- ribbon ----------
const actions = {
  insertEquation: () => insertEquation(),
  accept: () => accept(),
  dpUp: () => bumpDp(1),
  dpDown: () => bumpDp(-1),
  save: download,
  print: () => print(),
  togglePane: () => { $('#pane').hidden = !$('#pane').hidden; },
  table: () => document.execCommand('insertHTML', false, `<table>${'<tr><td><br></td><td><br></td><td><br></td></tr>'.repeat(3)}</table><p><br></p>`),
  highlight: () => document.execCommand('hiliteColor', false, '#ffff00'),
  color: () => document.execCommand('foreColor', false, $('#color-pick').value),
  paste: async () => {
    try {
      for (const item of await navigator.clipboard.read()) {
        if (item.types.includes('text/html')) return pasteHtml(await (await item.getType('text/html')).text());
        if (item.types.includes('text/plain')) return document.execCommand('insertText', false, await (await item.getType('text/plain')).text());
      }
    } catch { alert('Your browser blocked the Paste button. Use Ctrl+V instead.'); }
  },
  fileMenu: (btn) => openMenu(btn, [
    ['note_add', 'New', () => { if (confirm('Start a new blank document? The current one will be cleared.')) setDocument(''); }],
    ['folder_open', 'Open…', () => $('#open-file').click()],
    ['save', 'Save a copy', download],
    ['print', 'Print', () => print()],
  ], true),
};

document.addEventListener('mousedown', e => {
  // keep the caret where it is when a ribbon button is pressed (like Word)
  if (e.target.closest('#ribbon button, #titlebar button, .menu button, #vars td')) e.preventDefault();
});

document.addEventListener('click', e => {
  const b = e.target.closest('button, #vars td[data-latex]');
  if (!b) return;
  if (b.dataset.latex) return insertIntoEq(b.dataset.latex);
  if (b.dataset.tab) {
    document.querySelectorAll('#tabs [data-tab]').forEach(t => t.classList.toggle('on', t === b));
    document.querySelectorAll('.panel').forEach(p => p.classList.toggle('on', p.id === 'tab-' + b.dataset.tab));
  } else if (b.dataset.exec) {
    if (lastWasEq && lastEq?.isConnected && ['undo', 'redo', 'cut', 'copy'].includes(b.dataset.exec)) {
      lastEq.firstChild.executeCommand({ undo: 'undo', redo: 'redo', cut: 'cutToClipboard', copy: 'copyToClipboard' }[b.dataset.exec]);
    } else document.execCommand(b.dataset.exec);
    schedule();
  } else if (b.dataset.block) document.execCommand('formatBlock', false, b.dataset.block);
  else if (b.dataset.act) actions[b.dataset.act](b);
});

$('#vars').addEventListener('change', e => {
  if (e.target.dataset.var) setDp(e.target.dataset.var, e.target.value === '' ? null : Number(e.target.value));
});

$('#show-working').checked = settings.showWorking;
$('#show-working').addEventListener('change', e => { settings.showWorking = e.target.checked; store(SETTINGS, settings); recompute(); });

function withRange(fn) {
  if (lastRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(lastRange); }
  fn();
  editor.focus();
}
$('#font').addEventListener('change', e => withRange(() => document.execCommand('fontName', false, e.target.value)));
$('#size').addEventListener('change', e => withRange(() => {
  document.execCommand('styleWithCSS', false, false);
  document.execCommand('fontSize', false, 7);
  editor.querySelectorAll('font[size="7"]').forEach(f => { f.removeAttribute('size'); f.style.fontSize = e.target.value + 'pt'; });
}));
$('#color-pick').addEventListener('input', e => { $('#color-bar').style.borderColor = e.target.value; });
$('[data-act=color]').addEventListener('contextmenu', e => { e.preventDefault(); $('#color-pick').click(); });
$('[data-act=color]').title = 'Font Color (right-click to choose colour)';

$('#zoom').addEventListener('input', e => {
  $('#page').style.zoom = e.target.value / 100;
  $('#zoom-label').textContent = e.target.value + '%';
});

// menus (file menu and structure galleries)
let menu;
function closeMenu() { menu?.remove(); menu = null; }
function openMenu(btn, items, list = false) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'menu' + (list ? ' list' : '');
  for (const [icon, label, fn] of items) {
    const b = document.createElement('button');
    b.innerHTML = list ? `<span class="icon">${icon}</span>${label}` : convertLatexToMarkup(label);
    if (!list) b.title = label;
    b.onclick = e => { e.stopPropagation(); closeMenu(); fn(); };
    menu.append(b);
  }
  document.body.append(menu);
  const r = btn.getBoundingClientRect();
  menu.style.left = Math.min(r.left, innerWidth - menu.offsetWidth - 8) + 'px';
  menu.style.top = r.bottom + 2 + 'px';
}
document.addEventListener('click', e => { if (menu && !menu.contains(e.target) && !e.target.closest('[data-act=fileMenu], [data-struct]')) closeMenu(); }, true);

// Equation tab contents. #0 = selection or empty box, #? = empty box (MathLive placeholders)
const SYMBOLS = ['\\pm', '\\infty', '\\neq', '\\approx', '\\times', '\\div', '\\le', '\\ge', '\\propto', '\\degree', '\\pi', '\\theta', '\\alpha', '\\beta', '\\Delta', '\\mu', '\\lambda', '\\sigma', '\\omega', '\\Omega', '\\rightarrow', '\\Rightarrow', '\\partial', '\\nabla'];
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
$('#symbols').innerHTML = SYMBOLS.map(s => `<button class="sym" data-ins="${escAttr(s)}" title="${escAttr(s)}">${convertLatexToMarkup(s)}</button>`).join('');
$('#structures').innerHTML = Object.entries(STRUCTURES).map(([name, [icon]]) =>
  `<button class="big" data-struct="${name}"><span class="mi">${convertLatexToMarkup(icon)}</span>${name.replace(' ', '<br>')}</button>`).join('');
$('#symbols').addEventListener('click', e => { const b = e.target.closest('[data-ins]'); if (b) insertIntoEq(b.dataset.ins); });
$('#structures').addEventListener('click', e => {
  const b = e.target.closest('[data-struct]');
  if (b) openMenu(b, STRUCTURES[b.dataset.struct][1].map(l => ['', l.replace(/#0|#\?/g, '\\square'), () => insertIntoEq(l)]));
});

// ---------- editor events ----------
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  const n = s.anchorNode;
  if (!s.rangeCount || !editor.contains(n) || (n.nodeType === 3 ? n.parentNode : n).closest('.eq')) return;
  lastRange = s.getRangeAt(0).cloneRange();
  if (document.activeElement === editor) lastWasEq = false;
});
editor.addEventListener('input', schedule);

editor.addEventListener('keydown', e => {
  if (e.altKey && e.key === '=') { e.preventDefault(); return insertEquation(); }
  if (e.ctrlKey && /^[lerj]$/i.test(e.key)) {
    e.preventDefault();
    document.execCommand({ l: 'justifyLeft', e: 'justifyCenter', r: 'justifyRight', j: 'justifyFull' }[e.key.toLowerCase()]);
  }
  // arrow keys step into an equation like normal text
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey) {
    const s = getSelection();
    if (!s.isCollapsed) return;
    const fwd = e.key === 'ArrowRight';
    let n = s.anchorNode, o = s.anchorOffset;
    if (n.nodeType === 3) {
      const rest = fwd ? n.data.slice(o) : n.data.slice(0, o);
      if (rest.replace(/\u200B/g, '')) return;
      n = fwd ? n.nextSibling : n.previousSibling;
    } else n = fwd ? n.childNodes[o] : n.childNodes[o - 1];
    if (n?.classList?.contains('eq')) {
      e.preventDefault();
      const mf = n.firstChild;
      mf.focus();
      mf.position = fwd ? 0 : mf.lastOffset;
    }
  }
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); download(); }
  if (e.key === 'Escape') closeMenu();
});

setDocument(load(STORE, '') || `<h1>My maths notes</h1><p>Press Alt+= (or click Equation) to add an equation. Type normally: / makes a fraction, ^ a power, sqrt a root.</p><p><span data-latex="y=10"></span>   <span data-latex="z=2"></span></p><p><span data-latex="x=\\frac{y}{z}"></span>  ← click this equation, then press Tab to fill in the grey working.</p><p><span data-latex="10=2b+x"></span>  ← one unknown: it is solved for you.</p><p><br></p>`);
