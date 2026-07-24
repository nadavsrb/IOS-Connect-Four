// Connect Four — computer opponent (pure logic, no DOM, no ML — all just search).
// Four difficulty levels, every one algorithmic:
//   easy   – grabs an immediate win, usually blocks, otherwise fairly random.
//   medium – always wins/blocks when possible, avoids handing the opponent a win, plays the centre.
//   hard   – minimax with alpha-beta pruning + a positional heuristic (genuinely tough).
//   insane – the same minimax, searched deeper (near-unbeatable).
// Insane alone hands the decision to the exact bitboard solver once the position
// is small enough to solve, so it never errs in the endgame; hard stays a deep
// but fallible search. The solver is skipped entirely in the Pop-Out variant,
// whose rules it does not model (see the `exact` option).
// The Pop-Out variant is a different game (you may pop your own bottom disc, and a
// pop can complete four for either side), so it has its own search —
// choosePopoutMove() — rather than being bolted onto the classic one.
// Also exposes winChance(): an engine estimate of each side's chance to win, used by the eval bar.

import {
  P1,
  P2,
  COLS,
  ROWS,
  EMPTY,
  cloneBoard,
  dropDisc,
  popDisc,
  canPop,
  findWinFor,
  checkWin,
  legalMoves,
  isFull,
  other,
} from './engine.js';
import { solveBoard } from './solver.js';

// Search columns from the centre outwards — better alpha-beta pruning and stronger play.
const MOVE_ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN_SCORE = 100000;
const HARD_DEPTH = 6;
const INSANE_DEPTH = 8;
const EVAL_K = 50; // logistic scale mapping heuristic score → win probability

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

// --- Threat / parity evaluation (used by the win-% bar) -----------------------

// All 69 four-in-a-row windows, precomputed once as flat [r,c, r,c, r,c, r,c].
const WINDOWS = (() => {
  const w = [];
  const add = (cells) => w.push(cells.flat());
  for (let r = 0; r < ROWS; r++) for (let c = 0; c <= COLS - 4; c++) add([[r, c], [r, c + 1], [r, c + 2], [r, c + 3]]);
  for (let c = 0; c < COLS; c++) for (let r = 0; r <= ROWS - 4; r++) add([[r, c], [r + 1, c], [r + 2, c], [r + 3, c]]);
  for (let r = 0; r <= ROWS - 4; r++) for (let c = 0; c <= COLS - 4; c++) add([[r, c], [r + 1, c + 1], [r + 2, c + 2], [r + 3, c + 3]]);
  for (let r = 3; r < ROWS; r++) for (let c = 0; c <= COLS - 4; c++) add([[r, c], [r - 1, c + 1], [r - 2, c + 2], [r - 3, c + 3]]);
  return w;
})();

function countDiscs(board) {
  let n = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (board[r][c] !== EMPTY) n++;
  return n;
}

// Reused scratch buffers so a threat square counted by several windows is only
// tallied once, without allocating on every (very hot) leaf evaluation.
const _seenMe = new Uint8Array(ROWS * COLS);
const _seenOpp = new Uint8Array(ROWS * COLS);

// Richer, single-pass leaf evaluation for the win-% bar: centre control +
// two-in-a-row potential + parity-weighted threat squares. A "threat square" is
// an empty cell that would complete a four; the first mover cashes threats on
// odd rows (from the bottom), the second mover on even rows — the classic
// Connect Four zugzwang parity — and immediately playable threats count extra.
// `firstMover` (P1/P2) is derived from whose turn it is, so this is turn-aware.
// Positive = good for `me`.
function evaluateBar(board, me, opp, firstMover) {
  let score = 0;
  for (let r = 0; r < ROWS; r++) {
    const v = board[r][3];
    if (v === me) score += 4; else if (v === opp) score -= 4;
  }
  _seenMe.fill(0);
  _seenOpp.fill(0);
  let meOdd = 0, meEven = 0, mePlay = 0, opOdd = 0, opEven = 0, opPlay = 0, meTwo = 0, opTwo = 0;
  for (let i = 0; i < WINDOWS.length; i++) {
    const w = WINDOWS[i];
    const v0 = board[w[0]][w[1]], v1 = board[w[2]][w[3]], v2 = board[w[4]][w[5]], v3 = board[w[6]][w[7]];
    let mine = 0, their = 0, empties = 0, er = -1, ec = -1;
    if (v0 === me) mine++; else if (v0 === opp) their++; else { empties++; er = w[0]; ec = w[1]; }
    if (v1 === me) mine++; else if (v1 === opp) their++; else { empties++; er = w[2]; ec = w[3]; }
    if (v2 === me) mine++; else if (v2 === opp) their++; else { empties++; er = w[4]; ec = w[5]; }
    if (v3 === me) mine++; else if (v3 === opp) their++; else { empties++; er = w[6]; ec = w[7]; }
    if (mine && their) continue; // mixed window — no potential either way
    if (mine === 3 && empties === 1) {
      const idx = er * COLS + ec;
      if (!_seenMe[idx]) {
        _seenMe[idx] = 1;
        if ((ROWS - er) & 1) meOdd++; else meEven++;
        if (er + 1 >= ROWS || board[er + 1][ec] !== EMPTY) mePlay++;
      }
    } else if (mine === 2 && empties === 2) {
      meTwo++;
    } else if (their === 3 && empties === 1) {
      const idx = er * COLS + ec;
      if (!_seenOpp[idx]) {
        _seenOpp[idx] = 1;
        if ((ROWS - er) & 1) opOdd++; else opEven++;
        if (er + 1 >= ROWS || board[er + 1][ec] !== EMPTY) opPlay++;
      }
    } else if (their === 2 && empties === 2) {
      opTwo++;
    }
  }
  score += (meTwo - opTwo) * 3;
  score += (me === firstMover ? meOdd * 22 + meEven * 8 : meEven * 22 + meOdd * 8) + mePlay * 14;
  score -= (opp === firstMover ? opOdd * 22 + opEven * 8 : opEven * 22 + opOdd * 8) + opPlay * 14;
  return score;
}

// --- Minimax with alpha-beta --------------------------------------------------
// `leafEval(board, me, opp)` overrides the depth-0 evaluation when provided (the
// win-% bar passes a richer, parity-aware one); the bot leaves it undefined and
// uses the lean positional `evaluate`.

function minimax(board, depth, alpha, beta, maximizing, me, opp, leafEval) {
  const moves = orderedMoves(board);
  if (moves.length === 0) return 0; // draw
  if (depth === 0) return leafEval ? leafEval(board, me, opp) : evaluate(board, me, opp);

  if (maximizing) {
    let value = -Infinity;
    for (const c of moves) {
      const b = cloneBoard(board);
      const landing = dropDisc(b, c, me);
      let score;
      if (checkWin(b, landing.row, landing.col)) score = WIN_SCORE + depth; // sooner wins score higher
      else if (isFull(b)) score = 0;
      else score = minimax(b, depth - 1, alpha, beta, false, me, opp, leafEval);
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
    else score = minimax(b, depth - 1, alpha, beta, true, me, opp, leafEval);
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
 * @param {'easy'|'medium'|'hard'|'insane'} difficulty
 * @param {{exact?: boolean}} [opts]  exact:false forbids the bitboard solver —
 *   required in the Pop-Out variant, whose rules the solver does not model.
 * @returns {number|null} chosen column, or null if the board is full.
 */
export function chooseMove(board, player, difficulty = 'medium', opts = {}) {
  const exactAllowed = opts.exact !== false;
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

  // Insane alone hands the endgame to the exact solver, so it stops erring
  // entirely once the position is small enough to solve. Hard deliberately does
  // not: it stays a deep-but-fallible search, which is what keeps the ladder
  // meaningful — a perfect Hard would be indistinguishable from Insane for the
  // whole second half of every game.
  if (difficulty === 'insane' && exactAllowed && countDiscs(board) >= SOLVE_PICK_MIN_DISCS) {
    const best = bestSolvedMove(board, player);
    if (best !== null) return best;
  }
  return bestMinimaxMove(board, player, difficulty === 'insane' ? INSANE_DEPTH : HARD_DEPTH);
}

// --- Pop-Out variant ----------------------------------------------------------
// A different game, so it gets its own search. Moves are drops *or* pops of your
// own bottom disc, and a pop slides a whole column down — which can complete four
// for either player, or both at once (the official rule makes that a draw). The
// classic search can't express any of that: it never pops, and it never sees the
// opponent's pops coming either.

const POPOUT_DEPTH = { easy: 0, medium: 2, hard: 4, insane: 6 };

/** Every legal Pop-Out move for `player`, centre-out (drops first — better pruning). */
export function popoutMoves(board, player) {
  const moves = [];
  for (const c of MOVE_ORDER) if (board[0][c] === EMPTY) moves.push({ type: 'drop', col: c });
  for (const c of MOVE_ORDER) if (canPop(board, c, player)) moves.push({ type: 'pop', col: c });
  return moves;
}

/**
 * Apply `mv` to `board` (mutates) and report how it resolved for the mover:
 * 'win' | 'loss' | 'draw' | null (game continues). Popping can hand the opponent
 * a four — that's a loss for the mover — and making four for both at once is a draw.
 */
export function applyPopoutMove(board, mv, player) {
  if (mv.type === 'drop') {
    const l = dropDisc(board, mv.col, player);
    if (!l) return null;
    return checkWin(board, l.row, l.col) ? 'win' : null;
  }
  if (!popDisc(board, mv.col, player)) return null;
  const mine = !!findWinFor(board, player);
  const theirs = !!findWinFor(board, other(player));
  if (mine && theirs) return 'draw';
  if (mine) return 'win';
  if (theirs) return 'loss';
  return null;
}

// Negamax + alpha-beta over the Pop-Out move space. Terminal scores are offset by
// the remaining depth so a faster win (or a slower loss) is preferred.
function popoutSearch(board, player, depth, alpha, beta) {
  const opp = other(player);
  const moves = popoutMoves(board, player);
  if (moves.length === 0) return 0; // no move at all — a draw
  if (depth <= 0) return evaluate(board, player, opp);

  let best = -Infinity;
  for (const mv of moves) {
    const b = cloneBoard(board);
    const res = applyPopoutMove(b, mv, player);
    let val;
    if (res === 'win') val = WIN_SCORE + depth;
    else if (res === 'loss') val = -WIN_SCORE - depth;
    else if (res === 'draw') val = 0;
    else val = -popoutSearch(b, opp, depth - 1, -beta, -alpha);
    if (val > best) best = val;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // this branch can't affect the result
  }
  return best;
}

// Would `mv` hand the opponent an immediate win (by drop or by pop)?
function popoutGivesOpponentWin(board, mv, player) {
  const b = cloneBoard(board);
  if (applyPopoutMove(b, mv, player) !== null) return false; // already resolved
  const opp = other(player);
  for (const reply of popoutMoves(b, opp)) {
    const c = cloneBoard(b);
    if (applyPopoutMove(c, reply, opp) === 'win') return true;
  }
  return false;
}

/**
 * Choose a Pop-Out move for `player`: `{ type: 'drop'|'pop', col }`, or null when
 * there is no legal move. The exact solver is never involved — it plays standard
 * rules, which a pop can refute.
 *
 * @param {number[][]} board
 * @param {number} player
 * @param {'easy'|'medium'|'hard'|'insane'} difficulty
 */
export function choosePopoutMove(board, player, difficulty = 'medium') {
  const moves = popoutMoves(board, player);
  if (moves.length === 0) return null;

  // Win outright if we can. applyPopoutMove already rejects a pop that completes
  // four for the opponent too (that scores 'draw' or 'loss', never 'win').
  for (const mv of moves) {
    const b = cloneBoard(board);
    if (applyPopoutMove(b, mv, player) === 'win') return mv;
  }

  const safe = moves.filter((mv) => !popoutGivesOpponentWin(board, mv, player));

  if (difficulty === 'easy') {
    // Usually avoids the obvious disaster, but not always — that's the point.
    if (safe.length && Math.random() < 0.7) return randomChoice(safe);
    return randomChoice(moves);
  }

  const pool = safe.length ? safe : moves;
  const depth = POPOUT_DEPTH[difficulty] ?? POPOUT_DEPTH.medium;

  let best = -Infinity;
  let bestMoves = [];
  for (const mv of pool) {
    const b = cloneBoard(board);
    const res = applyPopoutMove(b, mv, player);
    let val;
    if (res === 'win') val = WIN_SCORE + depth; // (already handled above, kept for safety)
    else if (res === 'loss') val = -WIN_SCORE - depth;
    else if (res === 'draw') val = 0;
    else val = -popoutSearch(b, other(player), depth - 1, -Infinity, Infinity);
    if (val > best) { best = val; bestMoves = [mv]; }
    else if (val === best) bestMoves.push(mv);
  }
  if (bestMoves.length === 0) return randomChoice(moves);

  // Among equally-rated moves prefer a drop over a pop (popping for no gain just
  // hands material back), then the most central column.
  const drops = bestMoves.filter((m) => m.type === 'drop');
  const tier = drops.length ? drops : bestMoves;
  let closest = Infinity;
  for (const m of tier) closest = Math.min(closest, Math.abs(3 - m.col));
  return randomChoice(tier.filter((m) => Math.abs(3 - m.col) === closest));
}

// Gate for using the exact solver to *choose* a move rather than just to rate a
// position. It's higher than SOLVE_MIN_DISCS because choosing means solving one
// child per legal column — up to 7 solves — and the whole decision has to fit
// inside the bot's think delay.
const SOLVE_PICK_MIN_DISCS = 24;

/**
 * The game-theoretically best column for `player`, or null when the position is
 * out of the solver's reach. If *any* child exceeds the node budget the whole
 * attempt is abandoned (returns null) rather than mixing exact scores with
 * heuristic ones, which would be worse than using either alone.
 *
 * Columns are tried centre-out and ties keep the first seen, so the choice is
 * deterministic and centre-preferring — the same board always yields the same move.
 */
function bestSolvedMove(board, player) {
  const opp = other(player);
  let best = null;
  let bestScore = -Infinity;
  for (const c of orderedMoves(board)) {
    const b = cloneBoard(board);
    const landing = dropDisc(b, c, player);
    if (!landing) continue;
    if (checkWin(b, landing.row, landing.col)) return c; // wins now — nothing beats it
    const solved = solveBoard(b, opp, { budget: SOLVE_BUDGET });
    if (!solved) return null; // budget hit — fall back to minimax for the whole decision
    // solveBoard scores from the side to move (the opponent here), so negate to
    // get our view: higher = a faster forced win, or a slower forced loss.
    const score = -solved.score;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

// Gate + node budget for the exact solver used by winChance. Once at least
// SOLVE_MIN_DISCS discs are down (roughly the game's second half) the tree is
// small enough that the bitboard solver returns the game-theoretic result well
// within SOLVE_BUDGET nodes — benchmarked to never abort in this range, so the
// bar is exact and stays deterministic. Earlier positions skip it (they'd blow
// the budget) and use the heuristic estimate.
const SOLVE_MIN_DISCS = 22;
const SOLVE_BUDGET = 200000;
const BOARD_CELLS = ROWS * COLS; // 42

// Map an exact solver score to the side-to-move's win probability. The result is
// game-theoretic (win / draw / loss under perfect play), so the bar commits
// decisively: a proven win reads 82–98%, a proven draw exactly 50%, a proven
// loss 2–18% — graded within each band by how *soon* the result arrives (a
// larger score magnitude = a faster forced win/loss). The winning floor of 82%
// sits above the heuristic's 94% ceiling only at the top, so a *proven* win
// always reads as clearly decided.
function solvedProb(score, moves) {
  if (score === 0) return 0.5; // proven draw
  if (score > 0) {
    const fastest = Math.max(1, Math.trunc((BOARD_CELLS + 1 - moves) / 2));
    return 0.82 + 0.16 * Math.min(1, score / fastest);
  }
  const fastest = Math.max(1, Math.trunc((BOARD_CELLS - moves) / 2));
  return 0.18 - 0.16 * Math.min(1, -score / fastest);
}

/**
 * Estimate each player's chance to win in the current position, presented like a
 * chess eval bar.
 *
 * In the second half of the game (≥ SOLVE_MIN_DISCS discs) it is *exact*: the
 * bitboard solver returns the game-theoretic value under perfect play and
 * solvedProb() maps it to the bar. Earlier positions have too large a tree to
 * solve within the node budget, so they fall back to a heuristic estimate that
 * is turn-aware in two ways: the minimax search runs from `playerToMove`'s
 * perspective (so tactics for the side on move are seen first), and the leaf
 * evaluation weights threat squares by odd/even-row parity relative to the
 * game's *first mover* — derived from whose turn it is now. Heuristic positions
 * that are a forced win/loss within the search horizon are pinned near the
 * extremes; everything else maps through a logistic and is clamped so those
 * extremes stay reserved for genuinely decided positions.
 *
 * @param {{exact?: boolean}} [opts]  exact:false forbids the bitboard solver, so
 *   the bar stays an estimate. Required in the Pop-Out variant: the solver plays
 *   standard rules, so it would call positions "proven" that a pop can refute.
 * @returns {{1:number, 2:number}} integer percentages that sum to 100.
 */
export function winChance(board, playerToMove, depth = 6, opts = {}) {
  if (legalMoves(board).length === 0) return { [P1]: 50, [P2]: 50 };
  const opp = other(playerToMove);

  // Exact solver first: in the endgame the position solves exactly and fast, so
  // the bar reflects the true result under perfect play rather than an estimate.
  if (opts.exact !== false && countDiscs(board) >= SOLVE_MIN_DISCS) {
    const solved = solveBoard(board, playerToMove, { budget: SOLVE_BUDGET });
    if (solved) {
      const pMover = solvedProb(solved.score, solved.moves);
      const p1 = playerToMove === P1 ? pMover : 1 - pMover;
      const p1pct = Math.round(p1 * 100);
      return { [P1]: p1pct, [P2]: 100 - p1pct };
    }
  }

  // Who moved first this game? With `total` discs down it's the first mover's
  // turn when `total` is even, else the second mover's. This never changes
  // during a game and drives the odd/even threat parity in evaluateBar.
  const firstMover = countDiscs(board) % 2 === 0 ? playerToMove : opp;
  const leafEval = (b, me, op) => evaluateBar(b, me, op, firstMover);

  const v = minimax(board, depth, -Infinity, Infinity, true, playerToMove, opp, leafEval);

  let pMover;
  if (v >= WIN_SCORE) pMover = 0.985; // forced win within the horizon
  else if (v <= -WIN_SCORE) pMover = 0.015; // forced loss within the horizon
  else {
    pMover = 1 / (1 + Math.exp(-v / EVAL_K));
    pMover = Math.max(0.06, Math.min(0.94, pMover)); // reserve the extremes for decided positions
  }

  const p1 = playerToMove === P1 ? pMover : 1 - pMover;
  const p1pct = Math.round(p1 * 100);
  return { [P1]: p1pct, [P2]: 100 - p1pct };
}

// Internals exposed for the unit tests only (mirrors solver.js's __test). Lets
// the tests assert that `{ exact: false }` really falls back to plain minimax
// rather than hoping to catch the two search paths disagreeing by chance.
export const __test = { bestMinimaxMove, bestSolvedMove, HARD_DEPTH, INSANE_DEPTH, SOLVE_PICK_MIN_DISCS };
