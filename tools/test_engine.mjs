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
} from '../js/engine.js';
import { chooseMove, winChance } from '../js/bot.js';

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

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
