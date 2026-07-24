// Verifies the shipped puzzle set (js/puzzles.js) from scratch with the exact
// solver — no trust in the generator. Run: `node tools/test_puzzles.mjs`.
import {
  P1, P2, ROWS, COLS, EMPTY,
  createBoard, cloneBoard, dropDisc, checkWin, legalMoves,
} from '../js/engine.js';
import { solveBoard } from '../js/solver.js';
import { PUZZLES } from '../js/puzzles.js';

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${name}`); }
}

const solve = (b, p) => solveBoard(b, p, { budget: 60_000_000 });
const TIER_WIN = { 'Warm-up': 1, 'Sharp': 2, 'Tactician': 3, 'Sniper': 4, 'Grandmaster': 5, 'Legend': 6, 'Mastermind': 7 };

// Grid → board; also returns per-cell counts. Grid is row-major top→bottom.
function decode(grid) {
  const board = createBoard();
  const counts = { 1: 0, 2: 0 };
  for (let i = 0; i < grid.length; i++) {
    const v = Number(grid[i]);
    const r = Math.floor(i / COLS);
    const c = i % COLS;
    board[r][c] = v;
    if (v === P1) counts[1]++;
    else if (v === P2) counts[2]++;
  }
  return { board, counts };
}

// Columns P1 can play to force a win at `b` (P1 to move). Independent re-derivation.
function winningMovesP1(b) {
  const wins = [];
  for (const c of legalMoves(b)) {
    const child = cloneBoard(b);
    const l = dropDisc(child, c, P1);
    if (checkWin(child, l.row, l.col)) { wins.push(c); continue; }
    const r = solve(child, P2);
    if (r && r.score < 0) wins.push(c);
  }
  return wins;
}

// P2's most-delaying replies: those minimising P1's score. Used to prove the
// scripted opponent moves are a real best defence — without this a puzzle could
// advertise "win in 3" while the opponent simply gave up early.
function bestDefenceCols(b) {
  let best = Infinity;
  const scored = [];
  for (const c of legalMoves(b)) {
    const child = cloneBoard(b);
    const l = dropDisc(child, c, P2);
    if (checkWin(child, l.row, l.col)) return [c]; // P2 wins outright — nothing delays longer
    const r = solve(child, P1);
    if (!r) return null;
    scored.push([c, r.score]);
    if (r.score < best) best = r.score;
  }
  return scored.filter(([, s]) => s === best).map(([c]) => c);
}

const discCount = (b) => b.flat().filter((v) => v !== EMPTY).length;

function anyFour(board) {
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (board[r][c] !== EMPTY && checkWin(board, r, c)) return true;
  }
  return false;
}

console.log('Puzzles: data integrity + provable solutions');

ok('at least 50 puzzles', PUZZLES.length >= 50);
ok('has a harder win-in-6+ pack (20+)', PUZZLES.filter((p) => p.winIn >= 6).length >= 20);

let prevWinIn = 0;
let idsSequential = true;
let orderedByDifficulty = true;

for (const pz of PUZZLES) {
  const tag = `#${pz.id} (${pz.tier}, win-in-${pz.winIn})`;
  if (pz.id !== PUZZLES.indexOf(pz) + 1) idsSequential = false;
  // Difficulty never drops as you go — except when entering the harder win-in-6+
  // pack, which is appended after the base ladder and then ramps up again.
  if (pz.winIn < prevWinIn && pz.winIn < 6) orderedByDifficulty = false;
  prevWinIn = pz.winIn;

  // Grid shape + legality.
  const validChars = typeof pz.grid === 'string' && pz.grid.length === ROWS * COLS && /^[012]+$/.test(pz.grid);
  ok(`${tag}: grid is 42 chars of 0/1/2`, validChars);
  if (!validChars) continue;

  const { board, counts } = decode(pz.grid);

  // Gravity — no floating discs (a filled cell needs the one below it filled).
  let gravityOK = true;
  for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS; c++) {
    if (board[r][c] !== EMPTY && board[r + 1][c] === EMPTY) gravityOK = false;
  }
  ok(`${tag}: obeys gravity (no floating discs)`, gravityOK);

  // P1 to move ⇒ equal disc counts.
  ok(`${tag}: equal disc counts (P1 to move)`, counts[1] === counts[2]);

  // Non-terminal start with moves available.
  ok(`${tag}: start is non-terminal`, !anyFour(board) && legalMoves(board).length > 0);

  // Tier label matches winIn (5 = 5-or-more).
  ok(`${tag}: tier matches winIn`, TIER_WIN[pz.tier] === Math.min(7, pz.winIn));
  ok(`${tag}: winIn matches line length`, pz.winIn === Math.ceil(pz.line.length / 2));

  // Walk the solution: each P1 move must be the UNIQUE winning move; opponent
  // replies must be legal; the final P1 move must complete four.
  // The advertised mate distance, straight from the solver score. For P1 to move
  // with `d` discs down and score `s`, the win lands on P1's (22 - d/2 - s)-th
  // move — so this pins winIn exactly, independent of the line the generator chose.
  const root = solve(board, P1);
  ok(`${tag}: winIn matches the solver's exact mate distance`,
    !!root && 22 - discCount(board) / 2 - root.score === pz.winIn);

  const b = cloneBoard(board);
  let cur = P1;
  let solutionOK = true;
  let uniqueOK = true;
  let repliesOK = true;
  let defenceOK = true;
  let wonAtStep = -1;
  for (let step = 0; step < pz.line.length; step++) {
    const col = pz.line[step];
    if (!legalMoves(b).includes(col)) { solutionOK = false; break; }
    if (cur === P1) {
      const wins = winningMovesP1(b);
      if (wins.length !== 1 || wins[0] !== col) uniqueOK = false;
      const l = dropDisc(b, col, P1);
      if (checkWin(b, l.row, l.col)) { wonAtStep = step; }
      cur = P2;
    } else {
      const defences = bestDefenceCols(b);
      if (!defences || !defences.includes(col)) defenceOK = false;
      dropDisc(b, col, P2);
      if (step === pz.line.length - 1) repliesOK = false; // line must end on P1's winning move
      cur = P1;
    }
  }
  ok(`${tag}: every move in the line is legal`, solutionOK);
  ok(`${tag}: each of your moves is the ONLY winning move`, uniqueOK);
  ok(`${tag}: the opponent always plays a best defence`, defenceOK);
  // The four must land on the LAST move — not earlier, which would mean the
  // stored line runs past the win and overstates winIn.
  ok(`${tag}: the line ends on your four-in-a-row`, wonAtStep === pz.line.length - 1 && repliesOK);
}

ok('ids are sequential 1..N', idsSequential);
ok('puzzles are ordered easiest → hardest', orderedByDifficulty);

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
