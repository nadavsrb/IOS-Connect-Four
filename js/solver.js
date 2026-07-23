// Connect Four — exact bitboard solver (pure, no DOM). Connect Four is a solved
// game, so this returns the game-theoretic value of a position with perfect play.
// It's the classic bitboard negamax of Pascal Pons (alpha-beta + a transposition
// table + non-losing-move pruning), ported to BigInt (a 7×6 board needs 49 bits,
// beyond JS's 32-bit bitwise ops). Used to make the win-% eval bar exact.
//
// A node budget caps the work: deep-opening positions abort and the caller falls
// back to the heuristic estimate; mid/endgame positions solve exactly and fast.

import { ROWS, COLS, EMPTY } from './engine.js';

const WIDTH = 7;
const HEIGHT = 6;
const SIZE = WIDTH * HEIGHT; // 42
const MIN_SCORE = -Math.trunc((WIDTH * HEIGHT) / 2) + 3; // -18
const MAX_SCORE = Math.trunc((WIDTH * HEIGHT + 1) / 2) - 3; // 18
const t2 = (x) => Math.trunc(x / 2); // integer division matching the reference

// Centre-out column order for better alpha-beta pruning.
const COLUMN_ORDER = [];
for (let i = 0; i < WIDTH; i++) {
  COLUMN_ORDER[i] = Math.trunc(WIDTH / 2) + (1 - 2 * (i % 2)) * Math.trunc((i + 1) / 2);
}

// --- Precomputed bit masks (BigInt). Bit index = col*(HEIGHT+1) + row, row 0 = bottom.
const bottomMaskCol = [];
const columnMaskArr = [];
const topMaskCol = [];
let BOTTOM_ALL = 0n;
let BOARD_MASK = 0n;
for (let c = 0; c < WIDTH; c++) {
  const base = BigInt(c * (HEIGHT + 1));
  bottomMaskCol[c] = 1n << base;
  columnMaskArr[c] = ((1n << BigInt(HEIGHT)) - 1n) << base;
  topMaskCol[c] = 1n << (BigInt(HEIGHT - 1) + base);
  BOTTOM_ALL |= bottomMaskCol[c];
  BOARD_MASK |= columnMaskArr[c];
}

function popcount(x) {
  let n = 0;
  while (x > 0n) { x &= x - 1n; n++; }
  return n;
}

// Empty cells that would complete a 4-in-a-row for `position` (the current player).
function computeWinning(position, mask) {
  // vertical (shift 1)
  let r = (position << 1n) & (position << 2n) & (position << 3n);
  // horizontal (shift HEIGHT+1 = 7)
  let p = (position << 7n) & (position << 14n);
  r |= p & (position << 21n);
  r |= p & (position >> 7n);
  p = (position >> 7n) & (position >> 14n);
  r |= p & (position << 7n);
  r |= p & (position >> 21n);
  // diagonal / (shift HEIGHT = 6)
  p = (position << 6n) & (position << 12n);
  r |= p & (position << 18n);
  r |= p & (position >> 6n);
  p = (position >> 6n) & (position >> 12n);
  r |= p & (position << 6n);
  r |= p & (position >> 18n);
  // diagonal \ (shift HEIGHT+2 = 8)
  p = (position << 8n) & (position << 16n);
  r |= p & (position << 24n);
  r |= p & (position >> 8n);
  p = (position >> 8n) & (position >> 16n);
  r |= p & (position << 8n);
  r |= p & (position >> 24n);
  return r & (BOARD_MASK ^ mask);
}

const possible = (P) => (P.mask + BOTTOM_ALL) & BOARD_MASK;
const winningSquares = (P) => computeWinning(P.cur, P.mask);
const oppWinningSquares = (P) => computeWinning(P.cur ^ P.mask, P.mask);
const canWinNext = (P) => (winningSquares(P) & possible(P)) !== 0n;

// Moves that don't hand the opponent an immediate win (0n if the position is lost).
function possibleNonLosingMoves(P) {
  let poss = possible(P);
  const oppWin = oppWinningSquares(P);
  const forced = poss & oppWin;
  if (forced !== 0n) {
    if ((forced & (forced - 1n)) !== 0n) return 0n; // two forced threats → lost
    poss = forced;
  }
  return poss & ~(oppWin >> 1n);
}

function play(P, move) {
  return { cur: P.cur ^ P.mask, mask: P.mask | move, moves: P.moves + 1 };
}

// --- Transposition table (lazy fixed-size hash; keys fit in a JS number < 2^53).
const TT_SIZE = 524287; // Mersenne prime 2^19 − 1
let ttKeys = null;
let ttVals = null;
function ensureTT() {
  if (!ttKeys) {
    ttKeys = new Float64Array(TT_SIZE);
    ttVals = new Int8Array(TT_SIZE);
  }
}
function ttGet(key) {
  const i = key % TT_SIZE;
  return ttKeys[i] === key ? ttVals[i] : 0; // 0 = miss (stored values are never 0)
}
function ttPut(key, val) {
  const i = key % TT_SIZE;
  ttKeys[i] = key;
  ttVals[i] = val;
}

const ABORT = Symbol('abort');
let nodeCount = 0;
let budget = 350000;

function negamax(P, alpha, beta) {
  if (++nodeCount > budget) throw ABORT;
  const next = possibleNonLosingMoves(P);
  if (next === 0n) return -t2(SIZE - P.moves); // every move loses
  if (P.moves >= SIZE - 2) return 0; // board fills to a draw

  let min = -t2(SIZE - 2 - P.moves);
  if (alpha < min) { alpha = min; if (alpha >= beta) return alpha; }
  let max = t2(SIZE - 1 - P.moves);
  if (beta > max) { beta = max; if (alpha >= beta) return beta; }

  const key = Number(P.cur + P.mask);
  const val = ttGet(key);
  if (val !== 0) {
    if (val > MAX_SCORE - MIN_SCORE + 1) { // lower bound
      const lb = val + 2 * MIN_SCORE - MAX_SCORE - 2;
      if (alpha < lb) { alpha = lb; if (alpha >= beta) return alpha; }
    } else { // upper bound
      const ub = val + MIN_SCORE - 1;
      if (beta > ub) { beta = ub; if (alpha >= beta) return beta; }
    }
  }

  // Order candidate moves by how many winning squares they create.
  const entries = [];
  for (let i = WIDTH - 1; i >= 0; i--) {
    const move = next & columnMaskArr[COLUMN_ORDER[i]];
    if (move !== 0n) entries.push({ move, score: popcount(computeWinning(P.cur | move, P.mask)) });
  }
  entries.sort((a, b) => a.score - b.score); // ascending; take highest last

  for (let i = entries.length - 1; i >= 0; i--) {
    const score = -negamax(play(P, entries[i].move), -beta, -alpha);
    if (score >= beta) { ttPut(key, score + MAX_SCORE - 2 * MIN_SCORE + 2); return score; } // lower bound
    if (score > alpha) alpha = score;
  }
  ttPut(key, alpha - MIN_SCORE + 1); // upper bound
  return alpha;
}

// Exact score for the side to move via iterative null-window search.
function solvePosition(P, weak) {
  if (canWinNext(P)) return t2(SIZE + 1 - P.moves);
  let min = -t2(SIZE - P.moves);
  let max = t2(SIZE + 1 - P.moves);
  if (weak) { min = -1; max = 1; }
  while (min < max) {
    let med = min + t2(max - min);
    if (med <= 0 && t2(min) < med) med = t2(min);
    else if (med >= 0 && t2(max) > med) med = t2(max);
    const r = negamax(P, med, med + 1);
    if (r <= med) max = r; else min = r;
  }
  return min;
}

// Build a bitboard position from the row-based game board (row 0 = top).
function fromBoard(board, playerToMove) {
  let cur = 0n;
  let mask = 0n;
  let moves = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = board[r][c];
      if (v === EMPTY) continue;
      const bit = 1n << BigInt(c * (HEIGHT + 1) + (ROWS - 1 - r));
      mask |= bit;
      if (v === playerToMove) cur |= bit;
      moves++;
    }
  }
  return { cur, mask, moves };
}

/**
 * Exactly solve a non-terminal position for `playerToMove`.
 * @returns {{score:number, moves:number}|null} game-theoretic score (positive =
 *   the side to move wins with perfect play, 0 = draw, negative = loses; larger
 *   magnitude = sooner), or null if the search exceeded its node budget.
 */
export function solveBoard(board, playerToMove, opts = {}) {
  ensureTT();
  if (opts.freshTT) clearTT();
  budget = opts.budget || 350000;
  const P = fromBoard(board, playerToMove);
  nodeCount = 0;
  try {
    const score = solvePosition(P, !!opts.weak);
    return { score, moves: P.moves, nodes: nodeCount };
  } catch (e) {
    if (e === ABORT) return null;
    throw e;
  }
}

// Clear the transposition table (used by benchmarks that need per-position node
// counts; normal play keeps the table warm across calls for speed).
function clearTT() {
  if (ttKeys) { ttKeys.fill(0); ttVals.fill(0); }
}

// Exposed for tests.
export const __test = { fromBoard, canWinNext, popcount, clearTT, SIZE };
