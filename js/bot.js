// Connect Four — computer opponent (pure logic, no DOM).
// Three difficulty levels, all algorithmic (no ML):
//   easy   – grabs an immediate win, usually blocks, otherwise fairly random.
//   medium – always wins/blocks when possible, avoids handing the opponent a win, plays the centre.
//   hard   – minimax with alpha-beta pruning + a positional heuristic (genuinely tough).

import {
  COLS,
  ROWS,
  EMPTY,
  cloneBoard,
  dropDisc,
  checkWin,
  legalMoves,
  isFull,
  other,
} from './engine.js';

// Search columns from the centre outwards — better alpha-beta pruning and stronger play.
const MOVE_ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN_SCORE = 100000;
const HARD_DEPTH = 6;

function orderedMoves(board) {
  return MOVE_ORDER.filter((c) => board[0][c] === EMPTY);
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Column that immediately wins for `player`, or null.
function findImmediateWin(board, player) {
  for (const c of legalMoves(board)) {
    const b = cloneBoard(board);
    const landing = dropDisc(b, c, player);
    if (landing && checkWin(b, landing.row, landing.col)) return c;
  }
  return null;
}

// Would playing `col` let the opponent win on their next move? (avoid the trap)
function givesOpponentWin(board, col, player) {
  const b = cloneBoard(board);
  dropDisc(b, col, player);
  return findImmediateWin(b, other(player)) !== null;
}

// Among candidate columns, pick the one nearest the centre (ties broken randomly).
function centrePref(cols) {
  let best = Infinity;
  for (const c of cols) best = Math.min(best, Math.abs(3 - c));
  const ties = cols.filter((c) => Math.abs(3 - c) === best);
  return randomChoice(ties);
}

// --- Heuristic evaluation (for the hard level's depth limit) -------------------

function scoreWindow(a, b, c, d, me, opp) {
  let mine = 0;
  let theirs = 0;
  let empty = 0;
  for (const v of [a, b, c, d]) {
    if (v === me) mine++;
    else if (v === opp) theirs++;
    else empty++;
  }
  if (mine > 0 && theirs > 0) return 0; // blocked window, no potential either way
  if (mine === 4) return WIN_SCORE;
  if (mine === 3 && empty === 1) return 50;
  if (mine === 2 && empty === 2) return 10;
  if (theirs === 4) return -WIN_SCORE;
  if (theirs === 3 && empty === 1) return -80; // weight defence a little heavier
  if (theirs === 2 && empty === 2) return -8;
  return 0;
}

function evaluate(board, me, opp) {
  let score = 0;

  // Prefer controlling the centre column.
  for (let r = 0; r < ROWS; r++) {
    if (board[r][3] === me) score += 6;
    else if (board[r][3] === opp) score -= 6;
  }

  // Horizontal windows
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      score += scoreWindow(board[r][c], board[r][c + 1], board[r][c + 2], board[r][c + 3], me, opp);
    }
  }
  // Vertical windows
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r <= ROWS - 4; r++) {
      score += scoreWindow(board[r][c], board[r + 1][c], board[r + 2][c], board[r + 3][c], me, opp);
    }
  }
  // Diagonal "\"
  for (let r = 0; r <= ROWS - 4; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      score += scoreWindow(board[r][c], board[r + 1][c + 1], board[r + 2][c + 2], board[r + 3][c + 3], me, opp);
    }
  }
  // Diagonal "/"
  for (let r = 3; r < ROWS; r++) {
    for (let c = 0; c <= COLS - 4; c++) {
      score += scoreWindow(board[r][c], board[r - 1][c + 1], board[r - 2][c + 2], board[r - 3][c + 3], me, opp);
    }
  }
  return score;
}

// --- Minimax with alpha-beta --------------------------------------------------

function minimax(board, depth, alpha, beta, maximizing, me, opp) {
  const moves = orderedMoves(board);
  if (moves.length === 0) return 0; // draw
  if (depth === 0) return evaluate(board, me, opp);

  if (maximizing) {
    let value = -Infinity;
    for (const c of moves) {
      const b = cloneBoard(board);
      const landing = dropDisc(b, c, me);
      let score;
      if (checkWin(b, landing.row, landing.col)) score = WIN_SCORE + depth; // sooner wins score higher
      else if (isFull(b)) score = 0;
      else score = minimax(b, depth - 1, alpha, beta, false, me, opp);
      value = Math.max(value, score);
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Infinity;
  for (const c of moves) {
    const b = cloneBoard(board);
    const landing = dropDisc(b, c, opp);
    let score;
    if (checkWin(b, landing.row, landing.col)) score = -WIN_SCORE - depth; // delay losses
    else if (isFull(b)) score = 0;
    else score = minimax(b, depth - 1, alpha, beta, true, me, opp);
    value = Math.min(value, score);
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function bestMinimaxMove(board, me, depth) {
  const opp = other(me);
  let bestScore = -Infinity;
  let bestCols = [];
  for (const c of orderedMoves(board)) {
    const b = cloneBoard(board);
    const landing = dropDisc(b, c, me);
    let score;
    if (checkWin(b, landing.row, landing.col)) score = WIN_SCORE + depth;
    else if (isFull(b)) score = 0;
    else score = minimax(b, depth - 1, -Infinity, Infinity, false, me, opp);

    if (score > bestScore) {
      bestScore = score;
      bestCols = [c];
    } else if (score === bestScore) {
      bestCols.push(c);
    }
  }
  return centrePref(bestCols);
}

// --- Public API ---------------------------------------------------------------

/**
 * Choose a column for `player` on `board`.
 * @param {number[][]} board
 * @param {number} player   P1 or P2
 * @param {'easy'|'medium'|'hard'} difficulty
 * @returns {number|null} chosen column, or null if the board is full.
 */
export function chooseMove(board, player, difficulty = 'medium') {
  const moves = legalMoves(board);
  if (moves.length === 0) return null;

  const opp = other(player);

  // Always take a move that wins right now.
  const winning = findImmediateWin(board, player);
  if (winning !== null) return winning;

  if (difficulty === 'easy') {
    // Blocks most of the time, but not always — that's what makes it beatable.
    const block = findImmediateWin(board, opp);
    if (block !== null && Math.random() < 0.75) return block;
    return randomChoice(moves);
  }

  if (difficulty === 'medium') {
    const block = findImmediateWin(board, opp);
    if (block !== null) return block;
    // Prefer moves that don't hand the opponent an immediate win.
    const safe = moves.filter((c) => !givesOpponentWin(board, c, player));
    const pool = safe.length ? safe : moves;
    // Mostly centre-seeking, with a dash of randomness so it isn't robotic.
    if (Math.random() < 0.8) return centrePref(pool);
    return randomChoice(pool);
  }

  // hard
  return bestMinimaxMove(board, player, HARD_DEPTH);
}
