// Engine check: npm i @cortex-js/compute-engine@0.58.0 && node calc.test.mjs
import assert from 'node:assert';
import { ComputeEngine } from '@cortex-js/compute-engine';
import { evaluateDocument, parseVarLine, parseVariables, plainDefinition } from './calc.js';
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
assert.deepEqual(parseVarLine('m = 5 kg'), { latex: 'm=5\\text{ kg}', nameLatex: 'm', key: 'm', number: 5, unit: 'kg' });
assert.equal(parseVarLine('v0: 3.2').latex, 'v_{0}=3.2');
assert.equal(parseVarLine('theta\t30').latex, '\\theta=30');
assert.equal(parseVarLine('k_B = 1.380649e-23').latex, 'k_{B}=1.380649\\times10^{-23}');
assert.equal(parseVarLine('epsilon_0 = 8.85e-12').key, 'epsilon_0');
assert.equal(parseVarLine('mass = 5').latex, '\\mathrm{mass}=5'); // whole words become multi-letter variables
assert.equal(parseVarLine('just text'), null);
// tables: header row, any column order, extra description column, units column
const eqs = t => parseVariables(t).vars.map(v => v.latex);
assert.deepEqual(eqs('Symbol\tValue\tUnits\nm\t1,200\tkg\nv0\t25\tm/s\nρ\t1.225\tkg/m^3'), ['m=1200\\text{ kg}', 'v_{0}=25\\text{ m/s}', '\\rho=1.225\\text{ kg/m³}']);
assert.deepEqual(eqs('Description\tValue\tUnit\tSymbol\nMass of car\t1200\tkg\tm\nLift coefficient\t0.45\t-\tCL'), ['m=1200\\text{ kg}', 'C_{L}=0.45']);
assert.deepEqual(eqs('g\t9.81\tm/s²\nS\t16.2\t(m²)\nE\t2.1×10⁻³\tPa'), ['g=9.81\\text{ m/s²}', 'S=16.2\\text{ m²}', 'E=2.1\\times10^{-3}\\text{ Pa}']);
assert.deepEqual(eqs('| Name | Value | Units |\n|---|---|---|\n| h_0 | 0.25 | |\n| alpha | 5 | deg |'), ['h_{0}=0.25', '\\alpha=5\\text{ deg}']);
assert.deepEqual(eqs('m = 5 kg\nv0: 3\ntheta\t30'), ['m=5\\text{ kg}', 'v_{0}=3', '\\theta=30']); // mixed list
// Word table with equation cells (copied as Word's linear format)
const word = 'QUANTITY\tVALUE\tUNITS\nC_(l_(α_Wing ) )\t0.108\t1/deg\nc_Root\t125\tmm\nAR_wing\t4.544\t\n(∂ε)/(∂α)\t0.606\t/rad\nη\t0.9\t\nS_wing\t0.05425\tm^2\nI_yy\t0.047\tkg⋅m^2';
assert.deepEqual(eqs(word), ['C_{l_{\\alpha_{Wing}}}=0.108\\text{ 1/deg}', 'c_{Root}=125\\text{ mm}', '\\mathrm{AR}_{wing}=4.544',
  '\\frac{\\partial \\varepsilon}{\\partial \\alpha}=0.606\\text{ /rad}', '\\eta=0.9', 'S_{wing}=0.05425\\text{ m²}', 'I_{yy}=0.047\\text{ kg·m²}']);
assert.deepEqual(parseVariables(word).skipped, []);
// Word's maths letters and invisible characters: 𝜕𝜀/𝜕𝛼 (mathematical italic), ϵ, function-application mark
for (const n of ['(𝜕𝜀)/(𝜕𝛼)', '(∂ϵ)/(∂α)', '(∂⁡ε)∕(∂α)', '𝜕𝜀/𝜕𝛼'])
  assert.equal(parseVariables(`QUANTITY\tVALUE\tUNITS\n${n}\t0.606\t/rad`).vars[0]?.key, 'partialepsilon/partialalpha', n);
assert.equal(parseVariables('Symbol\tValue\n𝑚\t5').vars[0].latex, 'm=5');
// lines that just set a variable to a number (so a re-paste updates them)
assert.equal(plainDefinition('m=1200\\text{ kg}'), 'm');
assert.equal(plainDefinition('E=2.1\\times10^{-3}\\text{ Pa}'), 'E');
assert.equal(plainDefinition('\\mathrm{AR}_{wing}=4.544'), 'AR_wing');
assert.equal(plainDefinition('x=\\frac{y}{z}'), null);
assert.equal(plainDefinition('10=2b'), null);
// pasted names match what you type in an equation
r = run(['\\mathrm{AR}_{wing}=4.5', 'C_{l_{\\alpha_{Wing}}}=0.1', '\\frac{\\partial\\varepsilon}{\\partial\\alpha}=0.6',
  'k=\\mathrm{AR}_{wing}\\cdot C_{l_{\\alpha_{Wing}}}\\left(1-\\frac{\\partial\\varepsilon}{\\partial\\alpha}\\right)']);
assert.ok(Math.abs(r.vars.get('k').value - 0.18) < 1e-9);
// AR typed as letters means the multi-letter variable AR once one exists; trailing = fills working and answer
r = run(['\\mathrm{AR}_{wing}=4.544', 'C_{l_{\\alpha_{Wing}}}=0.108',
  'C_{L_{\\alpha_{Wing}}}=\\frac{C_{l_{\\alpha_{Wing}}}}{1+\\frac{C_{l_{\\alpha_{Wing}}}}{\\left(\\pi AR_{wing}\\right)}}=']);
assert.equal(r.ghosts[2], '\\frac{0.108}{1+\\frac{0.108}{\\left(\\pi\\cdot 4.544\\right)}}=0.107189065');
assert.ok(Math.abs(r.vars.get('C_L_{alpha_{Wing}}').value - 0.107189065) < 1e-9);
assert.equal(run(['A=2', 'R=3', 'x=AR']).vars.get('x').value, 6); // without an AR variable it is still A times R
// units: carried by variables, combined through the maths, shown after the answer
r = run(['m=1200\\text{ kg}', 'v=25\\text{ m/s}', 'p=mv', 'E=\\frac{1}{2}mv^{2}', 't=10\\text{ s}', 'a=\\frac{v}{t}', 'x=m+v']);
assert.equal(r.ghosts[2], '=1200\\cdot 25=30000\\text{ kg·m/s}');
assert.equal(r.ghosts[3], '=\\frac{1}{2}\\cdot 1200\\cdot 25^{2}=375000\\text{ kg·m²/s²}');
assert.equal(r.ghosts[5], '=\\frac{25}{10}=2.5\\text{ m/s²}');
assert.equal(r.ghosts[6], '=1200+25=1225'); // kg + m/s: no sensible unit, so none shown
// angles count as dimensionless when adding: the lift-slope formula keeps 1/deg
r = run(['\\mathrm{AR}_{wing}=4.544', 'C_{l}=0.108\\text{ 1/deg}', 'C_{L}=\\frac{C_{l}}{1+\\frac{C_{l}}{\\left(\\pi AR_{wing}\\right)}}=']);
assert.equal(r.ghosts[2], '\\frac{0.108}{1+\\frac{0.108}{\\left(\\pi\\cdot 4.544\\right)}}=0.107189065\\text{ 1/deg}');
// an answer typed with a unit keeps it; a solved unknown gets its unit from the equation
r = run(['F=600\\text{ N}', 'm=1200\\text{ kg}', 'F=ma', 'q=5\\text{ mm}', 'w=q']);
assert.equal(r.ghosts[2], '\\Rightarrow a=0.5\\text{ N/kg}');
assert.equal(r.ghosts[4], '=5=5\\text{ mm}');
assert.equal(run(['Q=747.96\\text{ Pa}', 'c=0.1102\\text{ m}', 'Q\\cdot S\\cdot c=4.473\\text{ N·m}']).ghosts[2], '\\Rightarrow S=0.05426738951\\text{ N/Pa}');
// Excel: name with unit in brackets, value in the next column
const xl = 'Temp (K)\t290.15\r\nPressure (Pa)\t101690\r\nR (J/kg·K)\t287\r\nρ (kg/m^3)\t1.221\r\nu_0 (m/s)\t35\r\nS wing (m^2)\t0.05425\r\nλ\t0.752\r\nc_bar (m)\t0.1102\r\nQ·S·c_bar (N·m)\t4.473\r\nSting Height h (m)\t0.705\r\nM_S (N·m)\t3.27';
assert.deepEqual(eqs(xl), ['\\mathrm{Temp}=290.15\\text{ K}', '\\mathrm{Pressure}=101690\\text{ Pa}', 'R=287\\text{ J/kg·K}', '\\rho=1.221\\text{ kg/m³}',
  'u_{0}=35\\text{ m/s}', 'S_{wing}=0.05425\\text{ m²}', '\\lambda=0.752', 'c_{bar}=0.1102\\text{ m}', 'Q\\cdot S\\cdot c_{bar}=4.473\\text{ N·m}', 'h=0.705\\text{ m}', 'M_{S}=3.27\\text{ N·m}']);
assert.deepEqual(parseVariables(xl).skipped, []);
r = run(['\\mathrm{Pressure}=101690\\text{ Pa}', 'R=287\\text{ J/kg·K}', '\\mathrm{Temp}=290.15\\text{ K}', '\\rho=\\frac{Pressure}{RTemp}']);
assert.equal(r.ghosts[3], '=\\frac{101690}{287\\cdot 290.15}=1.22116339\\text{ Pa·kg/J}'); // typed words match; units combine
// partly known: fill in what's known, simplify, leave unknowns (when the line ends with =)
r = run(['\\lambda=0.752', '\\bar{c}=\\frac{2}{3}c_{r}\\frac{1+\\lambda+\\lambda^{2}}{1+\\lambda}=']);
assert.equal(r.ghosts[1], '\\frac{2}{3}c_{r}\\frac{1+0.752+0.752^{2}}{1+0.752}=0.8818508374c_{r}');
assert.equal(r.vars.get('c_bar'), undefined);
assert.equal(run(['g=9.81', 'v=\\sqrt{2gh}=']).ghosts[1], '\\sqrt{2\\cdot 9.81h}=\\sqrt{19.62h}');
assert.equal(run(['x=4y+3y-2+5=']).ghosts[0], '7y+3');
assert.equal(run(['x=4y=']).ghosts[0], undefined); // nothing to fill in
// c̄ is its own variable and matches c_bar from a table
r = run(['c_{bar}=0.1102\\text{ m}', 'w=2\\bar{c}']);
assert.equal(r.vars.get('w').value, 0.2204);
assert.deepEqual(parseVariables('Symbol\tValue\nm\t5\nTotal\tTBC').skipped, ['Total  TBC']);
// units are ignored in maths; universal constants are known from the start and can be overridden
r = run(['m=5\\text{ kg}', 'F=mg']);
assert.equal(r.vars.get('F'), undefined);
r = evaluateDocument(ce, [{ id: 0, latex: 'm=5\\text{ kg}' }, { id: 1, latex: 'F=mg' }, { id: 2, latex: 'g=10' }, { id: 3, latex: 'W=mg' }], {}, true, [{ key: 'g', latex: 'g', value: 9.81, unit: 'm/s^2' }]);
assert.ok(Math.abs(r.vars.get('F').value - 49.05) < 1e-9); assert.equal(r.ghosts[1], '=5\\cdot 9.81=49.05\\text{ kg·m/s²}');
assert.equal(r.vars.get('W').value, 50);
console.log('ok');
