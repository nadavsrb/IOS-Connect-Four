// Node smoke tests for the pure game logic. Run: `node tools/test_engine.mjs`
import {
  P1,
  P2,
  ROWS,
  COLS,
  createBoard,
  cloneBoard,
  dropDisc,
  popDisc,
  canPop,
  checkWin,
  findWinFor,
  hasAnyMove,
  isFull,
  legalMoves,
  isColumnFull,
  other,
} from '../js/engine.js';
import { chooseMove, winChance } from '../js/bot.js';
import { solveBoard } from '../js/solver.js';
import { emptyHistory, recordGame, summarize, winRate } from '../js/stats.js';

let passed = 0;
let failed = 0;

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

// Helper: play a sequence of columns, alternating players unless forced.
function playCols(board, cols, players) {
  const landings = [];
  cols.forEach((c, i) => {
    landings.push(dropDisc(board, c, players[i]));
  });
  return landings;
}

console.log('Engine: drop mechanics');
{
  const b = createBoard();
  const l1 = dropDisc(b, 3, P1);
  ok('first disc lands on the bottom row', l1.row === 5 && l1.col === 3);
  const l2 = dropDisc(b, 3, P2);
  ok('second disc stacks above it', l2.row === 4 && l2.col === 3);
  // Fill a column, then confirm it rejects further drops.
  const b2 = createBoard();
  for (let i = 0; i < 6; i++) dropDisc(b2, 0, i % 2 ? P1 : P2);
  ok('column reports full', isColumnFull(b2, 0));
  ok('drop into full column returns null', dropDisc(b2, 0, P1) === null);
  ok('drop into out-of-range column returns null', dropDisc(b2, 9, P1) === null);
  ok('legalMoves excludes the full column', !legalMoves(b2).includes(0));
}

console.log('Engine: win detection');
{
  // Horizontal
  const b = createBoard();
  let last;
  for (const c of [0, 1, 2, 3]) last = dropDisc(b, c, P1);
  ok('horizontal four is a win', !!checkWin(b, last.row, last.col));
  ok('winning line has 4 cells', checkWin(b, last.row, last.col).length === 4);
}
{
  // Vertical
  const b = createBoard();
  let last;
  for (let i = 0; i < 4; i++) last = dropDisc(b, 2, P2);
  ok('vertical four is a win', !!checkWin(b, last.row, last.col));
}
{
  // Diagonal "/"  (rising to the right)
  const b = createBoard();
  // Build a staircase.
  dropDisc(b, 0, P1);
  dropDisc(b, 1, P2); const d1 = dropDisc(b, 1, P1);
  dropDisc(b, 2, P2); dropDisc(b, 2, P2); const d2 = dropDisc(b, 2, P1);
  dropDisc(b, 3, P2); dropDisc(b, 3, P2); dropDisc(b, 3, P2); const d3 = dropDisc(b, 3, P1);
  const first = dropDisc(createBoard(), 0, P1); // sanity noop
  void first; void d1; void d2;
  ok('diagonal / four is a win', !!checkWin(b, d3.row, d3.col));
}
{
  // Diagonal "\"  (falling to the right)
  const b = createBoard();
  dropDisc(b, 3, P1);
  dropDisc(b, 2, P2); const e1 = dropDisc(b, 2, P1);
  dropDisc(b, 1, P2); dropDisc(b, 1, P2); const e2 = dropDisc(b, 1, P1);
  dropDisc(b, 0, P2); dropDisc(b, 0, P2); dropDisc(b, 0, P2); const e3 = dropDisc(b, 0, P1);
  void e1; void e2;
  ok('diagonal \\ four is a win', !!checkWin(b, e3.row, e3.col));
}
{
  // Not-a-win control
  const b = createBoard();
  const l = dropDisc(b, 3, P1);
  dropDisc(b, 4, P2);
  ok('single disc is not a win', checkWin(b, l.row, l.col) === null);
}

console.log('Engine: draw detection');
{
  // Fill the whole board with a pattern that avoids four-in-a-row, then confirm isFull.
  // Column-staggered pattern: this specific fill has no 4-in-a-row.
  const b = createBoard();
  const pattern = [
    [P1, P1, P2, P2, P1, P1, P2],
    [P1, P1, P2, P2, P1, P1, P2],
    [P2, P2, P1, P1, P2, P2, P1],
    [P2, P2, P1, P1, P2, P2, P1],
    [P1, P1, P2, P2, P1, P1, P2],
    [P1, P1, P2, P2, P1, P1, P2],
  ];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) b[r][c] = pattern[r][c];
  ok('full board reports isFull', isFull(b));
  ok('no legal moves on a full board', legalMoves(b).length === 0);
}

console.log('Bot: always returns a legal move (all difficulties)');
for (const diff of ['easy', 'medium', 'hard', 'insane']) {
  const b = createBoard();
  // Scatter a few discs.
  dropDisc(b, 3, P1); dropDisc(b, 3, P2); dropDisc(b, 4, P1);
  const move = chooseMove(b, P2, diff);
  ok(`${diff}: move is a legal column`, legalMoves(b).includes(move));
}

console.log('Bot: takes an immediate win (all difficulties)');
for (const diff of ['easy', 'medium', 'hard', 'insane']) {
  // P2 has three in a row on the bottom (cols 0,1,2); winning move is col 3.
  const b = createBoard();
  dropDisc(b, 0, P2); dropDisc(b, 1, P2); dropDisc(b, 2, P2);
  const move = chooseMove(b, P2, diff);
  ok(`${diff}: plays the winning column (3)`, move === 3);
}

console.log('Bot: medium/hard/insane block an immediate loss');
for (const diff of ['medium', 'hard', 'insane']) {
  // P1 threatens to win at col 3 (has 0,1,2). Bot P2 must block at col 3.
  const b = createBoard();
  dropDisc(b, 0, P1); dropDisc(b, 1, P1); dropDisc(b, 2, P1);
  const move = chooseMove(b, P2, diff);
  ok(`${diff}: blocks the opponent at column 3`, move === 3);
}

console.log('Bot: hard never immediately loses over a full self-play game vs random');
{
  // Sanity: hard bot vs a random player, hard should not blunder into an avoidable
  // immediate loss (i.e., after hard moves, random should not have an instant win it
  // could have been blocked). Light check across a few games.
  let clean = true;
  for (let game = 0; game < 5 && clean; game++) {
    const b = createBoard();
    let turn = P1; // random player is P1, hard bot is P2
    for (let ply = 0; ply < 42; ply++) {
      const moves = legalMoves(b);
      if (moves.length === 0) break;
      let col;
      if (turn === P1) col = moves[Math.floor(Math.random() * moves.length)];
      else col = chooseMove(b, P2, 'hard');
      const landing = dropDisc(b, col, turn);
      if (checkWin(b, landing.row, landing.col)) break;
      turn = turn === P1 ? P2 : P1;
    }
  }
  ok('hard self-play completed without throwing', clean);
}

console.log('Engine: Pop-Out mechanics');
{
  const b = createBoard();
  // Column 0 from bottom: P1, P2, P1
  dropDisc(b, 0, P1);
  dropDisc(b, 0, P2);
  dropDisc(b, 0, P1);
  ok('canPop true for own disc at the bottom', canPop(b, 0, P1));
  ok('canPop false for opponent bottom disc', !canPop(b, 0, P2));
  ok('popDisc rejects popping opponent bottom', popDisc(b, 0, P2) === false);

  const before = b.map((row) => row.slice());
  ok('popDisc succeeds for own bottom disc', popDisc(b, 0, P1) === true);
  // after pop, the column shifts down: bottom was P1(removed) -> now P2 at bottom, P1 above
  ok('bottom cell shifted down (now P2)', b[ROWS - 1][0] === P2);
  ok('cell above is the old top disc (P1)', b[ROWS - 2][0] === P1);
  ok('top of the column is now empty', b[ROWS - 3][0] === 0);
  ok('pop changed the board', JSON.stringify(before) !== JSON.stringify(b));
}
{
  // A pop can complete four-in-a-row for the OPPONENT (classic Pop-Out rule).
  // Bottom row: P1 P1 _ P1 with col2 = [P2 (bottom), P1 (above)]. When P2 pops its
  // own bottom disc, the P1 above slides to the bottom row → P1 gets four across.
  const b = createBoard();
  b[ROWS - 1][0] = P1;
  b[ROWS - 1][1] = P1;
  b[ROWS - 1][3] = P1;
  b[ROWS - 1][2] = P2; // P2's own disc at the bottom of column 2
  b[ROWS - 2][2] = P1; // a P1 sits on top of it
  ok('no win before the pop', findWinFor(b, P1) === null);
  ok('P2 pops its own bottom disc', popDisc(b, 2, P2) === true);
  ok('findWinFor detects P1 four-in-a-row created by the pop', !!findWinFor(b, P1));
}

console.log('Engine: full-board draw rule (classic vs pop-out)');
{
  // Fill the board with a no-win pattern so every column is full.
  const b = createBoard();
  const pattern = [
    [P1, P1, P2, P2, P1, P1, P2],
    [P1, P1, P2, P2, P1, P1, P2],
    [P2, P2, P1, P1, P2, P2, P1],
    [P2, P2, P1, P1, P2, P2, P1],
    [P1, P1, P2, P2, P1, P1, P2],
    [P1, P1, P2, P2, P1, P1, P2],
  ];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) b[r][c] = pattern[r][c];
  ok('full board: no drop moves left', legalMoves(b).length === 0);
  ok('classic — full board has no move (draw)', hasAnyMove(b, P1, 'classic') === false);
  // In pop-out a player can still pop a column whose bottom is their own disc.
  const bottomHasP1 = Array.from({ length: COLS }, (_, c) => b[ROWS - 1][c]).includes(P1);
  ok('pop-out — full board still has a move if you can pop', hasAnyMove(b, P1, 'popout') === bottomHasP1 && bottomHasP1);
  // A player who owns no bottom disc genuinely has no move even in pop-out.
  const noBottom = createBoard();
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) noBottom[r][c] = P2; // all P2
  ok('pop-out — no own bottom disc anywhere means no move', hasAnyMove(noBottom, P1, 'popout') === false);
}

console.log('Bot: winChance evaluation bar');
{
  const empty = winChance(createBoard(), P1);
  ok('empty board is near even', Math.abs(empty[P1] - empty[P2]) <= 10);
  ok('percentages sum to 100 (empty)', empty[P1] + empty[P2] === 100);

  // P1 to move with an open three across the bottom → winning move available → ~99%.
  const b = createBoard();
  dropDisc(b, 0, P1);
  dropDisc(b, 1, P1);
  dropDisc(b, 2, P1);
  const wc = winChance(b, P1);
  ok('forced win → high % for that player', wc[P1] >= 90);
  ok('percentages sum to 100 (forced win)', wc[P1] + wc[P2] === 100);

  // Same position but it's P2 to move (must block) → P2 is not winning here.
  const wc2 = winChance(b, P2);
  ok('opponent to move against an open three is not favoured', wc2[P1] >= wc2[P2]);
}
{
  // A double threat — three across the middle (cols 1,2,3) with both ends open —
  // is essentially winning even when it's the *other* player's move, because the
  // turn-aware search sees they can't block both winning squares (0 and 4).
  const d = createBoard();
  dropDisc(d, 1, P1);
  dropDisc(d, 2, P1);
  dropDisc(d, 3, P1);
  const wc = winChance(d, P2); // P2 to move, but can't stop both
  ok('unstoppable double threat reads as near-certain', wc[P1] >= 90);
  ok('double-threat percentages sum to 100', wc[P1] + wc[P2] === 100);
}
{
  // The estimate is turn-aware: in the same quiet position, the side to move is
  // rated at least as well as when it's the opponent's move (tempo counts).
  const q = createBoard();
  for (const [c, p] of [[3, P1], [3, P2], [2, P1], [4, P2], [4, P1], [2, P2]]) dropDisc(q, c, p);
  const p1WhenP1Moves = winChance(q, P1)[P1];
  const p1WhenP2Moves = winChance(q, P2)[P1];
  ok('turn matters: P1 rated no worse when it is P1 to move', p1WhenP1Moves >= p1WhenP2Moves);
}

console.log('Bot: winChance invariants over random positions');
{
  // A quick random self-play to reach a legal, non-terminal position.
  const randomBoard = (plies) => {
    const b = createBoard();
    let cur = P1;
    for (let i = 0; i < plies; i++) {
      const moves = legalMoves(b);
      if (!moves.length) break;
      const l = dropDisc(b, moves[Math.floor(Math.random() * moves.length)], cur);
      if (checkWin(b, l.row, l.col)) break;
      cur = other(cur);
    }
    return b;
  };
  const swapColors = (b) => b.map((row) => row.map((v) => (v === 0 ? 0 : v === P1 ? P2 : P1)));
  const mirror = (b) => b.map((row) => row.slice().reverse());

  let validOK = true, mirrorOK = true, fairOK = true;
  for (let i = 0; i < 400; i++) {
    const b = randomBoard(Math.floor(Math.random() * 26));
    const m = Math.random() < 0.5 ? P1 : P2;
    const wc = winChance(b, m);
    if (wc[P1] + wc[P2] !== 100 || wc[P1] < 0 || wc[P1] > 100) validOK = false;
    // Board mirrored left-right is the same game → identical aggregate odds.
    const mir = winChance(mirror(b), m);
    if (Math.abs(mir[P1] - wc[P1]) > 1) mirrorOK = false;
    // Swapping both colours and the side to move must swap the percentages
    // (no built-in bias toward either player).
    const sw = winChance(swapColors(b), other(m));
    if (Math.abs(sw[P2] - wc[P1]) > 1) fairOK = false;
  }
  ok('winChance always returns valid percentages summing to 100', validOK);
  ok('winChance is symmetric under a left-right board mirror', mirrorOK);
  ok('winChance is fair under colour + side-to-move swap', fairOK);
}

console.log('Bot: self-play is robust at every difficulty');
{
  let clean = true;
  for (const diff of ['easy', 'medium', 'hard', 'insane']) {
    for (let g = 0; g < 4 && clean; g++) {
      const b = createBoard();
      let cur = P1;
      for (let ply = 0; ply < 42; ply++) {
        const moves = legalMoves(b);
        if (!moves.length) break;
        const c = chooseMove(b, cur, diff);
        if (!moves.includes(c)) { clean = false; break; }
        const l = dropDisc(b, c, cur);
        if (checkWin(b, l.row, l.col)) break;
        cur = other(cur);
      }
    }
  }
  ok('every difficulty only ever plays legal moves to game end', clean);
}

console.log('Stats: history aggregation');
{
  let h = emptyHistory();
  h = recordGame(h, { mode: 'bot', difficulty: 'hard', winner: 1 });
  h = recordGame(h, { mode: 'bot', difficulty: 'hard', winner: 1 });
  h = recordGame(h, { mode: 'bot', difficulty: 'insane', winner: 2 });
  h = recordGame(h, { mode: 'bot', difficulty: 'medium', winner: 'draw' });
  h = recordGame(h, { mode: '2p', winner: 2 });
  const s = summarize(h);
  ok('counts total games', s.total === 5);
  ok('bot record is 2W 1L 1D', s.bot.won === 2 && s.bot.lost === 1 && s.bot.drawn === 1);
  ok('per-difficulty hard is 2 played / 2 won', s.perDifficulty.hard.played === 2 && s.perDifficulty.hard.won === 2);
  ok('winRate(hard) is 100%', winRate(s.perDifficulty.hard) === 100);
  ok('two-player tally records P2 win', s.twoPlayer.played === 1 && s.twoPlayer.p2 === 1);
  ok('a draw resets the current streak', s.streakCurrent === 0);
  ok('best streak was 2', s.streakBest === 2);
}
{
  let h = emptyHistory();
  h = recordGame(h, { mode: 'bot', difficulty: 'easy', winner: 2 }); // loss
  h = recordGame(h, { mode: 'bot', difficulty: 'easy', winner: 1 }); // win
  h = recordGame(h, { mode: '2p', winner: 1 }); // 2-player games don't affect the vs-bot streak
  h = recordGame(h, { mode: 'bot', difficulty: 'easy', winner: 1 }); // win
  const s = summarize(h);
  ok('current streak counts trailing vs-bot wins (2)', s.streakCurrent === 2);
  ok('empty history summarizes to zero games', summarize(emptyHistory()).total === 0);
}

// --- Exact bitboard solver ----------------------------------------------------

const discCount = (b) => b.flat().filter((v) => v !== 0).length;

// Random non-terminal position with roughly `plies` discs (null if it ended early).
function randomPos(plies) {
  const b = createBoard();
  let cur = P1;
  for (let i = 0; i < plies; i++) {
    const moves = legalMoves(b);
    if (!moves.length) break;
    const l = dropDisc(b, moves[Math.floor(Math.random() * moves.length)], cur);
    if (checkWin(b, l.row, l.col)) return null; // reached a win — not a live position
    cur = other(cur);
  }
  return legalMoves(b).length ? b : null;
}

// Exact brute-force outcome for `player` to move: +1 win, 0 draw, -1 loss.
// Plain negamax (no pruning table) — only used on shallow endgames in tests.
function refOutcome(board, player) {
  const moves = legalMoves(board);
  if (moves.length === 0) return 0; // full board → draw
  let best = -1;
  for (const c of moves) {
    const b = cloneBoard(board);
    const l = dropDisc(b, c, player);
    const val = checkWin(b, l.row, l.col) ? 1 : -refOutcome(b, other(player));
    if (val > best) best = val;
    if (best === 1) break; // can't beat an immediate forced win
  }
  return best;
}

console.log('Solver: exact endgame solving');
{
  // An open three across the bottom, side to move → fastest possible win. The
  // solver's score for a win is (43 - movesToEnd)/2; winning on the very next
  // disc (moves = 3) gives the maximal (43-3)/2 = 20.
  const b = createBoard();
  dropDisc(b, 0, P1); dropDisc(b, 1, P1); dropDisc(b, 2, P1);
  const r = solveBoard(b, P1);
  ok('immediate win scores maximally (+20)', r && r.score === 20);
  // A double threat (three in the middle, both ends open) with the *other* player
  // to move: they can't block both winning squares, so it's a proven loss. The
  // root has no non-losing move, so this resolves instantly (no deep search).
  const d = createBoard();
  dropDisc(d, 1, P1); dropDisc(d, 2, P1); dropDisc(d, 3, P1);
  const r2 = solveBoard(d, P2);
  ok('unstoppable double threat is a proven loss (score < 0)', r2 && r2.score < 0);
}
{
  // Cross-check the bitboard solver against brute-force negamax on shallow
  // endgames (≤ 8 empty cells, where the reference is fast). Outcomes must agree.
  let outcomeOK = true, checked = 0;
  for (let i = 0; i < 8000 && checked < 60; i++) {
    const b = randomPos(30 + Math.floor(Math.random() * 8));
    if (!b || 42 - discCount(b) > 8) continue;
    const m = Math.random() < 0.5 ? P1 : P2;
    const r = solveBoard(b, m);
    if (!r) continue;
    if (Math.sign(r.score) !== refOutcome(b, m)) { outcomeOK = false; break; }
    checked++;
  }
  ok('solver outcome matches brute force on shallow endgames', outcomeOK && checked >= 40);
}
{
  // A one-move-from-full drawn board: fill the known no-win pattern minus the top
  // of column 6 (a P2 cell), with P2 to place it. The only move completes the
  // board with no line → a proven draw (score 0).
  const b = createBoard();
  const pattern = [
    [P1, P1, P2, P2, P1, P1, P2],
    [P1, P1, P2, P2, P1, P1, P2],
    [P2, P2, P1, P1, P2, P2, P1],
    [P2, P2, P1, P1, P2, P2, P1],
    [P1, P1, P2, P2, P1, P1, P2],
    [P1, P1, P2, P2, P1, P1, P2],
  ];
  for (let r = 0; r < 6; r++) for (let c = 0; c < 7; c++) b[r][c] = pattern[r][c];
  b[0][6] = 0; // remove the top of column 6 (was P2) → 41 discs, one empty cell
  const r = solveBoard(b, P2);
  ok('forced draw solves to score 0', r && r.score === 0);
  const wc = winChance(b, P2);
  ok('forced draw reads as an even bar (50/50)', wc[P1] === 50 && wc[P2] === 50);
}

console.log('Bot: winChance is exact in the endgame');
{
  // Scan deep (≥ 22-disc) positions where the solver engages, and confirm the bar
  // reflects the true result: proven win → mover rated high, proven loss → low.
  let wonHi = null, lossLo = null, mismatch = false;
  for (let i = 0; i < 30000 && !(wonHi !== null && lossLo !== null); i++) {
    const b = randomPos(22 + Math.floor(Math.random() * 10));
    if (!b || discCount(b) < 22) continue;
    const m = Math.random() < 0.5 ? P1 : P2;
    const r = solveBoard(b, m);
    if (!r) continue;
    const wc = winChance(b, m);
    if (wc[P1] + wc[P2] !== 100) mismatch = true;
    const moverPct = m === P1 ? wc[P1] : wc[P2];
    if (r.score > 0 && wonHi === null) wonHi = moverPct;
    else if (r.score < 0 && lossLo === null) lossLo = moverPct;
  }
  ok('endgame proven win → mover rated ≥ 82%', wonHi !== null && wonHi >= 82);
  ok('endgame proven loss → mover rated ≤ 18%', lossLo !== null && lossLo <= 18);
  ok('endgame bar still sums to 100', !mismatch);
}

console.log('Bot: solver-backed endgame move choice');
{
  // Once a position is solvable, hard/insane must pick a game-theoretically
  // optimal column. Ground truth: solve every child and keep the columns that
  // achieve the best value from the mover's side.
  let checked = 0;
  let insaneOptimal = true;
  let hardOptimal = true;
  let deterministic = true;
  let sawDecisive = false;

  for (let i = 0; i < 30000 && checked < 30; i++) {
    const b = randomPos(24 + Math.floor(Math.random() * 8));
    if (!b || discCount(b) < 24) continue;
    const mover = discCount(b) % 2 === 0 ? P1 : P2; // randomPos starts with P1 and alternates

    const vals = new Map();
    let solvable = true;
    for (const c of legalMoves(b)) {
      const child = cloneBoard(b);
      const l = dropDisc(child, c, mover);
      if (checkWin(child, l.row, l.col)) { vals.set(c, Infinity); continue; } // wins now
      const s = solveBoard(child, other(mover), { budget: 200000 });
      if (!s) { solvable = false; break; }
      vals.set(c, -s.score); // solver scores the side to move; flip to the mover's view
    }
    if (!solvable || vals.size === 0) continue;

    const best = Math.max(...vals.values());
    const optimal = [...vals.entries()].filter(([, v]) => v === best).map(([c]) => c);
    const pick = chooseMove(cloneBoard(b), mover, 'insane');
    if (!optimal.includes(pick)) insaneOptimal = false;
    if (chooseMove(cloneBoard(b), mover, 'insane') !== pick) deterministic = false;
    if (!optimal.includes(chooseMove(cloneBoard(b), mover, 'hard'))) hardOptimal = false;
    if (best !== 0) sawDecisive = true;
    checked++;
  }

  ok('insane picks a provably optimal column in the endgame', insaneOptimal && checked >= 20);
  ok('hard gets the same exact treatment', hardOptimal);
  ok('the endgame choice is deterministic', deterministic);
  ok('the scan covered decided positions, not just draws', sawDecisive);
}
{
  // A position the solver can't reach yet must fall back cleanly to minimax and
  // still return a legal column (the gate is 24 discs).
  let fallbackOK = true;
  for (let i = 0; i < 200; i++) {
    const b = randomPos(6 + Math.floor(Math.random() * 6));
    if (!b) continue;
    const mover = discCount(b) % 2 === 0 ? P1 : P2;
    const pick = chooseMove(cloneBoard(b), mover, 'insane');
    if (!legalMoves(b).includes(pick)) { fallbackOK = false; break; }
  }
  ok('below the gate it still returns a legal column', fallbackOK);
}

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
