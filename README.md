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
- **Paste variables** (Home, or right-click a line): paste a list like `m = 5 kg` / `v0: 3.2` / rows from Excel, one per line; each becomes an equation line usable below it. Pasting such a list straight into an equation (Ctrl+V) does the same. Units are kept on the page but ignored in the maths.
- **Universal constants** (g, G, c, k_B, N_A, ε₀, μ₀, mₑ, mₚ, qₑ) are known in every project, so `F=mg` fills in straight away. Writing `g=10` overrides it from that line down; ✕ in the Variables pane stops using one in this project; Edit changes the list for all projects.
- Decimal places per variable: the Variables pane dropdowns or the Increase/Decrease Decimal buttons.
- **Symbols panel** (left of the page): structures (fractions, roots, integrals, matrices…), Greek letters, calculus, arrows, sets and geometry symbols. Click to insert. View → Symbols shows/hides it.
- Copying for Word: **right-click any line → Copy section**, or click a section heading and press **Ctrl+C**, to copy that heading and its equations. Ctrl+C in an equation copies that equation; Home → Copy all copies everything. Equations paste into Word as real Word equations.
- **Projects** (File menu or folder button): create, name, rename, switch and delete separate projects; each saves automatically in the browser. Save/open a project as a `.mathnotes` file to move it between computers.

To publish: repo Settings → Pages → Deploy from a branch → pick this branch, folder `/ (root)`.
