// Puzzle generator (dev-only; run: `node tools/gen_puzzles.mjs`). Emits js/puzzles.js.
//
// Uses the exact bitboard solver to find positions where YOU (P1, to move) can
// force a win with a *unique* key move at every step — real "play and win in N"
// puzzles — then extracts the solution line (your move, the opponent's best
// defence, your move, …) and buckets by mate depth. The committed js/puzzles.js
// is static data; nothing here ships to the client. tools/test_puzzles.mjs
// re-verifies every emitted puzzle from scratch.
import {
  P1, P2, ROWS, COLS, EMPTY,
  createBoard, cloneBoard, dropDisc, checkWin, legalMoves, other,
} from '../js/engine.js';
import { solveBoard } from '../js/solver.js';
import { writeFileSync } from 'node:fs';

const BUDGET = 40_000_000; // big — offline, slowness is fine; abort → skip candidate
const solve = (b, p) => solveBoard(b, p, { budget: BUDGET });

const gridStr = (b) => { let s = ''; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) s += String(b[r][c]); return s; };
const discCount = (b) => { let n = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (b[r][c] !== EMPTY) n++; return n; };
const centreDist = (c) => Math.abs(3 - c);

// Columns P1 can play at `b` (P1 to move) that force a win (immediate four, or a
// drop after which P2 is lost). null if a solve aborted.
function winningMovesP1(b) {
  const wins = [];
  for (const c of legalMoves(b)) {
    const child = cloneBoard(b);
    const l = dropDisc(child, c, P1);
    if (checkWin(child, l.row, l.col)) { wins.push(c); continue; }
    const r = solve(child, P2);
    if (!r) return null;
    if (r.score < 0) wins.push(c); // P2 loses ⇒ this move wins for P1
  }
  return wins;
}

// P2's best defence at `b` (P2 to move, already lost): the reply that makes P1's
// win take longest (smallest P1 score), centre-most as a deterministic tiebreak.
function bestDefenceP2(b) {
  let best = null, bestScore = Infinity, bestCd = Infinity;
  for (const c of legalMoves(b)) {
    const child = cloneBoard(b);
    const l = dropDisc(child, c, P2);
    if (checkWin(child, l.row, l.col)) continue; // P2 winning contradicts "lost" — ignore
    const r = solve(child, P1);
    if (!r) return null;
    const cd = centreDist(c);
    if (r.score < bestScore || (r.score === bestScore && cd < bestCd)) { bestScore = r.score; bestCd = cd; best = c; }
  }
  return best;
}

// From a P1-to-move winning position, extract the unique-key-move solution line.
// Returns { line, winIn } or null if any step isn't a single forced win.
function extractPV(board) {
  const line = [];
  const b = cloneBoard(board);
  let cur = P1;
  for (let guard = 0; guard < 60; guard++) {
    if (cur === P1) {
      const wins = winningMovesP1(b);
      if (wins === null || wins.length !== 1) return null; // must be the *only* winning move
      const c = wins[0];
      const l = dropDisc(b, c, P1);
      line.push(c);
      if (checkWin(b, l.row, l.col)) return { line, winIn: Math.ceil(line.length / 2) };
      cur = P2;
    } else {
      const c = bestDefenceP2(b);
      if (c === null) return null;
      dropDisc(b, c, P2);
      line.push(c);
      cur = P1;
    }
  }
  return null;
}

// A random legal, non-terminal, P1-to-move position with an even disc count in
// [22, 36] (kept full enough that every solver call is fast).
function randomPosition() {
  const b = createBoard();
  let cur = P1;
  const target = 22 + 2 * Math.floor(Math.random() * 8); // even 22..36
  for (let i = 0; i < target; i++) {
    const moves = legalMoves(b);
    if (!moves.length) return null;
    const c = moves[Math.floor(Math.random() * moves.length)];
    const l = dropDisc(b, c, cur);
    if (checkWin(b, l.row, l.col)) return null; // already decided — unusable
    cur = other(cur);
  }
  return legalMoves(b).length ? b : null;
}

const TIER = { 1: 'Warm-up', 2: 'Sharp', 3: 'Tactician', 4: 'Sniper', 5: 'Grandmaster' };
const TARGET = { 1: 8, 2: 8, 3: 7, 4: 7, 5: 6 }; // per bucket (5 = win-in-5-or-more)
const bucketOf = (winIn) => (winIn >= 5 ? 5 : winIn);
const buckets = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const need = () => Object.keys(TARGET).some((k) => buckets[k].length < TARGET[k]);

const seen = new Set();
const TIME_MS = 1000 * 60 * 10;
const t0 = Date.now();
let tried = 0;

while (need() && Date.now() - t0 < TIME_MS) {
  tried++;
  const b = randomPosition();
  if (!b) continue;
  const key = gridStr(b);
  if (seen.has(key)) continue;
  seen.add(key);
  const root = solve(b, P1);
  if (!root || root.score <= 0) continue; // not a forced win for P1
  const pv = extractPV(b);
  if (!pv) continue;
  const bk = bucketOf(pv.winIn);
  if (buckets[bk].length >= TARGET[bk]) continue;
  buckets[bk].push({ grid: key, line: pv.line, winIn: pv.winIn, discs: discCount(b) });
  console.error(`win-in-${pv.winIn} → bucket ${bk}: ${buckets[bk].length}/${TARGET[bk]} (tried ${tried}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// Order easiest → hardest: by winIn, then fuller boards first within a tier.
const all = [];
for (const k of [1, 2, 3, 4, 5]) {
  buckets[k].sort((a, b) => b.discs - a.discs);
  for (const p of buckets[k]) all.push(p);
}

if (all.length < 30) {
  console.error(`\nONLY ${all.length} puzzles — need ≥ 30. Distribution: ` +
    [1, 2, 3, 4, 5].map((k) => `${k}:${buckets[k].length}`).join(' '));
  process.exit(1);
}

const rows = all.map((p, i) =>
  `  { id: ${i + 1}, tier: '${TIER[bucketOf(p.winIn)]}', winIn: ${p.winIn}, grid: '${p.grid}', line: [${p.line.join(', ')}] },`
).join('\n');

const out = `// AUTO-GENERATED by tools/gen_puzzles.mjs — do not edit by hand.
//
// A progressive set of "you play and win" Connect Four puzzles, easiest first.
// In every puzzle YOU are P1 (red) and it's your move; the opponent is P2 (yellow).
//   grid  — 42 chars, row-major top→bottom, left→right; '0' empty, '1' you, '2' opponent.
//   line  — the unique solution: [yourCol, oppReplyCol, yourCol, …]. The opponent's
//           replies are its best defence; every one of your moves in the line is the
//           *only* move that keeps the win, so any other move is simply wrong.
//   winIn — how many of your moves reach four-in-a-row against best defence.
// Provably correct — tools/test_puzzles.mjs re-solves each one from scratch.
export const PUZZLES = [
${rows}
];
`;

const path = new URL('../js/puzzles.js', import.meta.url);
writeFileSync(path, out);
console.error(`\nWrote ${all.length} puzzles to js/puzzles.js  (tiers ` +
  [1, 2, 3, 4, 5].map((k) => `${TIER[k]}:${buckets[k].length}`).join(', ') + ')');
