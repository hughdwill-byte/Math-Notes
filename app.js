import { MathfieldElement, convertLatexToMarkup, convertLatexToMathMl } from 'https://cdn.jsdelivr.net/npm/mathlive@0.110.0/mathlive.min.mjs';
import { ComputeEngine } from 'https://cdn.jsdelivr.net/npm/@cortex-js/compute-engine@0.58.0/dist/compute-engine.min.esm.js';
import { evaluateDocument, formatNumber, formatUnit, prettyUnit, parseUnit, convertValue, parseVarLine, parseVariables, plainDefinition } from './calc.js';

const ce = new ComputeEngine();
const $ = s => document.querySelector(s);
const doc = $('#doc');
const PROJECTS = 'mathnotes-projects', CURRENT = 'mathnotes-current', SETTINGS = 'mathnotes-settings';

const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
// Universal constants are known in every project from the first line; a project can switch one off,
// and any line like g=10 overrides it from there down.
const UNIVERSALS = `g = 9.81 m/s^2
G = 6.674e-11 N m^2/kg^2
c = 2.998e8 m/s
k_B = 1.380649e-23 J/K
N_A = 6.02214076e23 1/mol
epsilon_0 = 8.854e-12 F/m
mu_0 = 1.2566e-6 H/m
m_e = 9.109e-31 kg
m_p = 1.673e-27 kg
q_e = 1.602e-19 C`;
const settings = { showWorking: true, universals: UNIVERSALS, ...load(SETTINGS, {}) };

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
const unitsOf = () => (projects[project].units ??= {}); // units chosen in the Variables pane

MathfieldElement.soundsDirectory = null;

// The document is a list of blocks: equation lines (.eq) and sections (.section = line + heading).
let seq = 0, current = null, result = { vars: new Map(), ghosts: {}, suggest: {} };
const blocks = () => [...doc.children];
const lastEq = () => (current?.isConnected && current.classList.contains('eq') ? current : null);

// MathLive turns some typed letter pairs into symbols; drop the ones that clash with names and words
// (C_Wing would become C_W∈g, c_Root c_R∞t, V_max V_\max, ...). Greek letters and functions stay.
const NO_SHORTCUT = 'in xin sint ii jj ee oo AA EE NN ZZ QQ RR CC TT xx vv vvv nn nnn uu uuu mm cm km kg ft mi inch lt gt sub sup sube supe and or not of th sh ch tg lb lg Re Im mod max min mean median det arg del sec dx dy dt'.split(' ');
let shortcuts;

// An equation filled in with Tab keeps what you typed in data-base; the filled part after it is
// recalculated every time, so changing decimal places or an earlier value updates the page.
function makeEq(latex = '', base) {
  const w = document.createElement('div');
  w.className = 'eq';
  w.dataset.id = ++seq;
  if (base != null) w.dataset.base = base;
  const mf = new MathfieldElement();
  mf.addEventListener('mount', () => {
    mf.smartSuperscript = false; // powers keep 2.5 or 12 until space, an arrow or an operator (like Word)
    mf.inlineShortcuts = shortcuts ??= Object.fromEntries(Object.entries(mf.inlineShortcuts).filter(([k]) => !NO_SHORTCUT.includes(k)));
  });
  mf.placeholder = '\\text{Type equation here.}';
  mf.value = latex;
  const ghost = document.createElement('span');
  ghost.className = 'ghost';
  w.append(mf, ghost);

  mf.addEventListener('focus', () => { current = w; updateDpLabel(); });
  mf.addEventListener('input', () => {
    if (w.dataset.base != null) {
      // edited the typed part: keep it filled; edited only the unit after the answer: applied when you leave
      // the line; edited the filled numbers: it becomes plain text again
      const fill = w.dataset.fill ?? '', number = fill.replace(/\\text\{[^}]*\}$/, '');
      if (fill && mf.value.endsWith(fill)) { w.dataset.base = mf.value.slice(0, -fill.length); delete w.dataset.unitEdit; }
      else if (number !== fill && mf.value.startsWith(w.dataset.base + number)) w.dataset.unitEdit = mf.value.slice((w.dataset.base + number).length);
      else if (mf.value !== w.dataset.base) { delete w.dataset.base; delete w.dataset.fill; delete w.dataset.unitEdit; }
    }
    schedule();
  });
  mf.addEventListener('blur', () => {
    if (w.dataset.unitEdit == null) return;
    const edit = w.dataset.unitEdit, typed = edit.match(/^\\text\{([^}]*)\}$/)?.[1] ?? (edit.trim() ? null : '');
    delete w.dataset.unitEdit;
    const name = [...result.vars].find(([, v]) => v.id === w.dataset.id)?.[0];
    if (typed == null || !name) return schedule();
    changeUnit(name, typed); // '' = you deleted the unit: no unit from now on
  });
  mf.addEventListener('move-out', e => {
    e.preventDefault();
    const back = e.detail.direction === 'backward' || e.detail.direction === 'upward';
    focusBlock(back ? w.previousElementSibling : w.nextElementSibling, back);
  });
  mf.addEventListener('keydown', e => {
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    if (e.key === 'Tab' && !e.shiftKey && w.dataset.ghost) { stop(); accept(w); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.shiftKey) { stop(); addLabel(w); }
    else if (e.key === 'Enter' && e.altKey) { stop(); addSublabel(w); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { stop(); addSection(w); }
    else if (e.key === 'Enter' && inMatrix(mf)) { stop(); mf.executeCommand('addRowAfter'); schedule(); }
    else if (e.key === 'Enter') { stop(); addEq(w); }
    else if (e.key === 'Backspace' && !mf.value) { stop(); removeBlock(w); }
    else if (/^[=+\-*<>,;]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) leaveScripts(mf, /[=<>]/.test(e.key));
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
    const vars = parseVarList(e.clipboardData.getData('text/plain'));
    if (html.includes('data-latex')) pasteBlocks(fromHtml(html), w);
    else if (vars) pasteVars(vars, w); // a list of variables becomes one line each
    else return; // ordinary paste: let MathLive handle it
    e.preventDefault(); e.stopPropagation();
  }, { capture: true });
  return w;
}

// Like Word: an operator typed in a subscript/superscript goes back to the main line first
// (C_M= gives C_M =, not C_{M=}); =, < and > also leave fractions (a/b= gives a/b =). Not while a
// bracket opened inside the script is still open.
// An empty box keeps it, so x^-1 still works.
// ponytail: uses MathLive's internal model (pinned 0.110.0); recheck if MathLive is upgraded
function leaveScripts(mf, relation = false) {
  const model = mf._mathfield?.model;
  const branches = relation ? /^(subscript|superscript|above|below)$/ : /^(subscript|superscript)$/;
  for (let i = 0; i < 8; i++) {
    const atom = model?.at(model.position);
    if (!branches.test(atom?.parentBranch) || atom.type === 'first') return;
    if (/^(extensible-symbol|operator)$/.test(atom.parent?.type)) return; // limits of ∑ ∏ ∫ lim: i=1 belongs there
    // inside a bracket opened in this power/subscript (e^{-0.1(C-20)}): the operator belongs in there
    const sibs = atom.parent?.branch?.(atom.parentBranch) ?? [], upTo = sibs.slice(0, sibs.indexOf(atom) + 1);
    if (upTo.filter(x => x.type === 'mopen').length > upTo.filter(x => x.type === 'mclose').length) return;
    mf.executeCommand('moveAfterParent');
  }
}

function inMatrix(mf) {
  const model = mf._mathfield?.model;
  for (let a = model?.at(model.position); a; a = a.parent) if (a.type === 'array') return true;
  return false;
}

// rows x cols matrix of empty boxes; env is pmatrix ( ), bmatrix [ ] or vmatrix | |
const matrix = (r, c, env = 'bmatrix') =>
  `\\begin{${env}}${Array.from({ length: r }, () => Array(c).fill('#?').join('&')).join('\\\\')}\\end{${env}}`;

function customMatrix() {
  const size = prompt('Matrix size (rows × columns), e.g. 3x4:', '3x3');
  const m = size?.match(/(\d+)\s*[x×*, ]\s*(\d+)/i);
  if (!m) return;
  const r = Math.min(+m[1], 20), c = Math.min(+m[2], 20);
  if (r > 0 && c > 0) insertIntoEq(matrix(r, c));
}

// add/remove rows and columns of the matrix the caret is in
function matrixCmd(cmd, mf = lastEq()?.firstChild) {
  if (!mf) return;
  mf.focus();
  if (!inMatrix(mf)) return alert('Click inside a matrix first.');
  mf.executeCommand(cmd);
  schedule();
}

// A section is a line with a heading; a label is a smaller subheading (no line) for an equation or group;
// a sublabel is one level smaller again, under a label.
function makeSection(title = '', kind = 'section') {
  const label = kind !== 'section';
  const s = document.createElement('div');
  s.className = kind;
  const h = document.createElement({ section: 'h2', label: 'h3', sublabel: 'h4' }[kind]);
  h.contentEditable = 'plaintext-only';
  h.textContent = title;
  if (label) s.append(h); else s.append(document.createElement('hr'), h);
  h.addEventListener('focus', () => { current = s; updateDpLabel(); });
  h.addEventListener('input', schedule);
  h.addEventListener('copy', e => { e.preventDefault(); label ? copyBlocks(groupOf(s)) : copySection(s); }); // Ctrl+C on a heading copies what's under it
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
    const h = b.querySelector('h2, h3, h4');
    h.focus();
    getSelection().selectAllChildren(h);
    getSelection().collapseToEnd();
  }
}

const after = (ref, node) => (ref?.isConnected ? ref.after(node) : doc.append(node), node);
function addEq(ref = current, latex = '') { const w = after(ref, makeEq(latex)); focusBlock(w); schedule(); return w; }
function addSection(ref = current, kind = 'section') {
  const s = after(ref, makeSection('', kind));
  if (ref?.classList?.contains('eq') && !ref.firstChild.value) ref.remove(); // a heading started on an empty line replaces it
  focusBlock(s); schedule(); return s;
}
const addLabel = (ref = current) => addSection(ref, 'label');
const addSublabel = (ref = current) => addSection(ref, 'sublabel');
const makeBlock = b => b.section != null ? makeSection(b.section) : b.label != null ? makeSection(b.label, 'label')
  : b.sublabel != null ? makeSection(b.sublabel, 'sublabel') : makeEq(b.eq, b.base);

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
  // ∑/∏/∫ with both limits: MathLive starts in the top limit; start in the bottom one (i=1) instead
  if (/^\\[a-z]+_\{#\?\}\^\{#\?\}/.test(latex)) mf.executeCommand('moveToNextPlaceholder');
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
  result = evaluateDocument(ce, eqs.map(w => ({ id: w.dataset.id, latex: w.dataset.base ?? w.firstChild.value })), dpOf(), settings.showWorking, universals(), unitsOf());
  const typedDp = Object.entries(result.typedDp).filter(([n]) => dpOf()[n] == null);
  if (typedDp.length) { for (const [n, d] of typedDp) dpOf()[n] = d; return recompute(); }
  for (const w of eqs) {
    let g = result.ghosts[w.dataset.id] || '';
    if (w.dataset.base == null && result.refill[w.dataset.id] != null) { w.dataset.base = result.refill[w.dataset.id]; w.dataset.fill = ''; }
    if (w.dataset.unitEdit != null) g = '';
    if (w.dataset.base != null && w.dataset.unitEdit == null) { // (not while you're editing the unit)
      const mf = w.firstChild, value = w.dataset.base + g;
      w.dataset.fill = g;
      g = '';
      if (mf.value !== value) {
        const pos = mf.position;
        mf.value = value;
        mf.position = Math.min(pos, mf.lastOffset);
      }
    }
    const hints = result.hints[w.dataset.id] ?? [], key = g + JSON.stringify(hints);
    if (w.dataset.ghostKey === key) continue;
    w.dataset.ghostKey = key;
    w.dataset.ghost = g;
    // e.g. "C_Lα isn't defined, did you mean C_La?" (a typed where α was meant, or the other way round)
    const hint = hints.map(([unknown, known]) => `<span class="near">${convertLatexToMarkup(unknown)} isn't defined. Did you mean ${convertLatexToMarkup(known)}?</span>`).join('');
    w.lastChild.innerHTML = (g ? convertLatexToMarkup(g) + '<kbd>Tab</kbd>' : '') + hint;
  }
  renderVars();
  updateDpLabel();
  const n = eqs.filter(w => w.firstChild.value).length;
  $('#eq-count').textContent = `${n} equation${n === 1 ? '' : 's'}`;
  $('#var-count').textContent = `${result.vars.size} variable${result.vars.size === 1 ? '' : 's'}`;
  saveProject();
}

function saveProject() {
  projects[project] = { blocks: serialize(), dp: dpOf(), off: offList(), units: unitsOf() };
  store(PROJECTS, projects);
  store(CURRENT, project);
}

// several "name = value" lines (or name<tab>value rows from Excel) -> equation blocks, else null
// several "name = value" lines or a pasted table -> equation blocks, else null (an ordinary paste)
function parseVarList(text) {
  if (!/\n|\t/.test(text.trim())) return null;
  const { vars, skipped } = parseVariables(text);
  if (!vars.length) return null;
  return Object.assign(vars, { skipped });
}

// Pasted variables go into a "Variables" section at the top (made if needed). A variable already set by a
// plain "name = number" line anywhere is updated in place instead, so pasting the same table twice doesn't repeat it.
function pasteVars(vars, from) {
  const existing = new Map();
  for (const w of doc.querySelectorAll('.eq')) {
    const k = plainDefinition(w.firstChild.value);
    if (k && !existing.has(k)) existing.set(k, w);
  }
  const fresh = [];
  let updated = 0;
  const lines = new Set([...doc.querySelectorAll('.eq')].map(w => w.firstChild.value));
  for (const v of vars) {
    if (!v.key) { if (lines.has(v.latex)) continue; lines.add(v.latex); fresh.push(v.latex); continue; } // e.g. Q·S·c_bar = 4.473
    const w = existing.get(v.key);
    if (!w) { fresh.push(v.latex); existing.set(v.key, true); continue; }
    if (w === true) continue; // repeated within the same paste
    if (w.firstChild.value !== v.latex) { w.firstChild.value = v.latex; delete w.dataset.base; updated++; }
  }
  if (fresh.length) {
    let sec = [...doc.querySelectorAll('.section')].find(b => b.querySelector('h2').textContent.trim().toLowerCase() === 'variables');
    if (!sec) { sec = makeSection('Variables'); doc.prepend(sec); }
    let at = sectionOf(sec).at(-1);
    if (at !== sec && at.classList.contains('eq') && !at.firstChild.value && at !== from) { const prev = at.previousElementSibling; at.remove(); at = prev; }
    for (const latex of fresh) at = after(at, makeEq(latex));
  }
  // the empty line you pasted into isn't needed any more
  if (from?.classList.contains('eq') && !from.firstChild.value && doc.children.length > 1) {
    const next = from.nextElementSibling ?? from.previousElementSibling;
    from.remove();
    focusBlock(next, true);
  }
  schedule();
  const same = vars.length - fresh.length - updated;
  const skipped = vars.skipped?.length ? ` · skipped (no symbol and number): ${vars.skipped.join('; ').slice(0, 100)}` : '';
  flash(`Variables: added ${fresh.length}${updated ? `, updated ${updated}` : ''}${same ? `, ${same} already there` : ''}` + (fresh.length ? ' in the Variables section at the top' : '') + skipped);
}

const universalList = () => settings.universals.split('\n').map(parseVarLine).filter(u => u?.key && u.number != null);
const offList = () => (projects[project].off ??= []);
const universals = () => universalList().filter(u => !offList().includes(u.key)).map(u => ({ key: u.key, latex: u.nameLatex, value: u.number, unit: u.unit }));

const COMMON_UNITS = 'm mm cm km s min h kg g N kN Pa kPa MPa J kJ W kW m/s m/s² km/h kg/m³ m² m³ N·m rad deg 1/rad 1/deg K °C A V Ω Hz'.split(' ');

function renderVars() {
  const docUnits = [...new Set([...result.vars.values()].map(v => formatUnit(v.unit)).filter(Boolean))];
  const rows = [...result.vars].filter(([, v]) => v.id !== 'universal').map(([name, v], i) => {
    const dp = dpOf()[name];
    const opts = ['<option value="">Auto</option>', ...Array.from({ length: 11 }, (_, i) => `<option${dp === i ? ' selected' : ''}>${i}</option>`)].join('');
    // unit box: type your own or pick; equation-based suggestions first, then units in this document, then common ones
    const fits = result.suggest[name] ?? [];
    const list = [...fits.map(u => `<option value="${esc(u)}" label="fits the equations">`),
      ...[...docUnits, ...COMMON_UNITS].filter((u, j, l) => !fits.includes(u) && l.indexOf(u) === j).map(u => `<option value="${esc(u)}">`)].join('');
    const set = unitsOf()[name] != null;
    return `<tr><td data-latex="${esc(v.latex)}" title="Insert into equation">${convertLatexToMarkup(v.latex)}</td>
      <td>${convertLatexToMarkup(formatNumber(v.value, dp))}</td>
      <td><input class="unit-in${set ? ' set' : ''}" data-unit="${esc(name)}" list="ul${i}" value="${esc(v.unitText ?? formatUnit(v.unit))}" placeholder="${esc(fits[0] ? fits[0] + '?' : 'unit')}" title="${set ? 'Unit you chose. Clear it to go back to the worked-out unit.' : 'Type a unit or pick one; the first suggestions fit your equations'}" spellcheck="false"><datalist id="ul${i}">${list}</datalist></td>
      <td><select data-var="${esc(name)}" title="Decimal places">${opts}</select></td></tr>`;
  }).join('');
  const uni = universalList().map(u => {
    const off = offList().includes(u.key);
    return `<tr class="${off ? 'off' : ''}"><td data-latex="${esc(u.nameLatex)}" title="Insert into equation">${convertLatexToMarkup(u.nameLatex)}</td>
      <td>${convertLatexToMarkup(formatNumber(u.number, null))} <span class="unit">${esc(u.unit)}</span></td>
      <td><button data-uni="${esc(u.key)}" title="${off ? 'Use again in this project' : 'Stop using in this project'}"><span class="icon">${off ? 'undo' : 'close'}</span></button></td></tr>`;
  }).join('');
  $('#vars').innerHTML = (rows
    ? `<table><tr><th>Name</th><th>Value</th><th>Unit</th><th>d.p.</th></tr>${rows}</table>`
    : '<p class="hint">No variables yet. Type something like x=5, or use Paste variables.</p>') +
    `<h4>Universal <button data-act="editUniversals" title="Edit the universal constants (all projects)"><span class="icon">edit</span>Edit</button></h4>
    <p class="hint">Known in every project. ✕ stops using one in this project; writing e.g. g=10 overrides it from that line down.</p>
    <table><tr title="Built in: Euler's number. Writing e=... in the document overrides it."><td data-latex="e">${convertLatexToMarkup('e')}</td><td>2.718281828459045</td><td></td></tr>${uni}</table>`;
}

// A unit picked in the Variables pane. Convertible (mm -> m): a "name = number unit" line is rewritten with
// the converted number; a calculated variable keeps the chosen unit and its value is converted wherever it's used.
// Not convertible (or no unit before): the unit is just relabelled.
function changeUnit(name, text) {
  if (/^auto$/i.test(text.trim())) { delete unitsOf()[name]; flash('Unit back to the worked-out one'); return recompute(); }
  text = prettyUnit(text); // s^-1 -> s⁻¹
  const v = result.vars.get(name), w = v && doc.querySelector(`.eq[data-id="${v.id}"]`);
  const from = v?.unit ?? {}, to = parseUnit(text);
  const converted = text && Object.keys(from).length ? convertValue(v.value, from, to) : null;
  const line = w && (w.dataset.base ?? w.firstChild.value);
  const incompatible = text && Object.keys(from).length && converted == null;
  if (line && plainDefinition(line) === name) {
    // the variable's own "name = number unit" line: rewrite it so the page always matches the maths
    w.firstChild.value = `${line.slice(0, line.indexOf('='))}=${formatNumber(converted ?? v.value, null)}${text ? `\\text{ ${text}}` : ''}`;
    delete w.dataset.base;
    delete unitsOf()[name];
  } else unitsOf()[name] = text; // '' = no unit (a deleted unit stays deleted)
  flash(incompatible ? `${formatUnit(from)} and ${text} measure different things, so the unit was relabelled, not converted`
    : converted != null ? `Converted ${formatUnit(from)} → ${text}` : text ? `Unit set to ${text}` : 'Unit removed (type "auto" to get the worked-out unit back)');
  recompute();
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
  : b.classList.contains('label') ? { label: b.querySelector('h3').textContent }
  : b.classList.contains('sublabel') ? { sublabel: b.querySelector('h4').textContent }
  : { section: b.querySelector('h2').textContent });

// also reads the older HTML format (equations and headings kept, other text dropped)
function fromHtml(html) {
  const t = document.createElement('template');
  t.innerHTML = html;
  return [...t.content.querySelectorAll('[data-latex], h1, h2, h3, h4')].map(el =>
    el.dataset.latex != null ? { eq: el.dataset.latex } : el.tagName === 'H3' ? { label: el.textContent.trim() }
      : el.tagName === 'H4' ? { sublabel: el.textContent.trim() } : { section: el.textContent.trim() });
}

function setDocument(list) {
  if (typeof list === 'string') list = fromHtml(list);
  doc.replaceChildren(...(list?.length ? list : [{ eq: '' }]).map(makeBlock));
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
  getHandle(project).then(h => { setHandle(n, h); setHandle(project, null); });
  openProject(n);
}

function deleteProject() {
  if (!confirm(`Delete the project "${project}"? This cannot be undone.`)) return;
  delete projects[project];
  setHandle(project, null);
  if (!Object.keys(projects).length) projects.Untitled = { blocks: [], dp: {} };
  openProject(Object.keys(projects)[0]);
}

// Each project remembers the file it was saved to / opened from (kept in IndexedDB), so Save overwrites it.
// Needs the File System Access API (Chrome, Edge); other browsers can only download a new copy.
const idb = new Promise(res => {
  try {
    const r = indexedDB.open('mathnotes', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('handles');
    r.onsuccess = () => res(r.result);
    r.onerror = () => res(null);
  } catch { res(null); }
});
async function handles(mode, fn) {
  const db = await idb;
  if (!db) return;
  return new Promise(res => {
    try {
      const tx = db.transaction('handles', mode), req = fn(tx.objectStore('handles'));
      tx.oncomplete = () => res(req.result);
      tx.onerror = () => res();
    } catch { res(); }
  });
}
const liveHandles = {}; // this session's handles, in case IndexedDB is unavailable
const getHandle = async n => liveHandles[n] ?? handles('readonly', s => s.get(n));
const setHandle = (n, h) => { if (h) liveHandles[n] = h; else delete liveHandles[n]; return handles('readwrite', s => (h ? s.put(h, n) : s.delete(n))); };
const FILE_TYPES = [{ description: 'Math Notes project', accept: { 'application/json': ['.mathnotes'] } }];

function flash(msg) {
  $('#save-status').textContent = msg;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => { $('#save-status').textContent = ''; }, 4000);
}

async function saveFile(saveAs = false) {
  const data = JSON.stringify({ blocks: serialize(), dp: dpOf(), off: offList() });
  if (!window.showSaveFilePicker) {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([data], { type: 'application/json' })), download: project + '.mathnotes' });
    a.click();
    URL.revokeObjectURL(a.href);
    return;
  }
  try {
    let h = saveAs ? null : await getHandle(project);
    if (h && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null;
    h ||= await showSaveFilePicker({ suggestedName: project + '.mathnotes', types: FILE_TYPES });
    const w = await h.createWritable();
    await w.write(data);
    await w.close();
    await setHandle(project, h);
    flash(`Saved to ${h.name}`);
  } catch (e) { if (e.name !== 'AbortError') alert('Could not save the file: ' + e.message); }
}

async function openFile() {
  if (!window.showOpenFilePicker) return $('#open-file').click();
  try {
    const [h] = await showOpenFilePicker({ types: FILE_TYPES });
    loadFile(await h.getFile(), h);
  } catch (e) { if (e.name !== 'AbortError') alert('Could not open the file: ' + e.message); }
}

async function loadFile(f, handle) {
  try {
    const data = JSON.parse(await f.text());
    const name = f.name.replace(/\.mathnotes$/i, '').trim() || 'Untitled';
    // opening the same project's file again updates that project instead of making a copy
    const n = projects[name] && confirm(`Replace the project "${name}" with this file?\n\nCancel opens it as a separate copy.`) ? name : uniqueName(name);
    projects[n] = { blocks: data.blocks ?? fromHtml(data.html ?? ''), dp: data.dp ?? {}, off: data.off ?? [] };
    if (handle) await setHandle(n, handle);
    openProject(n);
  } catch { alert('That file could not be opened. Choose a .mathnotes file saved from Math Notes.'); }
}

$('#open-file').addEventListener('change', e => {
  if (e.target.files[0]) loadFile(e.target.files[0]);
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

// the nearest label or sublabel above b and everything under it, down to the next heading of the same
// or a higher level (null if not under a label)
function groupOf(b) {
  while (b.previousElementSibling && !b.matches('.label, .sublabel, .section')) b = b.previousElementSibling;
  if (!b.matches('.label, .sublabel')) return null;
  const stop = b.matches('.label') ? '.label, .section' : '.sublabel, .label, .section';
  const out = [b];
  for (let n = b.nextElementSibling; n && !n.matches(stop); n = n.nextElementSibling) out.push(n);
  return out;
}

function copyBlocks(els) {
  const all = serialize(), list = els.map(b => all[blocks().indexOf(b)]).filter(b => b.section != null || b.label != null || b.sublabel != null || b.eq);
  copyHtml(
    list.map(b => b.section != null ? `<hr><h2>${esc(b.section)}</h2>` : b.label != null ? `<h3>${esc(b.label)}</h3>`
      : b.sublabel != null ? `<h4>${esc(b.sublabel)}</h4>` : `<p>${eqHtml(b.eq)}</p>`).join(''),
    list.map(b => b.section != null ? `\n${b.section}\n` : b.label ?? b.sublabel ?? b.eq).join('\n'));
}

function pasteBlocks(list, ref) {
  let at = ref;
  for (const b of list) at = after(at, makeBlock(b));
  if (ref?.classList.contains('eq') && !ref.firstChild.value) ref.remove();
  focusBlock(at, true);
  schedule();
}

// text box dialog; resolves to the text, or null if cancelled
function ask(title, hint, text = '') {
  const d = $('#dlg');
  $('#dlg-title').textContent = title;
  $('#dlg-hint').textContent = hint;
  $('#dlg-text').value = text;
  d.returnValue = '';
  d.showModal();
  $('#dlg-text').focus();
  return new Promise(res => d.addEventListener('close', () => res(d.returnValue === 'ok' ? $('#dlg-text').value : null), { once: true }));
}

async function pasteVariables(ref = current) {
  const text = await ask('Paste variables', 'Paste a table copied from Excel, Word or a web page (a symbol column, a value column and optionally a units column, in any order, header row optional), or type one per line like "m = 5 kg". Each becomes an equation line you can use below it.');
  if (!text?.trim()) return;
  const { vars, skipped } = parseVariables(text);
  if (skipped.length) alert(`These rows weren't understood and were skipped:\n${skipped.join('\n')}\n\nEach needs a symbol (like m, v0, C_L, ρ or theta) and a number.`);
  if (vars.length) pasteVars(vars, ref?.isConnected ? ref : doc.lastElementChild);
}

async function editUniversals() {
  const text = await ask('Universal constants', 'Used in every project. One per line: name = number unit. Delete a line to remove it everywhere.', settings.universals);
  if (text == null) return;
  settings.universals = text.trim();
  store(SETTINGS, settings);
  recompute();
}

// ---------- ribbon ----------
const actions = {
  newEq: () => addEq(),
  newSection: () => addSection(),
  newLabel: () => addLabel(),
  newSublabel: () => addSublabel(),
  addRow: () => matrixCmd('addRowAfter'),
  addCol: () => matrixCmd('addColumnAfter'),
  delRow: () => matrixCmd('removeRow'),
  delCol: () => matrixCmd('removeColumn'),
  customMatrix,
  deleteLine: () => removeBlock(current),
  copyAll,
  pasteVariables: () => pasteVariables(),
  editUniversals,
  copySection: () => copySection(),
  copyEq: () => { const w = lastEq(); if (w) copyHtml(eqHtml(w.firstChild.value), mathml(w.firstChild.value)); },
  accept: () => accept(),
  dpUp: () => bumpDp(1),
  dpDown: () => bumpDp(-1),
  save: () => saveFile(),
  print: () => print(),
  togglePane: () => { $('#pane').hidden = !$('#pane').hidden; },
  toggleSymbols: () => { $('#sympane').hidden = !$('#sympane').hidden; },
  fileMenu: btn => openMenu(btn, [
    ['note_add', 'New project…', newProject],
    ['edit', 'Rename project…', renameProject],
    ['delete', 'Delete project…', deleteProject],
    ['save', 'Save (Ctrl+S)', () => saveFile()],
    ['save_as', 'Save as…', () => saveFile(true)],
    ['upload', 'Open from a file…', openFile],
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
  const b = e.target.closest?.('.eq, .section, .label, .sublabel');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  current = b;
  const eq = b.classList.contains('eq') && b.firstChild.value;
  openMenu(b, [
    ...(eq ? [['function', 'Copy equation', () => copyHtml(eqHtml(eq), mathml(eq))]] : []),
    ...(groupOf(b) ? [['label', 'Copy labelled part', () => copyBlocks(groupOf(b))]] : []),
    ['content_copy', 'Copy section', () => copySection(b)],
    ['select_all', 'Copy all', copyAll],
    ['add', 'New equation below', () => addEq(b)],
    ['horizontal_rule', 'New section below', () => addSection(b)],
    ['label', 'New label below', () => addLabel(b)],
    ['subdirectory_arrow_right', 'New sub-label below', () => addSublabel(b)],
    ...(eq && eq.includes('\\begin{') ? [
      ['table_rows', 'Matrix: add row', () => matrixCmd('addRowAfter', b.firstChild)],
      ['view_column', 'Matrix: add column', () => matrixCmd('addColumnAfter', b.firstChild)],
      ['remove', 'Matrix: remove row', () => matrixCmd('removeRow', b.firstChild)],
      ['remove', 'Matrix: remove column', () => matrixCmd('removeColumn', b.firstChild)],
    ] : []),
    ['playlist_add', 'Paste variables here…', () => pasteVariables(b)],
    ['delete', 'Delete line', () => removeBlock(b)],
  ], true, { left: e.clientX, bottom: e.clientY });
}, { capture: true });

$('#vars').addEventListener('click', e => {
  const k = e.target.closest('[data-uni]')?.dataset.uni;
  if (!k) return;
  const off = offList(), i = off.indexOf(k);
  if (i < 0) off.push(k); else off.splice(i, 1);
  recompute();
});

$('#vars').addEventListener('change', e => {
  const u = e.target.dataset.unit;
  if (u != null) return changeUnit(u, e.target.value.trim());
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
  Matrix: ['\\begin{bmatrix}1&0\\\\0&1\\end{bmatrix}', [matrix(2, 2), matrix(3, 3), matrix(2, 2, 'pmatrix'), matrix(3, 3, 'pmatrix'), matrix(2, 2, 'vmatrix'), matrix(3, 3, 'vmatrix'), matrix(1, 3), matrix(3, 1), '\\text{Custom size…}']],
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
  if (b?.dataset.struct) openMenu(b, STRUCTURES[b.dataset.struct][1].map(l => ['', l.replace(/#0|#\?/g, '\\square'), () => l.startsWith('\\text{Custom') ? customMatrix() : insertIntoEq(l)]));
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(e.shiftKey); }
  if (e.altKey && e.key === '=') { e.preventDefault(); addEq(); }
  if (e.key === 'Escape') closeMenu();
});

if (innerWidth < 860) $('#sympane').hidden = $('#pane').hidden = true; // phones: open from View
openProject(project);
