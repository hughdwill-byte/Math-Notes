// Maths engine: reads an equation's LaTeX, remembers variables, fills in numbers, solves for one unknown.
// Pure functions; the Compute Engine instance (ce) is passed in so this runs in the browser and in node tests.

const GREEK = new Set(('alpha beta gamma delta epsilon varepsilon zeta eta theta vartheta iota kappa lambda mu nu xi rho sigma tau upsilon phi varphi chi psi omega ' +
  'Gamma Delta Theta Lambda Xi Sigma Upsilon Phi Psi Omega').split(' ').map(g => '\\' + g));
const OPAQUE = new Set(['\\mathrm', '\\text', '\\operatorname', '\\mathit', '\\begin', '\\end', '\\textrm', '\\mathbf']);
const SPLIT_STATEMENT = new Set(['\\Rightarrow', '\\implies', '\\therefore']);
const SPLIT_PART = new Set(['=', '\\approx']);

export function tokenize(latex) {
  const t = [];
  for (let i = 0; i < latex.length;) {
    const c = latex[i];
    if (c === '\\') {
      const m = /^\\([a-zA-Z]+|.)/.exec(latex.slice(i));
      t.push(m[0]); i += m[0].length;
    } else if (/\s/.test(c)) i++;
    else { t.push(c); i++; }
  }
  return t;
}

export function join(tokens) {
  let s = '';
  for (const tk of tokens) s += (/\\[a-zA-Z]+$/.test(s) && /^[a-zA-Z0-9]/.test(tk) ? ' ' : '') + tk;
  return s;
}

// index just past the group starting at i (a brace group or a single token)
function groupEnd(t, i) {
  if (t[i] !== '{') return i + 1;
  for (let d = 0; i < t.length; i++) {
    if (t[i] === '{') d++;
    else if (t[i] === '}' && --d === 0) return i + 1;
  }
  return i;
}

function splitTop(t, seps) {
  const out = [[]];
  let d = 0;
  for (const tk of t) {
    if (tk === '{') d++;
    if (tk === '}') d--;
    if (d === 0 && seps.has(tk)) out.push([]);
    else out[out.length - 1].push(tk);
  }
  return out;
}

// A variable starting at t[i]: a letter, a Greek letter or a multi-letter \mathrm{AR}, with an optional
// subscript (which may itself have subscripts). Returns { end, name, latex } or null.
// Multi-letter names in use (e.g. AR from \mathrm{AR}_{wing}), so a typed "AR_{wing}" means that variable,
// not A times R_wing. Set by evaluateDocument from the document's own names.
// ponytail: module-level state; pass it through if scanning ever runs for two documents at once
let MULTI = [];

const ACCENTS = { '\\bar': 'bar', '\\overline': 'bar', '\\hat': 'hat', '\\dot': 'dot', '\\ddot': 'ddot', '\\vec': 'vec', '\\tilde': 'tilde' };

function symbolAt(t, i) {
  const tk = t[i];
  let end, name;
  // c̄ (\bar{c}) is its own variable, the same one as c_bar from a pasted table
  if (ACCENTS[tk]) {
    const ge = groupEnd(t, i + 1), inner = t[i + 1] === '{' ? t.slice(i + 2, ge - 1) : t.slice(i + 1, ge), s = symbolAt(inner, 0);
    if (!s || s.end !== inner.length) return null;
    [end, name] = [ge, `${s.name}_${ACCENTS[tk]}`];
    let latex = join(t.slice(i, end));
    if (t[end] === '_') { const se = groupEnd(t, end + 1), sub = t.slice(end + 1, se); name += join(sub[0] === '{' ? sub.slice(1, -1) : sub).replace(/\\/g, ''); latex += join(t.slice(end, se)); end = se; }
    return { end, name, latex };
  }
  const multi = /^[a-zA-Z]$/.test(tk) && MULTI.find(m => t.slice(i, i + m.length).join('') === m);
  if (multi) [end, name] = [i + multi.length, multi];
  else if (/^[a-zA-Z]$/.test(tk)) [end, name] = [i + 1, tk];
  else if (GREEK.has(tk)) [end, name] = [i + 1, tk.slice(1).replace(/^var/, '')];
  else if ((tk === '\\mathrm' || tk === '\\operatorname') && t[i + 1] === '{') {
    const ge = groupEnd(t, i + 1), inner = join(t.slice(i + 2, ge - 1));
    if (!/^[A-Za-z]{2,}$/.test(inner)) return null;
    [end, name] = [ge, inner];
  } else return null;
  let latex = join(t.slice(i, end));
  if (t[end] === '_') {
    const ge = groupEnd(t, end + 1), sub = t.slice(end + 1, ge);
    const inner = join(sub[0] === '{' ? sub.slice(1, -1) : sub);
    name += '_' + inner.replace(/\\var(epsilon|theta|phi)/g, '$1').replace(/\\/g, '');
    latex += '_{' + inner + '}';
    end = ge;
  }
  return { end, name, latex };
}

// Finds variable occurrences in a token list. Returns { occ: [{start,end,name,latex}], bound: Set }
export function scan(t) {
  const occ = [], bound = new Set();
  const hasInt = t.some(tk => /^\\(int|iint|oint)$/.test(tk));
  for (let i = 0; i < t.length;) {
    const tk = t[i];
    if ((tk === '\\sum' || tk === '\\prod') && t[i + 1] === '_') {
      const m = join(t.slice(i + 2, groupEnd(t, i + 2))).match(/^\{?([a-zA-Z])=/);
      if (m) bound.add(m[1]);
    }
    // differential "dx" inside an integral
    if (hasInt && tk === 'd' && /^[a-zA-Z]$/.test(t[i + 1] || '')) { bound.add(t[i + 1]); i += 2; continue; }
    // a derivative written as a quantity, e.g. \frac{\partial\varepsilon}{\partial\alpha}
    if (tk === '\\frac' && t[i + 1] === '{') {
      const e1 = groupEnd(t, i + 1), e2 = t[e1] === '{' ? groupEnd(t, e1) : -1;
      // dε/dα and ∂ε/∂α are the same quantity (same name)
      const part = g => (g[0] === 'd' || g[0] === '\\partial') && symbolAt(g, 1)?.end === g.length ? 'd' + symbolAt(g, 1).name : null;
      const a = e2 > 0 && part(t.slice(i + 2, e1 - 1)), b = a && part(t.slice(e1 + 1, e2 - 1));
      if (b) {
        occ.push({ start: i, end: e2, name: `${a}/${b}`.replace(/\\/g, ''), latex: join(t.slice(i, e2)) });
        i = e2; continue;
      }
    }
    if (OPAQUE.has(tk) && !symbolAt(t, i)) { i = groupEnd(t, i + 1); continue; }
    const sym = symbolAt(t, i);
    if (sym) { occ.push({ start: i, ...sym }); i = sym.end; continue; }
    i++;
  }
  return { occ: occ.filter(o => !bound.has(o.name)), bound };
}

export function formatNumber(v, dp) {
  if (dp != null) return v.toFixed(dp);
  if (v !== 0 && (Math.abs(v) >= 1e9 || Math.abs(v) < 1e-4)) {
    const [m, e] = v.toExponential(4).split('e');
    return `${parseFloat(m)}\\times10^{${parseInt(e)}}`;
  }
  return String(parseFloat(v.toPrecision(10)));
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?(\\times10\^\{-?\d+\})?$/;

// Replace known variables (vals: name -> latex string) in tokens.
function substitute(t, occ, vals) {
  const out = [];
  let i = 0;
  for (const o of occ) {
    if (!(o.name in vals)) continue;
    out.push(...t.slice(i, o.start));
    let v = vals[o.name];
    if (/^-|\\times/.test(v)) v = `\\left(${v}\\right)`;
    const prev = out[out.length - 1] || '';
    if (prev === '^' || prev === '_' || prev === '\\frac' || prev === '\\sqrt') v = `{${v}}`;
    else if (/^[0-9a-zA-Z.)}!]$/.test(prev) || GREEK.has(prev) || prev === '\\pi') out.push('\\cdot');
    out.push(...tokenize(v));
    i = o.end;
  }
  out.push(...t.slice(i));
  return out;
}

function toNumber(boxed) {
  const v = boxed.valueOf();
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- units ----------
// A unit is a map of unit names to powers: "kg·m/s²" -> { kg: 1, m: 1, s: -2 }. No conversions (mm stays mm).
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function parseUnit(text = '') {
  const s = text.trim().replace(/[⁰-⁹¹²³⁻]+/g, d => '^' + [...d].map(c => c === '⁻' ? '-' : SUPS.indexOf(c)).join(''));
  const slash = s.indexOf('/');
  const u = {};
  const add = (part, sign) => {
    for (const f of part.replace(/^\(|\)$/g, '').split(/[·*⋅\s]+/)) {
      const m = f.match(/^([A-Za-zµμΩ°%Å]+)(?:\^\(?(-?[\d.]+)\)?)?$/);
      if (m) u[m[1]] = (u[m[1]] || 0) + sign * (m[2] ? +m[2] : 1);
    }
  };
  add(slash < 0 ? s : s.slice(0, slash), 1);
  if (slash >= 0) add(s.slice(slash + 1), -1);
  return clean(u);
}
const clean = u => Object.fromEntries(Object.entries(u).filter(([, e]) => Math.abs(e) > 1e-12));
const sameUnit = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
const mulU = (a, b, k = 1) => { const u = { ...a }; for (const [n, e] of Object.entries(b)) u[n] = (u[n] || 0) + k * e; return clean(u); };
const powU = (a, p) => clean(Object.fromEntries(Object.entries(a).map(([n, e]) => [n, e * p])));
const ANGLE = /^(deg|rad|°)$/;
const noAngles = u => Object.fromEntries(Object.entries(u).filter(([n]) => !ANGLE.test(n)));

// Conversions: each unit as a factor times SI base dimensions (angles get their own "rad" dimension so
// deg <-> rad converts). Units not listed only match themselves.
const SI = (f, d) => [f, d];
const L = { m: 1 }, M = { kg: 1 }, T = { s: 1 }, F = { kg: 1, m: 1, s: -2 }, P = { kg: 1, m: -1, s: -2 }, E = { kg: 1, m: 2, s: -2 }, W = { kg: 1, m: 2, s: -3 };
const UNITS = {
  m: SI(1, L), mm: SI(1e-3, L), cm: SI(1e-2, L), km: SI(1e3, L), µm: SI(1e-6, L), μm: SI(1e-6, L), um: SI(1e-6, L), in: SI(0.0254, L), ft: SI(0.3048, L), mi: SI(1609.344, L), nmi: SI(1852, L),
  kg: SI(1, M), g: SI(1e-3, M), mg: SI(1e-6, M), t: SI(1e3, M), lb: SI(0.45359237, M),
  s: SI(1, T), ms: SI(1e-3, T), min: SI(60, T), h: SI(3600, T), hr: SI(3600, T),
  N: SI(1, F), kN: SI(1e3, F), MN: SI(1e6, F), lbf: SI(4.4482216152605, F),
  Pa: SI(1, P), kPa: SI(1e3, P), MPa: SI(1e6, P), GPa: SI(1e9, P), bar: SI(1e5, P), mbar: SI(100, P), psi: SI(6894.757293168, P), atm: SI(101325, P),
  J: SI(1, E), kJ: SI(1e3, E), MJ: SI(1e6, E), Wh: SI(3600, E), kWh: SI(3.6e6, E), W: SI(1, W), kW: SI(1e3, W), MW: SI(1e6, W), hp: SI(745.69987158, W),
  Hz: SI(1, { s: -1 }), L: SI(1e-3, { m: 3 }), mL: SI(1e-6, { m: 3 }), kn: SI(1852 / 3600, { m: 1, s: -1 }), mph: SI(0.44704, { m: 1, s: -1 }),
  rad: SI(1, { rad: 1 }), deg: SI(Math.PI / 180, { rad: 1 }), '°': SI(Math.PI / 180, { rad: 1 }),
  K: SI(1, { K: 1 }), '°C': SI(1, { K: 1 }), A: SI(1, { A: 1 }), V: SI(1, { ...W, A: -1 }), Ω: SI(1, { kg: 1, m: 2, s: -3, A: -2 }),
};
function toSI(u) {
  let f = 1, d = {};
  for (const [n, e] of Object.entries(u)) { const [k, dims] = UNITS[n] ?? [1, { [n]: 1 }]; f *= k ** e; d = mulU(d, dims, e); }
  return [f, d];
}
// value in unit `from` expressed in unit `to`, or null if they measure different things
export function convertValue(v, from, to) {
  const only = (u, n) => Object.keys(u).length === 1 && u[n] === 1;
  if (only(from, '°C') && only(to, 'K')) return v + 273.15;
  if (only(from, 'K') && only(to, '°C')) return v - 273.15;
  const [a, da] = toSI(from), [b, db] = toSI(to);
  return sameUnit(da, db) ? v * a / b : null;
}

// a unit as typed, tidied for display: "s^-1" -> "s⁻¹", "kg*m^2" -> "kg·m²"
export const prettyUnit = text => text.trim()
  .replace(/\^\(?(-?\d+)\)?/g, (_, n) => [...n].map(c => (c === '-' ? '⁻' : SUPS[c])).join(''))
  .replace(/[*⋅]/g, '·');

export function formatUnit(u) {
  if (!u) return '';
  const pow = e => (e === 1 ? '' : Number.isInteger(e) ? String(e).replace(/-/, '⁻').replace(/\d/g, d => SUPS[d]) : '^' + e);
  const pos = Object.entries(u).filter(([, e]) => e > 0), neg = Object.entries(u).filter(([, e]) => e < 0);
  const num = pos.map(([n, e]) => n + pow(e)).join('·') || (neg.length ? '1' : '');
  const den = neg.map(([n, e]) => n + pow(-e)).join('·');
  return den ? `${num}/${neg.length > 1 ? `(${den})` : den}` : num;
}

// Unit of a MathJSON expression; sym(name) gives a symbol's unit. null = can't tell (e.g. adding kg to m).
// Angles count as dimensionless when adding, so 1 + Cl/(πAR) with Cl in 1/deg is fine.
function unitOfJson(x, sym) {
  if (typeof x === 'number' || x == null) return {};
  if (typeof x === 'string') return sym(x) ?? {};
  if (!Array.isArray(x)) return {};
  const [head, ...args] = x, us = () => args.map(a => unitOfJson(a, sym));
  const num = a => { if (typeof a === 'number') return a; if (Array.isArray(a) && a[0] === 'Rational') return a[1] / a[2]; if (Array.isArray(a) && a[0] === 'Negate') return -num(a[1]); return null; };
  switch (head) {
    case 'Multiply': return us().reduce((a, b) => (a && b ? mulU(a, b) : null), {});
    case 'Divide': { const [a, b] = us(); return a && b ? mulU(a, b, -1) : null; }
    case 'Power': { const a = unitOfJson(args[0], sym), p = num(args[1]); return !a ? null : !Object.keys(a).length ? {} : p == null ? null : powU(a, p); }
    case 'Square': { const a = unitOfJson(args[0], sym); return a && powU(a, 2); }
    case 'Sqrt': { const a = unitOfJson(args[0], sym); return a && powU(a, 0.5); }
    case 'Root': { const a = unitOfJson(args[0], sym), n = num(args[1]); return a && n ? powU(a, 1 / n) : null; }
    case 'Add': case 'Subtract': {
      const all = us();
      if (all.some(u => !u)) return null;
      if (all.every(u => sameUnit(u, all[0]))) return all[0];
      const bare = all.map(noAngles);
      return bare.every(u => sameUnit(u, bare[0])) ? bare[0] : null;
    }
    case 'Negate': case 'Abs': case 'Delimiter': case 'Parentheses': case 'Plus': return unitOfJson(args[0], sym);
    case 'Rational': return {};
    default: return {}; // sin, ln, exp, constants...: no unit
  }
}

// ---------- partly known expressions ----------
// Work out every fully numeric part of a MathJSON expression, combining numbers in products and sums,
// and leave the unknowns alone: 2/3·c_r·(1+0.752+0.752²)/(1+0.752) -> 0.8818508374·c_r
const isNum = x => typeof x === 'number';
const hasSym = x => (typeof x === 'string' ? !['Pi', 'ExponentialE'].includes(x) : Array.isArray(x) && x.slice(1).some(hasSym));
const round10 = v => Number(v.toPrecision(10));
function fold(ce, x) {
  if (!Array.isArray(x)) return x;
  if (!hasSym(x)) { const v = toNumber(ce.box(x).N()); return v == null ? x : round10(v); }
  const [h, ...a] = x, args = a.map(y => fold(ce, y));
  if (h === 'Multiply' || h === 'Add') {
    const nums = args.filter(isNum);
    let rest = args.filter(y => !isNum(y));
    if (h === 'Add') {
      // like terms: 3y + 4y -> 7y
      const terms = new Map();
      for (const y of rest) {
        const [c, ...f] = Array.isArray(y) && y[0] === 'Multiply' && isNum(y[1]) ? [y[1], ...y.slice(2)] : [1, y];
        const key = JSON.stringify(f);
        terms.set(key, { c: (terms.get(key)?.c ?? 0) + c, f });
      }
      rest = [...terms.values()].filter(t => t.c !== 0).map(({ c, f }) => {
        const body = f.length === 1 ? f[0] : ['Multiply', ...f];
        return c === 1 ? body : ['Multiply', round10(c), ...f];
      });
    }
    const k = round10(h === 'Multiply' ? nums.reduce((p, n) => p * n, 1) : nums.reduce((p, n) => p + n, 0));
    const unit = h === 'Multiply' ? 1 : 0;
    if (h === 'Multiply' && k === 0) return 0;
    const out = k === unit ? rest : h === 'Multiply' ? [k, ...rest] : [...rest, k];
    return out.length === 1 ? out[0] : [h, ...out];
  }
  return [h, ...args];
}

// MathJSON -> LaTeX for the shapes fold produces; back maps placeholder symbols to the original LaTeX
function toLatex(ce, x, back, inner = false) {
  const t = y => toLatex(ce, y, back, true), wrap = y => (Array.isArray(y) && ['Add', 'Subtract'].includes(y[0]) ? `\\left(${t(y)}\\right)` : t(y));
  if (isNum(x)) { const s = formatNumber(x, null); return inner && x < 0 ? `\\left(${s}\\right)` : s; }
  if (typeof x === 'string') return back[x] ?? ({ Pi: '\\pi', ExponentialE: 'e' }[x] ?? x);
  const [h, ...a] = x;
  switch (h) {
    case 'Add': return a.map((y, i) => { const s = toLatex(ce, y, back); return i && !/^-/.test(s) ? '+' + s : s; }).join('');
    case 'Subtract': return `${t(a[0])}-${wrap(a[1])}`;
    case 'Negate': return `-${wrap(a[0])}`;
    case 'Multiply': return a.map((y, i) => (i === 0 && isNum(y) ? formatNumber(y, null) : wrap(y))).reduce((s, f, i) => s + (i && (/^[\d.]/.test(f) || /\d$/.test(s) && /^\d/.test(f)) ? '\\cdot ' : '') + f, '');
    case 'Divide': case 'Rational': return `\\frac{${toLatex(ce, a[0], back)}}{${toLatex(ce, a[1], back)}}`;
    case 'Power': return `${Array.isArray(a[0]) || (isNum(a[0]) && a[0] < 0) ? `\\left(${t(a[0])}\\right)` : t(a[0])}^{${toLatex(ce, a[1], back)}}`;
    case 'Sqrt': return `\\sqrt{${toLatex(ce, a[0], back)}}`;
    case 'Root': return `\\sqrt[${toLatex(ce, a[1], back)}]{${toLatex(ce, a[0], back)}}`;
    case 'Delimiter': return `\\left(${toLatex(ce, a[0], back)}\\right)`;
    default: {
      const s = ce.box(x, { canonical: false }).latex.replace(/\\,/g, '');
      return s.replace(/\\mathrm\{(qq[a-z]+)\}|\b(qq[a-z]+)\b/g, (m, p1, p2) => back[p1 ?? p2] ?? m);
    }
  }
}

// Root finder for f(x) = 0: scan for sign changes then bisect; secant fallback. Prefers positive, then smallest roots.
export function findRoot(f) {
  const g = x => { const y = f(x); return Number.isFinite(y) ? y : NaN; };
  const xs = [0];
  for (let k = -4; k <= 7; k += 0.1) xs.push(10 ** k, -(10 ** k));
  xs.sort((a, b) => a - b);
  const roots = [];
  let px = xs[0], py = g(px);
  for (const x of xs.slice(1)) {
    const y = g(x);
    if (py === 0) roots.push(px);
    else if (py * y < 0) {
      let a = px, b = x, fa = py;
      for (let k = 0; k < 200 && b - a > 1e-15 * Math.max(1, Math.abs(a)); k++) {
        const m = (a + b) / 2, fm = g(m);
        if (fa * fm <= 0) b = m; else { a = m; fa = fm; }
      }
      const r = (a + b) / 2;
      if (Math.abs(g(r)) < 1e-6 * Math.max(1, Math.abs(py), Math.abs(y))) roots.push(r); // reject poles
    }
    px = x; py = y;
  }
  if (!roots.length) {
    for (let x0 of [1, -1, 10, 0.1, 100]) {
      let x1 = x0 * 1.01 + 0.01;
      for (let k = 0; k < 100; k++) {
        const f0 = g(x0), f1 = g(x1);
        if (!Number.isFinite(f0) || !Number.isFinite(f1) || f1 === f0) break;
        [x0, x1] = [x1, x1 - f1 * (x1 - x0) / (f1 - f0)];
        if (Math.abs(x1 - x0) < 1e-12 * Math.max(1, Math.abs(x1))) break;
      }
      if (Math.abs(g(x1)) < 1e-9) { roots.push(x1); break; }
    }
  }
  if (!roots.length) return null;
  const pos = roots.filter(r => r > 0);
  const r = (pos.length ? pos : roots).sort((a, b) => Math.abs(a) - Math.abs(b))[0];
  return parseFloat(r.toPrecision(12)); // trim bisection noise
}

// drop \text{...} groups (units like "5\text{ kg}") so they don't affect calculations
function stripText(t) {
  const out = [];
  for (let i = 0; i < t.length;) {
    if (t[i] === '\\text') { i = groupEnd(t, i + 1); continue; }
    out.push(t[i++]);
  }
  return out;
}

const GREEK_WORD = new RegExp(`^(${[...GREEK].map(g => g.slice(1)).join('|')}|pi)$`);
const UNICODE_GREEK = { ϵ: 'epsilon', ϑ: 'theta', ϕ: 'phi', α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ι: 'iota', κ: 'kappa',
  λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
  Γ: 'Gamma', Δ: 'Delta', Θ: 'Theta', Λ: 'Lambda', Ξ: 'Xi', Π: 'Pi', Σ: 'Sigma', Φ: 'Phi', Ψ: 'Psi', Ω: 'Omega' };
const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉', SUP = { '⁰': 0, '¹': 1, '²': 2, '³': 3, '⁴': 4, '⁵': 5, '⁶': 6, '⁷': 7, '⁸': 8, '⁹': 9, '⁻': '-', '⁺': '+' };

// Word's linear format writes subscripts of subscripts as C_(l_(α_Wing)); turn those brackets into braces
function subBraces(s) {
  let out = '';
  const stack = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') { const sub = s[i - 1] === '_'; stack.push(sub); out += sub ? '{' : '('; }
    else if (s[i] === ')') out += stack.pop() ? '}' : ')';
    else out += s[i];
  }
  return out;
}

const symbolOnly = nameLatex => {
  const t = tokenize(nameLatex), { occ } = scan(t);
  return occ.length === 1 && occ[0].start === 0 && occ[0].end === t.length ? { nameLatex, key: occ[0].name } : null;
};

// "v0", "C_L", "CL", "AR_wing", "ρ", "theta", "C_(l_(α_Wing))", "(∂ε)/(∂α)" -> { nameLatex, key },
// or null if it doesn't look like a symbol (e.g. a description)
export function varName(cell) {
  // NFKC turns Word's maths letters (𝜕 𝜀 𝛼 𝑚 ⅆ) into plain ones (∂ ε α m d); drop invisible formatting characters
  let s = cell.normalize('NFKC').replace(/[\u2061-\u2064\u200B-\u200D\uFEFF]/g, '').replace(/[∕⁄]/g, '/')
    .trim().replace(/^\$|\$$/g, '').replace(/\s+/g, '');
  const d = s.match(/^\(?([∂d])(.+?)\)?\/\(?\1(.+?)\)?$/);
  if (d) {
    const a = varName(d[2]), b = varName(d[3]), op = d[1] === '∂' ? '\\partial ' : 'd';
    return a && b ? symbolOnly(`\\frac{${op}${a.nameLatex}}{${op}${b.nameLatex}}`) : null;
  }
  s = subBraces(s)
    .replace(/[α-ωΓ-Ωϵϑϕ]/g, c => UNICODE_GREEK[c] ? '\\' + (c === 'ε' ? 'varepsilon' : UNICODE_GREEK[c]) + ' ' : c)
    .replace(/[₀-₉]+/g, n => '_' + [...n].map(c => SUB_DIGITS.indexOf(c)).join(''))
    .replace(/ (?=[_}]|$)/g, '')
    .replace(/_([A-Za-z0-9]{2,})/g, '_{$1}'); // α_Wing -> α_{Wing} so the whole word is lowered
  const m = s.match(/^(\\[A-Za-z]+ ?|[A-Za-z]+?)(?:_?(\d+)|_\{(.+)\}|_([A-Za-z0-9\\ ]+))?$/);
  if (!m || /[^A-Za-z0-9\\_{} ]/.test(s)) return null;
  let base = m[1].trim(), sub = m[2] ?? m[3] ?? m[4];
  if (/^[A-Za-z]+$/.test(base) && GREEK_WORD.test(base)) base = '\\' + base;
  else if (/^[A-Za-z]{2,}$/.test(base)) {
    if (base.length > 3) return null; // longer words are descriptions, not symbols
    // "CL" -> C_L (aero style); with its own subscript keep it whole and upright: AR_wing -> \mathrm{AR}_{wing}
    if (sub) base = `\\mathrm{${base}}`; else [base, sub] = [base[0], base.slice(1)];
  }
  return symbolOnly(sub ? `${base}_{${sub.trim()}}` : base);
}

// "1,200", "−3.5", "1.2e-5", "1.2 × 10^-5", "2.5×10⁻³ kg" -> { number, latex, rest } (rest = trailing text, e.g. a unit)
export function varValue(cell) {
  const s = cell.trim().replace(/[−–]/g, '-').replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/[⁰-⁹⁻⁺¹²³]+/g, d => [...d].map(c => SUP[c]).join(''))
    .replace(/\s*[x×*]\s*10\s*\^?\s*\(?([-+]?\d+)\)?/, 'e$1');
  const m = s.match(/^(-?\d*\.?\d+)(?:[eE]([-+]?\d+))?\s*(.*)$/);
  if (!m) return null;
  return { number: Number(m[1] + (m[2] ? 'e' + m[2] : '')), latex: m[2] ? `${m[1]}\\times10^{${parseInt(m[2])}}` : m[1], rest: m[3] };
}

// Excel-style labels: "Temp (K)", "S wing (m^2)", "Sting Height h (m)" -> [label, unit in brackets]
function splitLabel(cell) {
  const m = cell.match(/^(.*?)\s*[([]([^()[\]]*)[)\]]\s*$/);
  return m ? [m[1], m[2]] : [cell, ''];
}

// A looser reading of a label that isn't a plain symbol: "Sting Height h" -> h, "S wing" -> S_{wing},
// "Temp" / "Pressure" -> \mathrm{Temp} (a multi-letter variable, typed as Temp in equations)
function looseName(label) {
  const words = label.normalize('NFKC').trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.some(w => !/^[A-Za-z0-9_α-ωΓ-Ω]+$/.test(w))) return null;
  const last = words.at(-1), first = varName(words[0]);
  if (words.length > 1 && !/^[A-Za-z]{2,}$/.test(last) && varName(last)) return varName(last);
  if (words.length > 1 && first && /^\\?[A-Za-z]+$/.test(first.nameLatex) && words.slice(1).every(w => /^[A-Za-z0-9]+$/.test(w)))
    return symbolOnly(`${first.nameLatex}_{${words.slice(1).join('')}}`);
  return words.every(w => /^[A-Za-z]+$/.test(w)) ? symbolOnly(`\\mathrm{${words.length > 1 ? words.map(w => w[0].toUpperCase() + w.slice(1)).join('') : words[0]}}`) : null;
}

// A label that is a product of symbols, e.g. "Q·S·c_bar": kept as an equation line (key null)
function productName(label) {
  const factors = label.normalize('NFKC').split(/\s*[·⋅*×]\s*/);
  const names = factors.length > 1 ? factors.map(f => varName(f) ?? looseName(f)) : [];
  return names.length && names.every(Boolean) ? { nameLatex: names.map(n => n.nameLatex).join('\\cdot '), key: null } : null;
}

function makeVar(nameCell, valueCell, unitCell = '') {
  let name = varName(nameCell), labelUnit = '';
  if (!name) { const [label, u] = splitLabel(nameCell); name = varName(label) ?? looseName(label) ?? productName(label); labelUnit = u; }
  const value = varValue(valueCell);
  if (!name) return null;
  if (!value) return { latex: `${name.nameLatex}=${valueCell.trim()}`, ...name, number: null }; // an expression
  const unit = (unitCell.trim() || value.rest || labelUnit).replace(/^[([]\s*|\s*[)\]]$/g, '').replace(/[{}\\]/g, '').trim();
  const sup = n => [...n].map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'[c] ?? (c === '-' ? '⁻' : '')).join('');
  const unitText = unit.replace(/\^\(?(-?\d+)\)?/g, (_, n) => sup(n)).replace(/[⋅*]/g, '·');
  const unitLatex = unit && unit !== '-' && unit !== '–' ? `\\text{ ${unitText}}` : '';
  return { latex: `${name.nameLatex}=${value.latex}${unitLatex}`, ...name, number: value.number, unit: unitLatex ? unitText : '' };
}

// "m = 5 kg", "v0: 3.2" -> { latex, nameLatex, key, number }
export function parseVarLine(line) {
  const m = line.trim().match(/^([^=:\t]+?)\s*(?:=|:|\t)\s*(.+)$/);
  return m ? makeVar(m[1], m[2]) : null;
}

// A table (rows of cells) with a symbol column, a value column and optionally a units column, in any
// order, with or without a header row; other columns (descriptions...) are ignored.
function parseTable(rows) {
  const width = Math.max(...rows.map(r => r.length));
  const col = i => rows.map(r => r[i] ?? '');
  const head = rows[0].some(c => /symbol|quantity|variable|name|param|value|unit/i.test(c)) && !rows[0].some(c => varValue(c)) ? rows[0] : null;
  const data = head ? rows.slice(1) : rows;
  const find = re => head ? head.findIndex(c => re.test(c)) : -1;
  const frac = (i, f) => data.filter(r => f(r[i] ?? '')).length / data.length;
  const cols = [...Array(width).keys()];
  let value = find(/value|magnitude|amount|number|\bval\b/i);
  if (value < 0) value = cols.reduce((b, i) => frac(i, varValue) > frac(b, varValue) ? i : b, 0);
  let name = [/symbol/i, /quantity|variable|param/i, /name/i].map(find).find(i => i >= 0 && i !== value) ?? -1;
  if (name < 0) name = cols.filter(i => i !== value).reduce((b, i) => b < 0 || frac(i, c => varName(c)) > frac(b, c => varName(c)) ? i : b, -1);
  let unit = find(/unit/i);
  if (unit < 0 && !head && value + 1 < width && value + 1 !== name && frac(value + 1, c => c.trim().length <= 12 && !varValue(c)) >= .5) unit = value + 1;
  const vars = [], skipped = [];
  for (const r of data) {
    const v = name >= 0 ? makeVar(r[name] ?? '', r[value] ?? '', unit >= 0 ? r[unit] ?? '' : '') : null;
    if (v && v.number != null) vars.push(v); else skipped.push(r.join('  '));
  }
  return { vars, skipped };
}

// The variable a line like "m=5\\text{ kg}" sets to a plain number, or null (used to update rather than repeat
// variables when a table is pasted again)
export function plainDefinition(latex) {
  const t = tokenize(latex), { occ } = scan(t), eq = t.indexOf('=');
  if (occ[0]?.start !== 0 || occ[0].end !== eq) return null;
  return /^-?[\d.]+(\\times ?10\^\{-?\d+\})?(\\text\{[^}]*\})?$/.test(join(t.slice(eq + 1))) ? occ[0].name : null;
}

// Pasted text -> { vars, skipped }. Handles "name = value" lines and tables from Excel/Word/web (tab separated)
// or Markdown (| separated).
export function parseVariables(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !/^\s*\|?[\s:|-]+\|?\s*$/.test(l));
  if (!lines.length) return { vars: [], skipped: [] };
  if (lines.every(l => l.includes('\t')) || lines.every(l => l.includes('|')))
    return parseTable(lines.map(l => (l.includes('\t') ? l.split('\t') : l.replace(/^\s*\||\|\s*$/g, '').split('|')).map(c => c.trim())));
  const parsed = lines.map(parseVarLine);
  return { vars: parsed.filter(Boolean), skipped: lines.filter((_, i) => !parsed[i]) };
}

// Walk the equations in document order. eqs: [{id, latex}]; dp: {name: places};
// initial: [{key, latex, value, unit}] variables known before the first line (universal constants);
// unitOverrides: {name: unit text} units chosen in the Variables pane, which win over worked-out ones.
// Returns { vars: Map name -> {value, latex, id, unit}, ghosts: {id: latex to append}, suggest: {name: [unit text]},
//   refill: {id: latex to keep} lines whose typed answer the app should keep live (ghost appended automatically) }
export function evaluateDocument(ce, eqs, dp, showWorking, initial = [], unitOverrides = {}) {
  const all = [...eqs, ...initial].map(e => e.latex).join(' ');
  MULTI = [...new Set([...all.matchAll(/\\(?:mathrm|operatorname)\{([A-Za-z]{2,})\}/g)].map(m => m[1]))].sort((a, b) => b.length - a.length);
  // a unit chosen in the Variables pane: converts the value when it can, otherwise just relabels
  const chosen = (name, value, unit, unitText) => {
    if (unitOverrides[name] == null) return { value, unit, unitText };
    if (!unitOverrides[name].trim()) return { value, unit: {}, unitText: undefined }; // unit deleted: no unit
    const to = parseUnit(unitOverrides[name]), v = Object.keys(unit).length ? convertValue(value, unit, to) : null;
    return { value: v ?? value, unit: to, unitText: prettyUnit(unitOverrides[name]) };
  };
  const hints = {}; // id -> Map(unknown latex -> similar known latex)
  const typedDp = {}; // name -> decimal places of a typed answer (the app keeps them as that variable's setting)
  const refill = {}; // id -> the part of a typed line to keep, with ghosts[id] put live after it
  const vars = new Map(initial.map(u => [u.key, { latex: u.latex, id: 'universal', ...chosen(u.key, u.value, parseUnit(u.unit)) }])), ghosts = {};
  // Values to put into a part of an equation. If the part mixes scales of the same kind of unit (mm with m,
  // kPa with Pa...), every variable goes in converted to base SI units so the numbers agree.
  const sameKind = (a, b) => { const [fa, da] = toSI({ [a]: 1 }), [fb, db] = toSI({ [b]: 1 }); return a !== b && sameUnit(da, db) && fa !== fb; };
  const mixed = t => {
    if (!t) return false;
    const names = Object.keys(Object.assign({}, ...scan(t).occ.map(o => vars.get(o.name)?.unit ?? {})));
    return names.some((a, i) => names.slice(i + 1).some(b => sameKind(a, b)));
  };
  const vals = t => {
    const si = mixed(t);
    return Object.fromEntries([...vars].map(([k, v]) => {
      if (!si) return [k, formatNumber(v.value, dp[k])];
      const [f] = toSI(v.unit ?? {});
      return [k, formatNumber(round10(v.value * f), null)];
    }));
  };
  // unitText: the unit as written (s⁻¹), shown instead of the worked-out form (1/s) when there is one
  // e is Euler's number (2.718281828459045, kept as e in the working) unless the document defines its own e
  const isKnown = name => vars.has(name) || name === 'e';
  const set = (name, latex, value, id, unit = {}, unitText) => {
    ({ value, unit, unitText } = chosen(name, value, unit, unitText));
    if (dp[name] != null) value = Number(value.toFixed(dp[name]));
    vars.set(name, { value, latex, id, unit, unitText });
  };
  // unit of a fully known part, from its variables' units; extra: { name: unit } for a probe unknown
  const unitOf = (t, extra = {}) => {
    const { occ } = scan(t), names = [...new Set(occ.map(o => o.name))];
    const ph = Object.fromEntries(names.map((n, i) => [n, `\\mathrm{qq${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + i % 26)}}`]));
    const back = Object.fromEntries(names.map(n => [ph[n].slice(8, -1), n]));
    const si = mixed(t), unitOfVar = n => (si ? toSI(vars.get(n)?.unit ?? {})[1] : vars.get(n)?.unit ?? {});
    try { return unitOfJson(ce.parse(join(substitute(t, occ, ph)), { canonical: false }).json, s => back[s] ? extra[back[s]] ?? unitOfVar(back[s]) : {}); } catch { return null; }
  };
  // Unit suggestions: wherever a variable appears in an equation, the unit that would make both sides match,
  // using the units known at that line (unknown ones count as no unit, so it's a closest fit). Most common first.
  const counts = {};
  const suggestFrom = parts => {
    parts = parts.filter(p => p.length);
    parts.forEach((P, i) => {
      const otherUnits = parts.filter((_, j) => j !== i).map(Q => unitOf(Q)).filter(u => u && Object.keys(u).length);
      if (!otherUnits.length) return;
      for (const name of new Set(scan(P).occ.map(o => o.name))) {
        const probe = unitOf(P, { [name]: { '#': 1 } }), p = probe?.['#'];
        if (!p) continue;
        const rest = Object.fromEntries(Object.entries(probe).filter(([n]) => n !== '#'));
        const text = formatUnit(powU(mulU(otherUnits[0], rest, -1), 1 / p));
        if (text) (counts[name] ??= {})[text] = (counts[name][text] ?? 0) + 1;
      }
    });
  };
  const withUnit = (num, u, text) => (text ? `${num}\\text{ ${text}}` : u && Object.keys(u).length ? `${num}\\text{ ${formatUnit(u)}}` : num);
  const evalTokens = (t, extra = {}) => {
    const { occ } = scan(t);
    if (occ.some(o => !(o.name in extra) && !isKnown(o.name))) return null;
    try { return toNumber(ce.parse(join(substitute(t, occ, { ...vals(t), ...extra }))).N()); } catch { return null; }
  };

  for (const { id, latex } of eqs) {
    let ghost = '';
    const typedUnit = latex.match(/\\text\{([^}]*)\}\s*$/)?.[1]; // "= 0.107 \text{ 1/deg}" at the end of the line
    const statements = splitTop(stripText(tokenize(latex)), SPLIT_STATEMENT);
    for (const [si, st] of statements.entries()) {
      ghost = '';
      const parts = splitTop(st, SPLIT_PART);
      if (parts.length < 2) continue;
      suggestFrom(parts);
      const scans = parts.map(scan);
      const unknownsIn = s => s.occ.filter(o => !isKnown(o.name));
      const p0 = scans[0].occ;
      const target = p0.length === 1 && p0[0].start === 0 && p0[0].end === parts[0].length ? p0[0] : null;
      const trailingEmpty = parts[parts.length - 1].length === 0;
      const rest = parts.map((p, i) => ({ p, s: scans[i] })).slice(1).filter(x => x.p.length);

      // "x = y/z = ..." or "y/z =" : value of the rightmost fully known part
      const known = [...rest].reverse().find(x => !unknownsIn(x.s).length);
      const last = rest[rest.length - 1];
      if (target && trailingEmpty && !rest.length) {
        const v = vars.get(target.name);
        if (v) ghost = withUnit(formatNumber(v.value, dp[target.name]), v.unit, v.unitText);
        continue;
      }
      // the line ends in a number you typed (x = ... = 0.1102): take the value and unit from the working, then
      // make that number live (if it matches) or at least add the unit after it
      const typedEnd = known && known === last && typedUnit == null && si === statements.length - 1 && PLAIN_NUMBER.test(join(last.p));
      const working = typedEnd && [...rest].reverse().find(x => x !== last && x.s.occ.length && !unknownsIn(x.s).length);
      if (target && working) {
        const computed = evalTokens(working.p), typed = evalTokens(last.p);
        if (computed != null && typed != null) {
          const matches = Math.abs(typed - computed) <= 0.005 * Math.abs(computed) + 1e-12;
          set(target.name, target.latex, matches ? computed : typed, id, unitOf(working.p) ?? {});
          const V = vars.get(target.name);
          const places = join(last.p).match(/^-?\d*\.(\d+)$/)?.[1].length;
          if (matches && dp[target.name] == null && places != null) typedDp[target.name] = places; // keep the decimals you typed
          if (matches) { refill[id] = latex.slice(0, latex.lastIndexOf('=')); ghost = '=' + withUnit(formatNumber(V.value, dp[target.name]), V.unit, V.unitText); }
          else if (Object.keys(V.unit).length) { refill[id] = latex; ghost = `\\text{ ${V.unitText ?? formatUnit(V.unit)}}`; }
          continue;
        }
      }
      if (target && known) {
        const value = evalTokens(known.p);
        if (value != null) {
          // the unit comes from a known step that still has variables in it (a pure-number step has no units)
          const unitPart = [...rest].reverse().find(x => !unknownsIn(x.s).length && x.s.occ.length) ?? known;
          const unit = typedUnit != null && known === last && si === statements.length - 1 ? parseUnit(typedUnit) : unitOf(unitPart.p);
          set(target.name, target.latex, value, id, unit ?? {}, typedUnit != null && known === last && si === statements.length - 1 ? prettyUnit(typedUnit) : undefined);
          if (last && !unknownsIn(last.s).length && !PLAIN_NUMBER.test(join(last.p))) {
            const pre = trailingEmpty ? '' : '=';
            const V = vars.get(target.name), num = withUnit(formatNumber(V.value, dp[target.name]), V.unit, V.unitText);
            ghost = showWorking && last.s.occ.length ? `${pre}${join(substitute(last.p, last.s.occ, vals(last.p)))}=${num}` : pre + num;
          }
          continue;
        }
      }
      if (!target && trailingEmpty && parts.length === 2 && !unknownsIn(scans[0]).length) {
        const value = evalTokens(parts[0]);
        if (value != null) {
          const num = withUnit(formatNumber(value, null), unitOf(parts[0]));
          ghost = showWorking && scans[0].occ.length ? `${join(substitute(parts[0], scans[0].occ, vals(parts[0])))}=${num}` : num;
        }
        continue;
      }

      // an unknown that looks like a known variable (a typed instead of α, ...): say so
      const looks = n => n.replace(/var(epsilon|theta|phi)/g, '$1').replace(/alpha/g, 'a').replace(/[_{}\\]/g, '');
      for (const o of parts.flatMap((p, i) => unknownsIn(scans[i]))) {
        const near = [...vars.keys()].find(k => k !== o.name && looks(k) === looks(o.name));
        if (near) (hints[id] ??= new Map()).set(o.latex, vars.get(near).latex);
      }

      // "... =" with unknowns left: fill in what's known, work out what can be, leave the unknowns as they are
      const src = trailingEmpty && (rest.length ? rest.at(-1) : !target && parts.length === 2 ? { p: parts[0], s: scans[0] } : null);
      if (src && unknownsIn(src.s).length) {
        const names = [...new Set(src.s.occ.map(o => o.name))];
        const ph = {}, back = {};
        names.forEach((n, i) => {
          if (isKnown(n)) return;
          const p = 'qq' + String.fromCharCode(97 + Math.floor(i / 26)) + String.fromCharCode(97 + i % 26);
          ph[n] = `\\mathrm{${p}}`;
          back[p] = src.s.occ.find(o => o.name === n).latex;
        });
        try {
          const withNumbers = join(substitute(src.p, src.s.occ, vals(src.p)));
          const simplified = toLatex(ce, fold(ce, ce.parse(join(substitute(src.p, src.s.occ, { ...vals(src.p), ...ph })), { canonical: false }).json), back);
          const steps = [showWorking && src.s.occ.some(o => vars.has(o.name)) ? withNumbers : null, simplified]
            .filter((x, i, l) => x && x !== join(src.p) && x !== l[i - 1]);
          // only reordered (1+e^{-C} -> e^{-C}+1), nothing worked out: no suggestion
          const sameBits = (x, y) => tokenize(x).sort().join() === tokenize(y).sort().join();
          if (steps.length === 1 && sameBits(steps[0], join(src.p))) steps.pop();
          if (steps.length) ghost = steps.join('=');
        } catch {}
        continue;
      }

      // exactly one unknown: solve for it
      const names = new Set(scans.flatMap(unknownsIn).map(o => o.name));
      const nonEmpty = parts.map((p, i) => ({ p, s: scans[i] })).filter(x => x.p.length);
      if (names.size !== 1 || nonEmpty.length < 2) continue;
      const [u] = names;
      const uLatex = scans.flatMap(s => s.occ).find(o => o.name === u).latex;
      const a = nonEmpty.find(x => unknownsIn(x.s).length), b = nonEmpty.find(x => x !== a);
      const used = new Set(tokenize(latex));
      const ph = 'UVWXYZQRSTKLMN'.split('').find(c => !used.has(c) && !vars.has(c));
      let fa, fb;
      try {
        const mk = x => ce.parse(join(substitute(x.p, x.s.occ, { ...vals(x.p), [u]: ph })));
        fa = mk(a); fb = mk(b);
      } catch { continue; }
      const root = findRoot(x => {
        ce.assign(ph, x);
        const ya = toNumber(fa.N()), yb = toNumber(fb.N());
        return ya == null || yb == null ? NaN : ya - yb;
      });
      if (root == null) continue;
      // unit of the unknown: give it a probe unit, see what power p it ends up with on its side,
      // then unit = (other side / rest of its side)^(1/p)
      const probe = unitOf(a.p, { [u]: { '#': 1 } }), other = typedUnit != null && b === nonEmpty.at(-1) ? parseUnit(typedUnit) : unitOf(b.p);
      const p = probe?.['#'], unit = p && other ? powU(mulU(other, Object.fromEntries(Object.entries(probe).filter(([n]) => n !== '#')), -1), 1 / p) : {};
      set(u, uLatex, root, id, unit);
      ghost = `\\Rightarrow ${uLatex}=${withUnit(formatNumber(vars.get(u).value, dp[u]), vars.get(u).unit, vars.get(u).unitText)}`;
    }
    if (ghost) ghosts[id] = ghost;
  }
  const suggest = Object.fromEntries(Object.entries(counts).map(([n, c]) => [n, Object.keys(c).sort((a, b) => c[b] - c[a])]));
  return { vars, ghosts, suggest, refill, typedDp, hints: Object.fromEntries(Object.entries(hints).map(([k, m]) => [k, [...m]])) };
}
