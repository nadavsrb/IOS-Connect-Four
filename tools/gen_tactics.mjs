// Tactics generator (dev-only; run: `node tools/gen_tactics.mjs`). Emits js/tactics.js.
//
// The lessons are written here by hand; the *positions* are not. Each tactic has a
// cheap structural pattern (does this move make two open threats? does it stack
// two winning squares in one column?) and every candidate that matches is then
// handed to the exact solver, which has to agree that the tactical move is the
// only move that works. So a drill can never teach a move that doesn't actually
// win — tools/test_tactics.mjs re-checks all of it from scratch.
//
// Prose lives on the tactic, positions live on the drills, and the lesson pages
// reference the drills ('drill0', 'drill0after') so the board the teacher points
// at is always a real, legal, verified position.
import {
  P1, P2, ROWS, COLS, EMPTY,
  createBoard, cloneBoard, dropDisc, checkWin, legalMoves, landingRow, winningSquares, other,
} from '../js/engine.js';
import { solveBoard } from '../js/solver.js';
import { writeFileSync } from 'node:fs';

const BUDGET = 120_000_000; // offline: slow is fine, an abort just skips the candidate
const solve = (b, p) => solveBoard(b, p, { budget: BUDGET });

const gridStr = (b) => { let s = ''; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) s += String(b[r][c]); return s; };
const discCount = (b) => gridStr(b).split('').filter((c) => c !== '0').length;
const playableNow = (b, r, c) => landingRow(b, c) === r;
const openThreats = (b, p) => winningSquares(b, p).filter(([r, c]) => playableNow(b, r, c));
const afterDrop = (b, col, p) => { const child = cloneBoard(b); const l = dropDisc(child, col, p); return l ? { child, ...l } : null; };
const winsNow = (b, col, p) => { const d = afterDrop(b, col, p); return !!(d && checkWin(d.child, d.row, d.col)); };
const colsWinningNow = (b, p) => legalMoves(b).filter((c) => winsNow(b, c, p));

const EMPTY_GRID = '0'.repeat(ROWS * COLS);
const decode = (grid) => {
  const b = createBoard();
  for (let i = 0; i < grid.length; i++) { const v = Number(grid[i]); if (v) b[Math.floor(i / COLS)][i % COLS] = v; }
  return b;
};

// Threats that exist in `after` but not in `before` — i.e. what the move built.
function newSquares(before, after, p) {
  const had = new Set(winningSquares(before, p).map(([r, c]) => `${r},${c}`));
  return winningSquares(after, p).filter(([r, c]) => !had.has(`${r},${c}`));
}

// --- The solver's verdict on every legal move, from P1's point of view. -------
// score > 0 → that move wins with perfect play, 0 → draws, < 0 → loses.
// null when any child blew the node budget: an unverifiable candidate is dropped.
function analyse(b) {
  const per = new Map();
  for (const c of legalMoves(b)) {
    const d = afterDrop(b, c, P1);
    if (checkWin(d.child, d.row, d.col)) { per.set(c, 99); continue; }
    const r = solve(d.child, P2);
    if (!r) return null;
    per.set(c, -r.score); // the solver scored it for P2; flip to P1's view
  }
  return per;
}

const colsWhere = (per, fn) => [...per.entries()].filter(([, v]) => fn(v)).map(([c]) => c).sort((a, b) => a - b);
const sameSet = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

// Threat directions created by the disc at (r, c): which lines through it are one
// square short of four. Vertical is excluded — a "seven" is about a row meeting a
// diagonal, and a stacked vertical threat is its own tactic.
const DIRS = { row: [0, 1], diagUp: [-1, 1], diagDown: [1, 1] };
function threatDirs(b, p, r, c) {
  const found = new Set();
  for (const [name, [dr, dc]] of Object.entries(DIRS)) {
    for (let s = -3; s <= 0; s++) {
      let mine = 0;
      let empty = 0;
      let ok = true;
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * (s + k);
        const cc = c + dc * (s + k);
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { ok = false; break; }
        if (b[rr][cc] === p) mine++;
        else if (b[rr][cc] === EMPTY) empty++;
        else { ok = false; break; }
      }
      // The window must contain (r, c) by construction of s, so 3 mine + 1 empty
      // is exactly "this disc is part of a line that needs one more square".
      if (ok && mine === 3 && empty === 1) found.add(name);
    }
  }
  return found;
}

// A random legal, non-terminal position with P1 to move and an even disc count in
// [lo, hi] — so P1 is also the player who opened, which is what the parity lesson
// depends on.
function randomPosition(lo, hi) {
  const b = createBoard();
  let cur = P1;
  const target = lo + 2 * Math.floor(Math.random() * (Math.floor((hi - lo) / 2) + 1));
  for (let i = 0; i < target; i++) {
    const moves = legalMoves(b);
    if (!moves.length) return null;
    const l = dropDisc(b, moves[Math.floor(Math.random() * moves.length)], cur);
    if (checkWin(b, l.row, l.col)) return null; // already decided — unusable
    cur = other(cur);
  }
  return legalMoves(b).length ? b : null;
}

// ---------------------------------------------------------------- the curriculum
// `match(b)` is the cheap structural test: it runs on every random candidate and
// returns { good, marks?, preMarks? } or null. `verify(b, m, per)` is the exact
// one: the solver has to confirm the lesson's move is the only move that works.
// `mode` picks the sentence the drill's failure message uses.

const uniqueWin = (good) => (b, m, per) => sameSet(colsWhere(per, (v) => v > 0), good);
const uniqueSafe = (good) => (b, m, per) => sameSet(colsWhere(per, (v) => v >= 0), good);

const SPECS = [
  {
    id: 'centre',
    name: 'Own the center',
    idea: 'The middle column sits on more fours than any other square on the board.',
    ask: 'Only one column keeps your win. Which?',
    why: 'The middle. Every line you want runs through it.',
    nudge: 'That hands the game back. Where do the most fours meet?',
    close: 'That is the middle. Take it early and your fours are already half-built.',
    range: [16, 26],
    lesson: [
      { say: 'Welcome. Geometry first. There are 69 ways to make four here. 51 of them run through the middle column.', board: 'empty', cols: [3] },
      { say: 'The edges barely matter — 15 each. These two middle squares sit on 13 fours apiece. A corner sits on 3.', board: 'empty', marks: [[2, 3], [3, 3]] },
      { say: 'So the middle decides games. Open there and you win. Open on the edge and you lose. Here, only the center holds it.', board: 'drill0' },
    ],
    // Keep the centre column open enough that the lesson's point is visible, and
    // never set a position where the centre simply completes a four — that drill
    // would be about spotting a win, not about the middle of the board.
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      let inCentre = 0;
      for (let r = 0; r < ROWS; r++) if (b[r][3] !== EMPTY) inCentre++;
      if (inCentre > 3) return null;
      if (landingRow(b, 3) < 0) return null;
      return { good: [3] };
    },
    verify: (b, m, per) => uniqueWin([3])(b, m, per),
  },

  {
    id: 'fork',
    name: 'Two threats at once',
    idea: 'One threat gets blocked. Two open threats in one move cannot both be stopped.',
    ask: 'Find the move that makes two threats at once.',
    why: 'Two open winning squares. They block one. You take the other.',
    nudge: 'That makes one threat at most. They simply block it.',
    close: 'The fork is the engine of this game. Every other idea is a way to build one.',
    range: [14, 26],
    lesson: [
      { say: 'A threat is an empty square that would give you four. One threat is polite. They just fill it.', board: 'drill0' },
      { say: 'Two at once is a fork. They answer one. You take the other. That is how games are really won.', board: 'drill0after' },
      { say: 'Your turn. One move here makes two.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null; // don't set a "find the win" drill
      const forks = [];
      let after = null;
      for (const c of legalMoves(b)) {
        const d = afterDrop(b, c, P1);
        const open = openThreats(d.child, P1);
        if (open.length >= 2) { forks.push(c); after = open; }
      }
      if (forks.length !== 1) return null;
      return { good: forks, after };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },

  {
    id: 'seven',
    name: 'The seven',
    idea: 'One disc finishing two lines — three along a row, three down a diagonal.',
    ask: 'One move builds a row and a diagonal. Find it.',
    why: 'A row and a diagonal from one disc. That is the seven.',
    nudge: 'That points one way only. Find the disc that finishes two lines.',
    close: 'Look for sevens in your own games. Once you know the shape, you see it everywhere.',
    range: [14, 26],
    lesson: [
      { say: 'The best disc belongs to two lines at once. Three along a row, three down a diagonal. The shape looks like a 7.', board: 'drill0' },
      { say: 'Look what it asks for. One square for the row. A different one for the diagonal. Two lines, one disc.', board: 'drill0after' },
      { say: 'Now find it. One move here starts both lines.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      const sevens = [];
      for (const c of legalMoves(b)) {
        const d = afterDrop(b, c, P1);
        const dirs = threatDirs(d.child, P1, d.row, d.col);
        const diagonal = dirs.has('diagUp') || dirs.has('diagDown');
        if (dirs.has('row') && diagonal && winningSquares(d.child, P1).length >= 2) sevens.push(c);
      }
      if (sevens.length !== 1) return null;
      return { good: sevens };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },

  {
    id: 'tempo',
    name: 'Block and build',
    idea: 'A forced block need not be a wasted move. Block with a disc that threatens back.',
    ask: 'They have four next move. Deal with it.',
    why: 'Forced — but your block builds too. Now they must answer you.',
    nudge: 'They complete four next move. Everything but that block loses.',
    close: 'Never block emptily. A block that threatens back is an attack.',
    range: [14, 26],
    lesson: [
      { say: 'Now the other side. They are one move from four. The square they need is marked. It has to be yours.', board: 'drill0', markOpp: 'open' },
      { say: 'But a forced move can still build. This block makes a three of your own. Now they must answer you.', board: 'drill0after' },
      { say: 'Block it. Then look at what your disc did on the way.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      const theirs = openThreats(b, P2);
      if (theirs.length !== 1) return null;
      const col = theirs[0][1];
      const d = afterDrop(b, col, P1);
      if (!d) return null;
      // The block has to *build* — a threat that was already there proves nothing
      // about tempo.
      const built = newSquares(b, d.child, P1);
      if (!built.length) return null;
      return { good: [col], after: built };
    },
    verify: (b, m, per) => uniqueSafe(m.good)(b, m, per),
  },

  {
    id: 'poison',
    name: 'Poisoned squares',
    idea: 'A disc under one of their winning squares lifts them straight onto it.',
    ask: 'Most of these columns hand them the win. Find the one that does not.',
    why: 'Safe. The others lift them onto four, or lose a step later.',
    nudge: 'Look above each landing square. Your disc under their win hands it to them.',
    close: 'Before every drop, ask what square you are handing over. Two seconds. Whole games.',
    // Fuller boards: the lesson needs several of their winning squares sitting
    // one row above a landing square, which only happens when the board is deep.
    range: [24, 36],
    lesson: [
      { say: 'Find their winning squares first. The empty ones that would give them four. These.', board: 'drill0', markOpp: 'all' },
      { say: 'Now look underneath. Your disc lifts them onto the square above. Every marked column is poisoned.', board: 'drill0', markPoison: true },
      { say: 'Most of this board is a trap. One move keeps you alive. Only one.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      if (openThreats(b, P2).length) return null; // nothing forced yet: the danger is your own doing
      const legal = legalMoves(b);
      if (legal.length < 3) return null;
      const poisoned = [];
      const safe = [];
      for (const c of legal) {
        const d = afterDrop(b, c, P1);
        (colsWinningNow(d.child, P2).length ? poisoned : safe).push(c);
      }
      if (poisoned.length < 2 || !safe.length) return null;
      return { good: [], poison: poisoned };
    },
    // The answer is whatever the solver says survives — and it has to be one of
    // the columns that isn't poisoned, or the lesson isn't what saved you.
    verify(b, m, per) {
      const survives = colsWhere(per, (v) => v >= 0);
      if (survives.length !== 1 || m.poison.includes(survives[0])) return false;
      m.good = survives;
      return true;
    },
  },

  {
    id: 'stack',
    name: 'Stack your threats',
    idea: 'Two of your winning squares in one column, one directly above the other.',
    ask: 'Put two of your winning squares in one column, one above the other.',
    why: 'Stacked. Block the low one and their own disc carries you to the high one.',
    nudge: 'Not that. Find the column where your threats can sit on top of each other.',
    close: 'Two threats in one column, and their own move loses it. Nothing here is prettier.',
    range: [14, 26],
    lesson: [
      { say: 'The prettiest idea in the game. Two of your winning squares in one column, one directly above the other.', board: 'drill0' },
      { say: 'They cannot block the low one without playing it. That lifts you to the high one. Block below, lose above.', board: 'drill0after' },
      { say: 'Find the move that stacks them.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      const found = [];
      let after = null;
      for (const c of legalMoves(b)) {
        const d = afterDrop(b, c, P1);
        if (openThreats(d.child, P1).length >= 2) continue; // that's the fork lesson, not this one
        const squares = winningSquares(d.child, P1);
        const fresh = new Set(newSquares(b, d.child, P1).map(([r, cc]) => `${r},${cc}`));
        // The pair has to be one the move just built, or the drill teaches nothing.
        const pair = squares.find(([r, cc]) =>
          playableNow(d.child, r, cc) && r > 0 &&
          squares.some(([r2, c2]) => c2 === cc && r2 === r - 1) &&
          (fresh.has(`${r},${cc}`) || fresh.has(`${r - 1},${cc}`)));
        if (pair) { found.push(c); after = [[pair[0] - 1, pair[1]], pair]; }
      }
      if (found.length !== 1) return null;
      return { good: found, after };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },

  {
    id: 'parity',
    name: 'Odd rows are yours',
    idea: 'Rows fill in order, so a threat on the right row is the one that gets collected.',
    ask: 'Two moves look alike. Only one lands on your row. Find it.',
    why: 'That one. Your winning square is on an odd row, so it falls to you.',
    nudge: 'Wrong row. They get to fill that square, not you.',
    close: 'Counting rows is dull, and it wins games. Start counting around move ten.',
    range: [14, 26],
    lesson: [
      { say: 'Count the rows from the bottom: 1 to 6. Discs fill them in order. The board holds 42 squares — an even number.', board: 'empty', rows: [5, 3, 1] },
      { say: 'So the rows split between you. You moved first, so the odd rows tend to fall to you. The even rows fall to them.', board: 'empty', rows: [5, 3, 1] },
      { say: 'Here two moves look alike. Only one puts your threat on your row. Count. Do not guess.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      const before = winningSquares(b, P1).length;
      let odd = null;
      let evenDecoy = false;
      for (const c of legalMoves(b)) {
        const d = afterDrop(b, c, P1);
        const squares = winningSquares(d.child, P1);
        if (squares.length <= before) continue; // this move created nothing
        if (openThreats(d.child, P1).length) continue; // immediate threats make it a fork, not parity
        // Board row indices are top-down, so an odd index is an odd row counted
        // from the bottom (index 5 = row 1, index 3 = row 3, index 1 = row 5).
        if (squares.every(([r]) => r % 2 === 1)) { if (odd !== null) return null; odd = c; }
        else if (squares.some(([r]) => r % 2 === 0)) evenDecoy = true;
      }
      if (odd === null || !evenDecoy) return null;
      return { good: [odd] };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },

  {
    id: 'defuse',
    name: 'Kill the fork early',
    idea: 'Everything you have learned, they can use. Take the double threat away a move early.',
    ask: 'They are one move from a double threat. Take it away.',
    why: 'Defused. The square their fork needed is yours.',
    nudge: 'Too slow. They fork you, and two open threats cannot both be blocked.',
    close: 'That is the craft: build your fork, and see theirs coming. Go and play.',
    range: [14, 26],
    lesson: [
      { say: 'Last idea, and it keeps you alive. Everything I taught you, they can play too. So ask what their next move does.', board: 'drill0' },
      { say: 'If they reach the marked column they fork you. You know how that ends. It is their move to lose.', board: 'drill0', markFork: true },
      { say: 'Take it away from them.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      if (openThreats(b, P2).length) return null; // no immediate four to block — the danger is a move away
      const forkCols = legalMoves(b).filter((c) => {
        const d = afterDrop(b, c, P2);
        return openThreats(d.child, P2).length >= 2;
      });
      if (!forkCols.length) return null;
      // Which of our moves leaves them with no fork at all?
      const clean = legalMoves(b).filter((c) => {
        const d = afterDrop(b, c, P1);
        if (colsWinningNow(d.child, P2).length) return false;
        return !legalMoves(d.child).some((x) => {
          const e = afterDrop(d.child, x, P2);
          return openThreats(e.child, P2).length >= 2;
        });
      });
      if (clean.length !== 1) return null;
      return { good: clean, fork: forkCols };
    },
    verify: (b, m, per) => uniqueSafe(m.good)(b, m, per),
  },
];

// ---------------------------------------------------------------- search
const DRILLS_PER_TACTIC = Number(process.env.TACTIC_DRILLS || 3);
const SECONDS_PER_TACTIC = Number(process.env.TACTIC_SECONDS || 240);

// After the key move, does every legal reply leave us an immediate four? When
// that holds the drill can be played out — you make the move, they defend, you
// finish it — which is the only way to *show* that a fork really is unstoppable.
function forcedFinish(b, col) {
  const d = afterDrop(b, col, P1);
  if (!d) return false;
  const replies = legalMoves(d.child);
  if (!replies.length) return false;
  return replies.every((x) => {
    const e = afterDrop(d.child, x, P2);
    if (checkWin(e.child, e.row, e.col)) return false; // they win first — not a finish at all
    return colsWinningNow(e.child, P1).length > 0;
  });
}

// TACTIC_ONLY=poison,stack limits the run while tuning a single pattern.
const only = (process.env.TACTIC_ONLY || '').split(',').filter(Boolean);

// TACTIC_REUSE=1 keeps the positions already committed in js/tactics.js and only
// re-emits the file — so editing a lesson's wording doesn't churn every drill (or
// cost another search). The reused positions still go through match + verify, so a
// prose-only run re-proves the whole curriculum on the way through.
const reuse = process.env.TACTIC_REUSE === '1';
let committed = new Map();
if (reuse) {
  try {
    const mod = await import('../js/tactics.js');
    committed = new Map(mod.TACTICS.map((t) => [t.id, t.drills.map((d) => d.grid)]));
  } catch { /* no committed set yet — fall through to a full search */ }
}

// Re-derive a drill from a grid: the pattern has to still match and the solver
// has to still agree, or the position is dropped and searched for afresh.
function rebuild(spec, grid) {
  const b = decode(grid);
  const m = spec.match(b);
  if (!m) return null;
  const per = analyse(b);
  if (!per || !spec.verify(b, m, per)) return null;
  return makeDrill(b, grid, m, per);
}

// The squares the teacher lights up once you have played the move: whatever the
// pattern itself recorded (a fork's two open threats, a stack's pair) or, failing
// that, simply what the move built. Computed here so the app never has to guess
// which of the position's threats the lesson was about.
function makeDrill(b, grid, m, per) {
  const child = afterDrop(b, m.good[0], P1).child;
  // The solver's verdict on every column, from your side: > 0 wins, 0 draws,
  // < 0 loses, null = the column is full. The app judges what you actually
  // played against this instead of only accepting the one column it was going
  // to suggest — a move that comes to the same thing is not a mistake.
  const values = [];
  for (let c = 0; c < COLS; c++) values.push(per.has(c) ? per.get(c) : null);
  return {
    grid,
    good: m.good,
    follow: m.good.length === 1 && forcedFinish(b, m.good[0]),
    show: m.after || newSquares(b, child, P1),
    values,
    poison: m.poison || null,
    fork: m.fork || null,
    discs: discCount(b),
  };
}

const results = [];
for (const spec of SPECS) {
  if (only.length && !only.includes(spec.id)) continue;
  const drills = [];
  const seen = new Set();
  const t0 = Date.now();
  let tried = 0;
  for (const grid of committed.get(spec.id) || []) {
    if (drills.length >= DRILLS_PER_TACTIC) break;
    const kept = rebuild(spec, grid);
    if (kept) { drills.push(kept); seen.add(grid); }
    else console.error(`${spec.id}: committed position no longer verifies — searching for a replacement`);
  }
  if (drills.length) console.error(`${spec.id}: reused ${drills.length} committed position(s)`);
  while (drills.length < DRILLS_PER_TACTIC && Date.now() - t0 < SECONDS_PER_TACTIC * 1000) {
    tried++;
    const b = randomPosition(spec.range[0], spec.range[1]);
    if (!b) continue;
    const key = gridStr(b);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = spec.match(b);
    if (!m) continue;
    const per = analyse(b);
    if (!per) continue;
    if (!spec.verify(b, m, per)) continue;
    drills.push(makeDrill(b, key, m, per));
    console.error(`${spec.id}: ${drills.length}/${DRILLS_PER_TACTIC} (tried ${tried}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (!drills.length) {
    console.error(`\nFAILED: no drill found for '${spec.id}' in ${SECONDS_PER_TACTIC}s (tried ${tried})`);
    process.exit(1);
  }
  drills.sort((a, b2) => b2.discs - a.discs); // fuller board first: tighter, easier to read
  results.push({ spec, drills });
}

// ---------------------------------------------------------------- lesson pages
// Resolve a page's `board:` reference into a concrete grid plus whatever the page
// asked to be lit up. Marks are computed from the position, never hand-listed, so
// the teacher can only ever point at squares that really are threats.
function buildPage(page, drill) {
  const out = { say: page.say };
  const b0 = decode(drill.grid);
  let board = b0;
  if (page.board === 'empty') board = createBoard();
  else if (page.board === 'drill0after') {
    const d = afterDrop(b0, drill.good[0], P1);
    board = d.child;
  }
  out.grid = page.board === 'empty' ? EMPTY_GRID : gridStr(board);

  const marks = [];
  if (page.marks) marks.push(...page.marks);
  // Exactly the squares the tactic is about — the same ones the drill lights up
  // when you find the move, so the lesson and the practice agree.
  if (page.board === 'drill0after') marks.push(...drill.show);
  if (page.markOpp === 'open') marks.push(...winningSquares(b0, P2).filter(([r, c]) => playableNow(b0, r, c)));
  else if (page.markOpp === 'all') marks.push(...winningSquares(b0, P2));
  if (page.markFork && drill.fork) {
    for (const c of drill.fork) { const r = landingRow(b0, c); if (r >= 0) marks.push([r, c]); }
  }
  if (marks.length) out.marks = marks;
  if (page.cols) out.cols = page.cols;
  if (page.markPoison && drill.poison) out.cols = drill.poison;
  if (page.rows) out.rows = page.rows;
  return out;
}

// ---------------------------------------------------------------- emit
const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const arr = (a) => `[${a.join(', ')}]`;
const pairs = (a) => `[${a.map(([r, c]) => `[${r}, ${c}]`).join(', ')}]`;

const blocks = results.map(({ spec, drills }) => {
  const pages = spec.lesson.map((p) => {
    const built = buildPage(p, drills[0]);
    const bits = [`grid: ${q(built.grid)}`, `say: ${q(built.say)}`];
    if (built.marks) bits.push(`marks: ${pairs(built.marks)}`);
    if (built.cols) bits.push(`cols: ${arr(built.cols)}`);
    if (built.rows) bits.push(`rows: ${arr(built.rows)}`);
    return `      { ${bits.join(', ')} },`;
  }).join('\n');
  const rows = drills.map((d) =>
    `      { grid: ${q(d.grid)}, good: ${arr(d.good)}, follow: ${d.follow},\n` +
    `        show: ${pairs(d.show)}, values: [${d.values.map((v) => (v == null ? 'null' : v)).join(', ')}] },`).join('\n');
  return `  {
    id: ${q(spec.id)},
    name: ${q(spec.name)},
    idea: ${q(spec.idea)},
    ask: ${q(spec.ask)},
    why: ${q(spec.why)},
    nudge: ${q(spec.nudge)},
    close: ${q(spec.close)},
    lesson: [
${pages}
    ],
    drills: [
${rows}
    ],
  },`;
}).join('\n');

const out = `// AUTO-GENERATED by tools/gen_tactics.mjs — do not edit by hand.
//
// The Tactics curriculum: eight ideas a player can actually learn, each with a
// short lesson the teacher walks you through and drills to try it on.
//   lesson — the teacher's pages. Each carries the position to show ('grid', 42
//            chars, row-major top→bottom; '0' empty, '1' you/red, '2' them/yellow)
//            and optionally squares ('marks'), whole columns ('cols') or rows
//            ('rows') to light up while it is on screen.
//   close  — what the teacher says once you have finished all of its drills.
//   drills — positions where YOU are red and to move. 'good' is the move the
//            tactic is about, and the solver has confirmed it is the ONLY move
//            that works, so anything else is a real mistake. 'show' is what the
//            teacher lights up once you have played it — the very squares the
//            tactic is about. 'follow' marks the drills where every reply leaves
//            you an immediate four, so the app can let you play the win out.
//            'values' is the solver's verdict on every column from your side
//            (> 0 wins, 0 draws, < 0 loses, null = full), so the app can accept
//            any move that comes to the same thing as the one being taught.
// Every position here was generated and proven by the exact solver, and
// tools/test_tactics.mjs re-proves all of it from scratch.
export const TACTICS = [
${blocks}
];
`;

const total = results.reduce((n, r) => n + r.drills.length, 0);
if (only.length) {
  // A filtered run is for tuning one pattern; writing a partial curriculum over
  // the committed one would be destructive.
  console.error(`\nTACTIC_ONLY run — nothing written. ${results.length} tactics, ${total} drills:\n`);
  console.log(out);
} else {
  writeFileSync(new URL('../js/tactics.js', import.meta.url), out);
  console.error(`\nwrote js/tactics.js — ${results.length} tactics, ${total} drills`);
}
