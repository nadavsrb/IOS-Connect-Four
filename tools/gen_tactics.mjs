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
import {
  playableNow, openThreats, afterDrop, colsWinningNow, newSquares, threatDirs,
  forkCols, stackCols, sevenCols, poisonedCols, aboveCols, bestDefence, handsThemFour,
} from '../js/patterns.js';
import { solveBoard } from '../js/solver.js';
import { writeFileSync } from 'node:fs';

const BUDGET = 120_000_000; // offline: slow is fine, an abort just skips the candidate
const solve = (b, p) => solveBoard(b, p, { budget: BUDGET });

const gridStr = (b) => { let s = ''; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) s += String(b[r][c]); return s; };
const discCount = (b) => gridStr(b).split('').filter((c) => c !== '0').length;

const EMPTY_GRID = '0'.repeat(ROWS * COLS);
const decode = (grid) => {
  const b = createBoard();
  for (let i = 0; i < grid.length; i++) { const v = Number(grid[i]); if (v) b[Math.floor(i / COLS)][i % COLS] = v; }
  return b;
};

// Swap the colours of a position. Used by the Claimeven lesson, which is about
// being the *second* player: generate a position with the second player to move,
// then relabel so that player is red — you are always red in the app.
function flipColours(b) {
  const out = createBoard();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) out[r][c] = b[r][c] === EMPTY ? EMPTY : other(b[r][c]);
  }
  return out;
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

// A random legal, non-terminal position with P1 to move and an even disc count in
// [lo, hi] — so P1 is also the player who opened, which is what the parity lesson
// depends on. `odd: true` builds the mirror case (an odd disc count, then colours
// flipped) so that you are red, to move, and the player who moved *second*.
function randomPosition(lo, hi, odd = false) {
  const b = createBoard();
  let cur = P1;
  const span = Math.floor((hi - lo) / 2) + 1;
  const target = lo + (odd ? 1 : 0) + 2 * Math.floor(Math.random() * span);
  for (let i = 0; i < target; i++) {
    const moves = legalMoves(b);
    if (!moves.length) return null;
    const l = dropDisc(b, moves[Math.floor(Math.random() * moves.length)], cur);
    if (checkWin(b, l.row, l.col)) return null; // already decided — unusable
    cur = other(cur);
  }
  if (!legalMoves(b).length) return null;
  return odd ? flipColours(b) : b;
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
    convert: true, // ends in a win, so it can be carried through to the four
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
    convert: true, // ends in a win, so it can be carried through to the four
    trap: 'And now the same shape, losing. Two threats are worth nothing if your disc hands them four first.',
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
      const forks = forkCols(b, P1);
      if (forks.length !== 1) return null;
      return { good: forks, after: openThreats(afterDrop(b, forks[0], P1).child, P1) };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },

  {
    id: 'seven',
    convert: true, // ends in a win, so it can be carried through to the four
    trap: 'The same seven, on a board where it fails. Look what the disc you played gives them.',
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
      const sevens = sevenCols(b, P1);
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
      const poisoned = poisonedCols(b, P1);
      if (poisoned.length < 2 || poisoned.length === legal.length) return null;
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
    convert: true, // ends in a win, so it can be carried through to the four
    trap: 'Stacked threats, and still lost. Count what your move hands over before you admire the shape.',
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
      const stacks = stackCols(b, P1);
      if (stacks.length !== 1) return null;
      return { good: [stacks[0].col], after: stacks[0].pair };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },

  {
    id: 'parity',
    convert: true, // ends in a win, so it can be carried through to the four
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
      const theirForks = forkCols(b, P2);
      if (!theirForks.length) return null;
      // Which of our moves leaves them with no fork at all?
      const clean = legalMoves(b).filter((c) => {
        const d = afterDrop(b, c, P1);
        return !colsWinningNow(d.child, P2).length && !forkCols(d.child, P2).length;
      });
      if (clean.length !== 1) return null;
      return { good: clean, fork: theirForks };
    },
    verify: (b, m, per) => uniqueSafe(m.good)(b, m, per),
  },

  {
    id: 'above',
    name: 'Sit above their threat',
    idea: 'A winning square of yours directly above one of theirs kills it stone dead.',
    ask: 'One move leaves their threat unplayable. Find it.',
    why: 'Now their square is poison to them — taking it hands you the one above.',
    nudge: 'Their threat is still live. Find the move that makes taking it lose.',
    close: 'You do not always have to block a threat. Sometimes you just make it unusable.',
    range: [14, 26],
    lesson: [
      { say: 'They have a winning square waiting. You could block it — or you could make it worthless.', board: 'drill0', markOpp: 'all' },
      { say: 'Put a winning square of yours directly above theirs. Now taking theirs lifts you onto yours.', board: 'drill0after' },
      { say: 'Their threat is still on the board and they can never use it. Find that move.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      if (!winningSquares(b, P2).length) return null; // nothing of theirs to cap
      const caps = aboveCols(b, P1);
      if (caps.length !== 1) return null;
      return { good: [caps[0].col], after: [caps[0].pair[0]], capped: caps[0].pair };
    },
    verify: (b, m, per) => uniqueSafe(m.good)(b, m, per),
  },

  {
    id: 'claimeven',
    convert: true, // ends in a win, so it can be carried through to the four
    name: 'Even rows, second player',
    idea: 'When you move second the even rows fall to you — the mirror of odd-row parity.',
    ask: 'You moved second here. Which move puts your threat on a row you will get?',
    why: 'That one. An even row, and you are the one who fills it.',
    nudge: 'Odd rows belong to whoever opened. That threat is theirs to fill, not yours.',
    close: 'Moving second is not a handicap. Take the even rows and let them run out of moves.',
    // The mirror of `parity`: the same idea from the other side of the board.
    range: [14, 26],
    odd: true,
    lesson: [
      { say: 'You did not open this game. They did. That changes which rows are yours.', board: 'empty', rows: [4, 2, 0] },
      { say: 'The odd rows fall to the player who opened. The even rows — 2, 4 and 6, lit here — fall to you.', board: 'empty', rows: [4, 2, 0] },
      { say: 'So build on the even rows and let them run out of safe moves. Find the move.', board: 'drill0' },
    ],
    match(b) {
      if (colsWinningNow(b, P1).length) return null;
      const before = winningSquares(b, P1).length;
      let even = null;
      let oddDecoy = false;
      for (const c of legalMoves(b)) {
        const d = afterDrop(b, c, P1);
        const squares = winningSquares(d.child, P1);
        if (squares.length <= before) continue;
        if (openThreats(d.child, P1).length) continue; // immediate threats make it a fork
        // Board rows are top-down: an even index is an even row from the bottom.
        if (squares.every(([r]) => r % 2 === 0)) { if (even !== null) return null; even = c; }
        else if (squares.some(([r]) => r % 2 === 1)) oddDecoy = true;
      }
      if (even === null || !oddDecoy) return null;
      return { good: [even] };
    },
    verify: (b, m, per) => uniqueWin(m.good)(b, m, per),
  },
];

// ---------------------------------------------------------------- search
const DRILLS_PER_TACTIC = Number(process.env.TACTIC_DRILLS || 3);
const SECONDS_PER_TACTIC = Number(process.env.TACTIC_SECONDS || 240);
const POOL = Number(process.env.TACTIC_POOL || 9); // candidates to choose 3 from

// How hard the drill is to *see*. Decoys are the moves that also build something —
// they look constructive, so a position full of them hides the real answer; an
// answer away from the middle is harder to find than one in it. Used to ship an
// easy, a middling and a subtle position per tactic instead of three random ones.
function difficulty(b, m) {
  const answer = m.good[0];
  let decoys = 0;
  for (const c of legalMoves(b)) {
    if (c === answer) continue;
    const d = afterDrop(b, c, P1);
    if (d && newSquares(b, d.child, P1).length > 0) decoys++;
  }
  return decoys * 2 + Math.abs(3 - answer);
}

// Play the position out: your move, their best defence, your best move, … until
// you have four. Returns the column sequence and how many moves of yours it took,
// or null if it can't be finished inside `maxOwnMoves` (or a solve aborts).
function playOut(b, firstCol, maxOwnMoves = 6) {
  const board = cloneBoard(b);
  const line = [firstCol];
  let l = dropDisc(board, firstCol, P1);
  if (!l) return null;
  if (checkWin(board, l.row, l.col)) return { line, ownMoves: 1 };
  for (let own = 1; own < maxOwnMoves; own++) {
    let aborted = false;
    const reply = bestDefence(board, P2, (child) => {
      const r = solve(child, P1);
      if (!r) aborted = true;
      return r ? r.score : 0;
    });
    if (aborted || reply == null) return null;
    dropDisc(board, reply, P2);
    line.push(reply);
    let best = null;
    let bestScore = -Infinity;
    for (const c of legalMoves(board)) {
      const d = afterDrop(board, c, P1);
      if (checkWin(d.child, d.row, d.col)) { best = c; bestScore = Infinity; break; }
      const r = solve(d.child, P2);
      if (!r) return null;
      if (-r.score > bestScore) { bestScore = -r.score; best = c; }
    }
    if (best == null) return null;
    l = dropDisc(board, best, P1);
    line.push(best);
    if (checkWin(board, l.row, l.col)) return { line, ownMoves: own + 1 };
  }
  return null;
}

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

// The counter-example: the tactic's own shape, on a position where playing it
// LOSES. It happens when the move fills the square under one of their winning
// squares — the shape alone is never the whole story, and that is the lesson.
// Returns { grid, play } or null.
function findTrap(spec, seen, seconds) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const b = randomPosition(spec.range[0], spec.range[1], !!spec.odd);
    if (!b) continue;
    const key = gridStr(b);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = spec.match(b);
    if (!m) continue;
    const col = m.good[0];
    // It has to lose *because* of the reply, so their four must be immediate.
    if (!handsThemFour(b, col, P1)) continue;
    const per = analyse(b);
    if (!per) continue;
    if (!(per.get(col) < 0)) continue; // the solver has to agree it loses
    const d = afterDrop(b, col, P1);
    const theirWin = colsWinningNow(d.child, P2)[0];
    if (theirWin == null) continue;
    return { grid: key, play: [col, theirWin] };
  }
  return null;
}

// TACTIC_ONLY=poison,stack limits the run while tuning a single pattern.
const only = (process.env.TACTIC_ONLY || '').split(',').filter(Boolean);

// TACTIC_REUSE=1 keeps the positions already committed in js/tactics.js and only
// re-emits the file — so editing a lesson's wording doesn't churn every drill (or
// cost another search). The reused positions still go through match + verify, so a
// prose-only run re-proves the whole curriculum on the way through.
const reuse = process.env.TACTIC_REUSE === '1';
let committed = new Map();
const reuseTrap = new Map();
if (reuse) {
  try {
    const mod = await import('../js/tactics.js');
    committed = new Map(mod.TACTICS.map((t) => [t.id, t.drills.map((d) => ({ grid: d.grid, convert: !!d.convert }))]));
    for (const t of mod.TACTICS) {
      const page = t.lesson.find((p) => p.trap);
      if (page) reuseTrap.set(t.id, { grid: page.grid, play: page.play });
    }
  } catch { /* no committed set yet — fall through to a full search */ }
}

// Re-derive a drill from a grid: the pattern has to still match and the solver
// has to still agree, or the position is dropped and searched for afresh.
function rebuild(spec, grid, convert) {
  const b = decode(grid);
  const m = spec.match(b);
  if (!m) return null;
  const per = analyse(b);
  if (!per || !spec.verify(b, m, per)) return null;
  if (convert) {
    const out = playOut(b, m.good[0], 5);
    if (!out || out.ownMoves < 2) return null;
    return makeDrill(b, grid, m, per, out.ownMoves);
  }
  return makeDrill(b, grid, m, per);
}

// The squares the teacher lights up once you have played the move: whatever the
// pattern itself recorded (a fork's two open threats, a stack's pair) or, failing
// that, simply what the move built. Computed here so the app never has to guess
// which of the position's threats the lesson was about.
function makeDrill(b, grid, m, per, winIn = 0) {
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
    // A convert drill isn't over when you spot the move: you play it out against
    // live best defence for `winIn` of your moves until the four is on the board.
    convert: winIn > 0,
    winIn,
    poison: m.poison || null,
    fork: m.fork || null,
    capped: m.capped || null,
    difficulty: difficulty(b, m),
    discs: discCount(b),
  };
}

// Three positions spread across the pool's difficulty range — easiest first, so a
// tactic opens with a position where the idea is plain and closes with one where
// it is buried.
function spread(pool, n) {
  const sorted = [...pool].sort((a, b) => a.difficulty - b.difficulty || b.discs - a.discs);
  if (sorted.length <= n) return sorted;
  const picks = [];
  for (let i = 0; i < n; i++) picks.push(sorted[Math.round((i * (sorted.length - 1)) / (n - 1))]);
  return [...new Set(picks)];
}

const results = [];
for (const spec of SPECS) {
  if (only.length && !only.includes(spec.id)) continue;
  const pool = [];
  const seen = new Set();
  let convertDrill = null;
  const t0 = Date.now();
  let tried = 0;

  // Committed positions first: they keep their role (recognition or convert) and
  // are re-proved on the way through.
  for (const prev of committed.get(spec.id) || []) {
    const kept = rebuild(spec, prev.grid, prev.convert);
    if (!kept) { console.error(`${spec.id}: a committed position no longer verifies — replacing it`); continue; }
    seen.add(prev.grid);
    if (prev.convert) convertDrill = kept;
    else pool.push(kept);
  }
  if (pool.length || convertDrill) {
    console.error(`${spec.id}: reused ${pool.length} position(s)${convertDrill ? ' + the convert drill' : ''}`);
  }

  const deadline = t0 + SECONDS_PER_TACTIC * 1000;
  while (pool.length < (reuse ? DRILLS_PER_TACTIC : POOL) && Date.now() < deadline) {
    tried++;
    const b = randomPosition(spec.range[0], spec.range[1], !!spec.odd);
    if (!b) continue;
    const key = gridStr(b);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = spec.match(b);
    if (!m) continue;
    const per = analyse(b);
    if (!per || !spec.verify(b, m, per)) continue;
    pool.push(makeDrill(b, key, m, per));
    console.error(`${spec.id}: pool ${pool.length} (tried ${tried}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  if (!pool.length) {
    console.error(`\nFAILED: no drill found for '${spec.id}' in ${SECONDS_PER_TACTIC}s (tried ${tried})`);
    process.exit(1);
  }
  const drills = spread(pool, DRILLS_PER_TACTIC);

  // The convert drill: the same idea, but you have to carry it through to the four
  // against a live defence. Only for the tactics that end in a win, and only on a
  // fuller board — the app solves each of your moves as you play, and that has to
  // stay instant. Missing one just means the tactic has its three drills.
  if (spec.convert && !convertDrill) {
    const cDeadline = Date.now() + SECONDS_PER_TACTIC * 1000;
    let cTried = 0;
    while (!convertDrill && Date.now() < cDeadline) {
      cTried++;
      const b = randomPosition(22, 30, !!spec.odd);
      if (!b) continue;
      const key = gridStr(b);
      if (seen.has(key)) continue;
      seen.add(key);
      const m = spec.match(b);
      if (!m) continue;
      const per = analyse(b);
      if (!per || !spec.verify(b, m, per)) continue;
      const out = playOut(b, m.good[0], 5);
      if (!out || out.ownMoves < 2 || out.ownMoves > 4) continue;
      convertDrill = makeDrill(b, key, m, per, out.ownMoves);
      console.error(`${spec.id}: convert drill, win in ${out.ownMoves} (tried ${cTried})`);
    }
    if (!convertDrill) console.error(`${spec.id}: no convert drill found — shipping ${drills.length} recognition drills`);
  }
  if (convertDrill) drills.push(convertDrill);

  // The counter-example page, where the same shape loses. Optional: if none turns
  // up in the budget, the tactic simply ships without one.
  let trap = null;
  if (spec.trap) {
    trap = reuseTrap.get(spec.id) || findTrap(spec, seen, Math.min(120, SECONDS_PER_TACTIC));
    console.error(trap ? `${spec.id}: counter-example found` : `${spec.id}: no counter-example in budget`);
  }

  results.push({ spec, drills, trap });
}

// ---------------------------------------------------------------- lesson pages
// Resolve a page's `board:` reference into a concrete grid plus whatever the page
// asked to be lit up. Marks are computed from the position, never hand-listed, so
// the teacher can only ever point at squares that really are threats.
function buildPage(page, drill) {
  const out = { say: page.say };
  const b0 = decode(drill.grid);
  out.grid = page.board === 'empty' ? EMPTY_GRID : gridStr(b0);

  // The "after" page isn't a still of the finished position any more: it starts
  // from the drill and *plays* the idea — your move, and where the payoff is
  // immediate, their best defence and your four. The app animates `play`, so the
  // teacher demonstrates instead of describing.
  if (page.board === 'drill0after') {
    const out3 = drill.follow ? playOut(b0, drill.good[0], 2) : null;
    out.play = out3 && out3.ownMoves === 2 ? out3.line : [drill.good[0]];
  }

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

const blocks = results.map(({ spec, drills, trap }) => {
  const pages = spec.lesson.map((p) => {
    const built = buildPage(p, drills[0]);
    const bits = [`grid: ${q(built.grid)}`, `say: ${q(built.say)}`];
    if (built.play) bits.push(`play: ${arr(built.play)}`);
    if (built.marks) bits.push(`marks: ${pairs(built.marks)}`);
    if (built.cols) bits.push(`cols: ${arr(built.cols)}`);
    if (built.rows) bits.push(`rows: ${arr(built.rows)}`);
    return `      { ${bits.join(', ')} },`;
  }).join('\n');
  // Appended last: the same idea, failing. Shown as a demonstration, so the
  // teacher plays the losing move and their four lands on top of it.
  const trapPage = trap
    ? `\n      { grid: ${q(trap.grid)}, say: ${q(spec.trap)}, play: ${arr(trap.play)}, trap: true },`
    : '';
  const rows = drills.map((d) =>
    `      { grid: ${q(d.grid)}, good: ${arr(d.good)}, follow: ${d.follow},` +
    (d.convert ? ` convert: true, winIn: ${d.winIn},` : '') + '\n' +
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
${pages}${trapPage}
    ],
    drills: [
${rows}
    ],
  },`;
}).join('\n');

const out = `// AUTO-GENERATED by tools/gen_tactics.mjs — do not edit by hand.
//
// The Tactics curriculum: ten ideas a player can actually learn, each with a
// short lesson the teacher walks you through and drills to try it on.
//   lesson — the teacher's pages. Each carries the position to show ('grid', 42
//            chars, row-major top→bottom; '0' empty, '1' you/red, '2' them/yellow)
//            and optionally squares ('marks'), whole columns ('cols') or rows
//            ('rows') to light up while it is on screen. A page with 'play' is a
//            demonstration: those columns are dropped in turn (you, them, you) so
//            the teacher shows the idea working instead of describing it. A page
//            marked 'trap' is the counter-example — the same shape, losing.
//   close  — what the teacher says once you have finished all of its drills.
//   drills — positions where YOU are red and to move. 'good' is the move the
//            tactic is about, and the solver has confirmed it is the ONLY move
//            that works, so anything else is a real mistake. 'show' is what the
//            teacher lights up once you have played it — the very squares the
//            tactic is about. 'follow' marks the drills where every reply leaves
//            you an immediate four, so the app can let you play the win out, and
//            'convert' marks the last drill of a tactic, where you carry the idea
//            through to the four yourself over 'winIn' moves against live defence.
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
