// Connect Four tactical patterns — pure, no DOM, no solver.
//
// These are the shapes the Tactics section teaches, written once and used three
// times: the generator matches candidate positions with them, its test re-derives
// each tactic's shape from them, and the app uses them live to say which idea you
// missed in your own game.
//
// Everything here is *structural* — it answers "is this shape on the board", not
// "is this move correct". Correctness is the solver's job (js/solver.js); a shape
// that matches still has to survive that before it becomes a drill.
import {
  ROWS, COLS, EMPTY, P1, P2,
  cloneBoard, dropDisc, checkWin, legalMoves, landingRow, winningSquares, other,
} from './engine.js';

/** Can a disc played now land exactly on (r, c)? */
export const playableNow = (board, r, c) => landingRow(board, c) === r;

/** The player's winning squares that are reachable this move ("open threats"). */
export const openThreats = (board, player) =>
  winningSquares(board, player).filter(([r, c]) => playableNow(board, r, c));

/** Drop into `col` on a copy. Returns { child, row, col } or null if illegal. */
export function afterDrop(board, col, player) {
  const child = cloneBoard(board);
  const landing = dropDisc(child, col, player);
  return landing ? { child, row: landing.row, col: landing.col } : null;
}

/** Does dropping into `col` complete four for `player` right now? */
export function winsNow(board, col, player) {
  const d = afterDrop(board, col, player);
  return !!(d && checkWin(d.child, d.row, d.col));
}

/** Columns that complete four for `player` immediately. */
export const colsWinningNow = (board, player) =>
  legalMoves(board).filter((c) => winsNow(board, c, player));

/** Threats in `after` that weren't in `before` — what a move built. */
export function newSquares(before, after, player) {
  const had = new Set(winningSquares(before, player).map(([r, c]) => `${r},${c}`));
  return winningSquares(after, player).filter(([r, c]) => !had.has(`${r},${c}`));
}

// Which lines through the disc at (r, c) are one square short of four. Vertical is
// deliberately left out: a "seven" is a row meeting a diagonal, and a threat
// stacked in a column is its own tactic.
const DIRS = { row: [0, 1], diagUp: [-1, 1], diagDown: [1, 1] };
export function threatDirs(board, player, r, c) {
  const found = new Set();
  for (const [name, [dr, dc]] of Object.entries(DIRS)) {
    for (let s = -3; s <= 0; s++) {
      let mine = 0;
      let empty = 0;
      let inside = true;
      for (let k = 0; k < 4; k++) {
        const rr = r + dr * (s + k);
        const cc = c + dc * (s + k);
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) { inside = false; break; }
        if (board[rr][cc] === player) mine++;
        else if (board[rr][cc] === EMPTY) empty++;
        else { inside = false; break; }
      }
      // The window contains (r, c) by construction, so 3 mine + 1 empty means
      // "this disc is part of a line that needs one more square".
      if (inside && mine === 3 && empty === 1) found.add(name);
    }
  }
  return found;
}

// --- the tactics, as shapes ---------------------------------------------------

/** Columns that leave `player` two or more reachable threats — an unstoppable fork. */
export const forkCols = (board, player) =>
  legalMoves(board).filter((c) => openThreats(afterDrop(board, c, player).child, player).length >= 2);

/**
 * Columns that put two of `player`'s winning squares in the same column, one
 * directly above the other, with the lower one reachable. Blocking the low square
 * hands over the high one, so it cannot be answered.
 * @returns {Array<{col:number, pair:Array<[number,number]>}>}
 */
export function stackCols(board, player) {
  const out = [];
  for (const c of legalMoves(board)) {
    const { child } = afterDrop(board, c, player);
    if (openThreats(child, player).length >= 2) continue; // that's a fork, not a stack
    const squares = winningSquares(child, player);
    const fresh = new Set(newSquares(board, child, player).map(([r, cc]) => `${r},${cc}`));
    const low = squares.find(([r, cc]) =>
      playableNow(child, r, cc) && r > 0 &&
      squares.some(([r2, c2]) => c2 === cc && r2 === r - 1) &&
      (fresh.has(`${r},${cc}`) || fresh.has(`${r - 1},${cc}`)));
    if (low) out.push({ col: c, pair: [[low[0] - 1, low[1]], low] });
  }
  return out;
}

/** Columns where one disc finishes both a row and a diagonal — the seven. */
export function sevenCols(board, player) {
  return legalMoves(board).filter((c) => {
    const d = afterDrop(board, c, player);
    const dirs = threatDirs(d.child, player, d.row, d.col);
    return dirs.has('row') && (dirs.has('diagUp') || dirs.has('diagDown')) &&
      winningSquares(d.child, player).length >= 2;
  });
}

/** Columns where your disc would lift the opponent onto a four ("poisoned"). */
export const poisonedCols = (board, player) =>
  legalMoves(board).filter((c) => colsWinningNow(afterDrop(board, c, player).child, other(player)).length > 0);

/**
 * Columns after which one of your winning squares sits directly ABOVE one of
 * theirs, in the same column. Their threat is then dead: taking it would put your
 * disc's square within reach, so they can never play it. Distinct from a stack
 * (two of *your* squares) and from a poisoned column (not filling below theirs).
 * @returns {Array<{col:number, pair:Array<[number,number]>}>} pair = [yours, theirs]
 */
export function aboveCols(board, player) {
  const foe = other(player);
  const had = new Set();
  for (const [r, c] of winningSquares(board, foe)) {
    if (r > 0 && winningSquares(board, player).some(([r2, c2]) => c2 === c && r2 === r - 1)) had.add(`${r},${c}`);
  }
  const out = [];
  for (const c of legalMoves(board)) {
    const { child } = afterDrop(board, c, player);
    const mine = winningSquares(child, player);
    const theirs = winningSquares(child, foe);
    const capped = theirs.find(([r, cc]) =>
      r > 0 && !had.has(`${r},${cc}`) && mine.some(([r2, c2]) => c2 === cc && r2 === r - 1));
    if (capped) out.push({ col: c, pair: [[capped[0] - 1, capped[1]], capped] });
  }
  return out;
}

/** Would `col` let the opponent finish on their very next move? */
export function handsThemFour(board, col, player) {
  const d = afterDrop(board, col, player);
  return !!d && colsWinningNow(d.child, other(player)).length > 0;
}

/**
 * The opponent's strongest reply, given they are already lost or worse: whatever
 * `score(child)` ranks lowest for you. Ties matter — in a lost position every move
 * loses at the same depth, so without a second key the tiebreak plays somewhere
 * arbitrary while your winning square sits there. Blocking one of your reachable
 * threats comes first, centre-most settles the rest so it stays deterministic.
 * @param {(child:number[][]) => number} score your score for the resulting position
 */
export function bestDefence(board, defender, score) {
  const moves = legalMoves(board);
  if (!moves.length) return null;
  const attacker = other(defender);
  const threatCols = new Set(openThreats(board, attacker).map(([, c]) => c));
  let best = null;
  let bestScore = Infinity;
  let bestBlocks = false;
  let bestCentre = Infinity;
  for (const c of moves) {
    const d = afterDrop(board, c, defender);
    if (checkWin(d.child, d.row, d.col)) return c; // wins outright
    const s = score(d.child);
    const blocks = threatCols.has(c);
    const centre = Math.abs(3 - c);
    const better =
      s < bestScore ||
      (s === bestScore && blocks && !bestBlocks) ||
      (s === bestScore && blocks === bestBlocks && centre < bestCentre);
    if (better) { bestScore = s; bestBlocks = blocks; bestCentre = centre; best = c; }
  }
  return best;
}

// --- naming the idea behind a mistake -----------------------------------------

// Ordered most-decisive first: a missed forced block beats everything, and the
// centre is only ever the last word because "you played the edge" is the weakest
// of these claims.
const MISSES = [
  // They were one move from four and you played elsewhere.
  ['tempo', (b, me, played) => {
    const forced = openThreats(b, other(me));
    return forced.length > 0 && !forced.some(([, c]) => c === played);
  }],
  // Your disc lifted them onto a winning square.
  ['poison', (b, me, played) => handsThemFour(b, played, me)],
  // A fork was there for the taking.
  ['fork', (b, me, played) => {
    const forks = forkCols(b, me);
    return forks.length > 0 && !forks.includes(played);
  }],
  // So was a stack.
  ['stack', (b, me, played) => {
    const stacks = stackCols(b, me).map((s) => s.col);
    return stacks.length > 0 && !stacks.includes(played);
  }],
  // A single disc could have finished a row and a diagonal.
  ['seven', (b, me, played) => {
    const sevens = sevenCols(b, me);
    return sevens.length > 0 && !sevens.includes(played);
  }],
  // You left them a move that forks you.
  ['defuse', (b, me, played) => {
    const d = afterDrop(b, played, me);
    return !!d && forkCols(d.child, other(me)).length > 0;
  }],
  // Nothing sharper to say: you went to the edge with the middle still open.
  ['centre', (b, me, played) => landingRow(b, 3) >= 0 && Math.abs(3 - played) >= 2],
];

/**
 * Which taught idea would have saved this move? Structural only — the caller has
 * already decided the move lost ground (the review flags it by win-%), and this
 * just names the shape that was on the board.
 * @returns {string|null} a tactic id, or null if nothing recognisable applies
 */
export function missedTactic(board, mover, playedCol) {
  if (playedCol == null || landingRow(board, playedCol) < 0) return null;
  // Taking a win that was there needs no lesson attached to it.
  if (winsNow(board, playedCol, mover)) return null;
  for (const [id, test] of MISSES) {
    if (test(board, mover, playedCol)) return id;
  }
  return null;
}

export const __test = { MISSES, DIRS };
