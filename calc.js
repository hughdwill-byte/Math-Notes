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

// Finds variable occurrences in a token list. Returns { occ: [{start,end,name,latex}], bound: Set }
export function scan(t) {
  const occ = [], bound = new Set();
  const hasInt = t.some(tk => /^\\(int|iint|oint)$/.test(tk));
  for (let i = 0; i < t.length;) {
    const tk = t[i];
    if (OPAQUE.has(tk)) { i = groupEnd(t, i + 1); continue; }
    if ((tk === '\\sum' || tk === '\\prod') && t[i + 1] === '_') {
      const m = join(t.slice(i + 2, groupEnd(t, i + 2))).match(/^\{?([a-zA-Z])=/);
      if (m) bound.add(m[1]);
    }
    // differential "dx" inside an integral
    if (hasInt && tk === 'd' && /^[a-zA-Z]$/.test(t[i + 1] || '')) { bound.add(t[i + 1]); i += 2; continue; }
    if (/^[a-zA-Z]$/.test(tk) || GREEK.has(tk)) {
      let end = i + 1, name = tk.replace('\\', ''), latex = tk;
      if (t[end] === '_') {
        const ge = groupEnd(t, end + 1), sub = t.slice(end + 1, ge);
        const inner = sub[0] === '{' ? sub.slice(1, -1) : sub;
        name += '_' + join(inner).replace(/\\/g, '');
        latex += '_{' + join(inner) + '}';
        end = ge;
      }
      occ.push({ start: i, end, name, latex });
      i = end; continue;
    }
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

// Walk the equations in document order. eqs: [{id, latex}]; dp: {name: places}.
// Returns { vars: Map name -> {value, latex, id}, ghosts: {id: latex to append} }
export function evaluateDocument(ce, eqs, dp, showWorking) {
  const vars = new Map(), ghosts = {};
  const vals = () => Object.fromEntries([...vars].map(([k, v]) => [k, formatNumber(v.value, dp[k])]));
  const set = (name, latex, value, id) => {
    if (dp[name] != null) value = Number(value.toFixed(dp[name]));
    vars.set(name, { value, latex, id });
  };
  const evalTokens = (t, extra = {}) => {
    const { occ } = scan(t);
    if (occ.some(o => !(o.name in extra) && !vars.has(o.name))) return null;
    try { return toNumber(ce.parse(join(substitute(t, occ, { ...vals(), ...extra }))).N()); } catch { return null; }
  };

  for (const { id, latex } of eqs) {
    let ghost = '';
    for (const st of splitTop(tokenize(latex), SPLIT_STATEMENT)) {
      ghost = '';
      const parts = splitTop(st, SPLIT_PART);
      if (parts.length < 2) continue;
      const scans = parts.map(scan);
      const unknownsIn = s => s.occ.filter(o => !vars.has(o.name));
      const p0 = scans[0].occ;
      const target = p0.length === 1 && p0[0].start === 0 && p0[0].end === parts[0].length ? p0[0] : null;
      const trailingEmpty = parts[parts.length - 1].length === 0;
      const rest = parts.map((p, i) => ({ p, s: scans[i] })).slice(1).filter(x => x.p.length);

      // "x = y/z = ..." or "y/z =" : value of the rightmost fully known part
      const known = [...rest].reverse().find(x => !unknownsIn(x.s).length);
      const last = rest[rest.length - 1];
      if (target && trailingEmpty && !rest.length) {
        if (vars.has(target.name)) ghost = formatNumber(vars.get(target.name).value, dp[target.name]);
        continue;
      }
      if (target && known) {
        const value = evalTokens(known.p);
        if (value != null) {
          set(target.name, target.latex, value, id);
          if (last && !unknownsIn(last.s).length && !PLAIN_NUMBER.test(join(last.p))) {
            const pre = trailingEmpty ? '' : '=';
            const num = formatNumber(vars.get(target.name).value, dp[target.name]);
            ghost = showWorking && last.s.occ.length ? `${pre}${join(substitute(last.p, last.s.occ, vals()))}=${num}` : pre + num;
          }
          continue;
        }
      }
      if (!target && trailingEmpty && parts.length === 2 && !unknownsIn(scans[0]).length) {
        const value = evalTokens(parts[0]);
        if (value != null) {
          const num = formatNumber(value, null);
          ghost = showWorking && scans[0].occ.length ? `${join(substitute(parts[0], scans[0].occ, vals()))}=${num}` : num;
        }
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
        const mk = x => ce.parse(join(substitute(x.p, x.s.occ, { ...vals(), [u]: ph })));
        fa = mk(a); fb = mk(b);
      } catch { continue; }
      const root = findRoot(x => {
        ce.assign(ph, x);
        const ya = toNumber(fa.N()), yb = toNumber(fb.N());
        return ya == null || yb == null ? NaN : ya - yb;
      });
      if (root == null) continue;
      set(u, uLatex, root, id);
      ghost = `\\Rightarrow ${uLatex}=${formatNumber(vars.get(u).value, dp[u])}`;
    }
    if (ghost) ghosts[id] = ghost;
  }
  return { vars, ghosts };
}
