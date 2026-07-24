// Connect Four — pure post-game review: turns a per-position win-% series into
// blunder/mistake flags and an accuracy score per player. No DOM, no storage
// (like engine.js / bot.js / stats.js), so it's unit-testable under Node.
//
// The input is one number per position: Player 1's win chance (0–100) at that
// point, from evals[0] (empty board) through evals[n] (final position). The move
// played at index i is judged by how much of *the mover's own* win chance it gave
// away: their percentage before the move minus their percentage after it.

// How many percentage points a single move has to give away to be flagged.
export const BLUNDER_LOSS = 25;
export const MISTAKE_LOSS = 12;

// Player 1's percentage flipped to whoever we're asking about.
export function evalForPlayer(p1pct, player) {
  return player === 1 ? p1pct : 100 - p1pct;
}

export function classifyLoss(loss) {
  if (loss >= BLUNDER_LOSS) return 'blunder';
  if (loss >= MISTAKE_LOSS) return 'mistake';
  return null;
}

// Player to move at position `index` — moves alternate from whoever started.
export function moverAt(index, startingPlayer = 1) {
  const other = startingPlayer === 1 ? 2 : 1;
  return index % 2 === 0 ? startingPlayer : other;
}

// evals: p1 win-% per position (length n+1 for an n-move game).
// Returns per-move judgements plus per-player counts and an accuracy score.
export function summarizeReview(evals, startingPlayer = 1) {
  const series = Array.isArray(evals) ? evals : [];
  const perMove = [];
  const counts = { 1: { blunders: 0, mistakes: 0 }, 2: { blunders: 0, mistakes: 0 } };
  const losses = { 1: [], 2: [] };

  for (let i = 0; i + 1 < series.length; i++) {
    const mover = moverAt(i, startingPlayer);
    const before = evalForPlayer(series[i], mover);
    const after = evalForPlayer(series[i + 1], mover);
    const loss = Math.round(before - after);
    const kind = classifyLoss(loss);
    if (kind === 'blunder') counts[mover].blunders++;
    else if (kind === 'mistake') counts[mover].mistakes++;
    losses[mover].push(Math.max(0, loss)); // gains don't earn accuracy credit
    perMove.push({ index: i, moveNo: i + 1, mover, loss, kind });
  }

  return {
    perMove,
    counts,
    accuracy: { 1: accuracyOf(losses[1]), 2: accuracyOf(losses[2]) },
    // Just the flagged moves, worst first — what the review screen lists.
    moments: perMove.filter((m) => m.kind).sort((a, b) => b.loss - a.loss),
  };
}

// 100 minus the average points given away, clamped to 0–100. A player who never
// gave anything away (or never moved) scores 100.
function accuracyOf(losses) {
  if (losses.length === 0) return 100;
  const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
  return Math.max(0, Math.min(100, Math.round(100 - mean)));
}
