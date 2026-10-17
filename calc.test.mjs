// Engine check: npm i @cortex-js/compute-engine@0.58.0 && node calc.test.mjs
import assert from 'node:assert';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { evaluateDocument, parseVarLine, parseVariables } from './calc.js';
const ce = new ComputeEngine();
const run = (ls, dp = {}, w = true) => evaluateDocument(ce, ls.map((latex, i) => ({ id: i, latex })), dp, w);
let r = run(['y=10', 'z=2', 'x=\\frac{y}{z}']);
assert.equal(r.vars.get('x').value, 5); assert.equal(r.ghosts[2], '=\\frac{10}{2}=5');
assert.equal(run(['y=10', 'z=2', 'x=\\frac{y}{z}'], {}, false).ghosts[2], '=5');
r = run(['y=10', 'z=2', 'x=\\frac{y}{z}=\\frac{10}{2}=5']); assert.equal(r.ghosts[2], undefined); assert.equal(r.vars.get('x').value, 5);
r = run(['a=3', '10=2b+a']); assert.ok(Math.abs(r.vars.get('b').value - 3.5) < 1e-9); assert.equal(r.ghosts[1], '\\Rightarrow b=3.5');
r = run(['x=2', 'x^{2}+v_{0}=13']); assert.ok(Math.abs(r.vars.get('v_0').value - 9) < 1e-9);
r = run(['t=\\sqrt{2}'], { t: 3 }); assert.equal(r.vars.get('t').value, 1.414); assert.equal(r.ghosts[0], '=1.414');
r = run(['m=2', 'm=']); assert.equal(r.ghosts[1], '2');
r = run(['m=-2', 'k=3m^{2}']); assert.equal(r.vars.get('k').value, 12); assert.equal(r.ghosts[1], '=3\\cdot\\left(-2\\right)^{2}=12');
r = run(['n=4', 's=\\sum_{i=1}^{n}i']); assert.equal(r.vars.get('s').value, 10);
r = run(['\\theta=\\frac{\\pi}{6}', 'F=10\\sin\\theta']); assert.ok(Math.abs(r.vars.get('F').value - 5) < 1e-9);
r = run(['p=3', 'q=4', 'p+q=']); assert.equal(r.ghosts[2], '3+4=7');
r = run(['x^{2}=16']); assert.equal(r.vars.get('x').value, 4);
r = run(['2^{w}=1024']); assert.ok(Math.abs(r.vars.get('w').value - 10) < 1e-9);
r = run(['E=mc^{2}']); assert.equal(r.vars.size, 0);
r = run(['g=9.81','h=20','\\sqrt{2gh}=v']); assert.ok(Math.abs(r.vars.get('v').value-19.809)<1e-3);
// pasted variable lines
assert.deepEqual(parseVarLine('m = 5 kg'), { latex: 'm=5\\text{ kg}', nameLatex: 'm', key: 'm', number: 5 });
assert.equal(parseVarLine('v0: 3.2').latex, 'v_{0}=3.2');
assert.equal(parseVarLine('theta\t30').latex, '\\theta=30');
assert.equal(parseVarLine('k_B = 1.380649e-23').latex, 'k_{B}=1.380649\\times10^{-23}');
assert.equal(parseVarLine('epsilon_0 = 8.85e-12').key, 'epsilon_0');
assert.equal(parseVarLine('mass = 5'), null);
assert.equal(parseVarLine('just text'), null);
// tables: header row, any column order, extra description column, units column
const eqs = t => parseVariables(t).vars.map(v => v.latex);
assert.deepEqual(eqs('Symbol\tValue\tUnits\nm\t1,200\tkg\nv0\t25\tm/s\nρ\t1.225\tkg/m^3'), ['m=1200\\text{ kg}', 'v_{0}=25\\text{ m/s}', '\\rho=1.225\\text{ kg/m^3}']);
assert.deepEqual(eqs('Description\tValue\tUnit\tSymbol\nMass of car\t1200\tkg\tm\nLift coefficient\t0.45\t-\tCL'), ['m=1200\\text{ kg}', 'C_{L}=0.45']);
assert.deepEqual(eqs('g\t9.81\tm/s²\nS\t16.2\t(m²)\nE\t2.1×10⁻³\tPa'), ['g=9.81\\text{ m/s²}', 'S=16.2\\text{ m²}', 'E=2.1\\times10^{-3}\\text{ Pa}']);
assert.deepEqual(eqs('| Name | Value | Units |\n|---|---|---|\n| h_0 | 0.25 | |\n| alpha | 5 | deg |'), ['h_{0}=0.25', '\\alpha=5\\text{ deg}']);
assert.deepEqual(eqs('m = 5 kg\nv0: 3\ntheta\t30'), ['m=5\\text{ kg}', 'v_{0}=3', '\\theta=30']); // mixed list
assert.deepEqual(parseVariables('Symbol\tValue\nm\t5\nTotal\tTBC').skipped, ['Total  TBC']);
// units are ignored in maths; universal constants are known from the start and can be overridden
r = run(['m=5\\text{ kg}', 'F=mg']);
assert.equal(r.vars.get('F'), undefined);
r = evaluateDocument(ce, [{ id: 0, latex: 'm=5\\text{ kg}' }, { id: 1, latex: 'F=mg' }, { id: 2, latex: 'g=10' }, { id: 3, latex: 'W=mg' }], {}, true, [{ key: 'g', latex: 'g', value: 9.81 }]);
assert.ok(Math.abs(r.vars.get('F').value - 49.05) < 1e-9); assert.equal(r.ghosts[1], '=5\\cdot 9.81=49.05');
assert.equal(r.vars.get('W').value, 50);
console.log('ok');
