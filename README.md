# Math Notes

An equations-only notebook in a Word-style window, hosted on GitHub Pages.

- Every line is an equation. **Enter** starts the next one; just type: `/` makes a fraction, `^` a power, `_` a subscript, `sqrt`, `pi`, `\alpha`, etc.
- Like Word, a space or an operator (`=`, `+`, `-`, …) typed in a subscript or power takes you back to the main line: `C_M=C_L` stays `C_M = C_L`. Use brackets to keep operators in a power: `e^(x+1)`.
- **Ctrl+Enter** (or Home → New section) adds a section: a line with a heading under it. Enter after the heading goes straight to an equation.
- **Ctrl+Shift+Enter** (or Home → New label) adds a label: a smaller subheading for one equation or a group of equations. Ctrl+C on a label, or right-click → Copy labelled part, copies just that group.
- **Matrices** of any size: Home → New matrix… (or Symbols → Matrix → Custom size…). Inside a matrix, Enter adds a row; Home → Matrix (or right-click) adds/removes rows and columns.
- **Backspace** on an empty line deletes it; Home → Delete line deletes the current line.
- Variables are remembered top to bottom. Type `x=y/z` and a grey `= 10/2 = 5` appears; **Tab** fills it in. Filled-in numbers stay live: changing decimal places or an earlier value updates them on the page.
- Untick **Show working step** to go straight to the answer (`= 5`).
- An equation with exactly one unknown (e.g. `10=2b+x`) is solved for it.
- **Paste variables** (Home, or right-click a line): paste a table from Excel, Word or a web page (a symbol column, a value column and optionally a units column, in any order, header row optional, extra columns like descriptions ignored) or a list like `m = 5 kg` / `v0: 3.2`, one per line; symbols like `CL`, `ρ`, `v₀`, `AR_wing`, `C_(l_(α_Wing))` and `(∂ε)/(∂α)` (Word's equation text) and values like `1,200` or `2.1×10⁻³` are understood; multi-letter names like AR can be inserted by clicking them in the Variables pane; pasted variables go into a **Variables** section at the top (created if needed), and pasting a table again updates values that changed instead of repeating them. Pasting such a list straight into an equation (Ctrl+V) does the same. Units are kept on the page but ignored in the maths.
- **Universal constants** (g, G, c, k_B, N_A, ε₀, μ₀, mₑ, mₚ, qₑ) are known in every project, so `F=mg` fills in straight away. Writing `g=10` overrides it from that line down; ✕ in the Variables pane stops using one in this project; Edit changes the list for all projects.
- Decimal places per variable: the Variables pane dropdowns or the Increase/Decrease Decimal buttons.
- **Symbols panel** (left of the page): structures (fractions, roots, integrals, matrices…), Greek letters, calculus, arrows, sets and geometry symbols. Click to insert. View → Symbols shows/hides it.
- Copying for Word: **right-click any line → Copy section**, or click a section heading and press **Ctrl+C**, to copy that heading and its equations. Ctrl+C in an equation copies that equation; Home → Copy all copies everything. Equations paste into Word as real Word equations.
- **Projects** (File menu or folder button): create, name, rename, switch and delete separate projects; each saves automatically in the browser. **Ctrl+S** saves the project to a `.mathnotes` file: the first time you pick where, after that it overwrites the same file (Chrome/Edge; other browsers download a new copy each time). File → Save as… picks a new file; opening a project's file again updates that project instead of making a copy.

To publish: repo Settings → Pages → Deploy from a branch → pick this branch, folder `/ (root)`.
