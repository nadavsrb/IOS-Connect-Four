// Puzzle generator (dev-only; run: `node tools/gen_puzzles.mjs`). Emits js/puzzles.js.
//
// Uses the exact bitboard solver to find positions where YOU (P1, to move) can
// force a win with a *unique* key move at every step — real "play and win in N"
// puzzles — then extracts the solution line (your move, the opponent's best
// defence, your move, …) and buckets by mate depth. The committed js/puzzles.js
// is static data; nothing here ships to the client. tools/test_puzzles.mjs
// re-verifies every emitted puzzle from scratch.
//
// It is incremental: the existing js/puzzles.js is preserved verbatim (so ids —
// and therefore saved progress — stay stable) and only a *harder* pack is topped
// up to reach TOTAL. Delete js/puzzles.js to regenerate the whole set from empty.
import {
  P1, P2, ROWS, COLS, EMPTY,
  createBoard, cloneBoard, dropDisc, checkWin, legalMoves, other,
} from '../js/engine.js';
import { solveBoard } from '../js/solver.js';
import { writeFileSync } from 'node:fs';

const BUDGET = 60_000_000; // big — offline, slowness is fine; abort → skip candidate
const solve = (b, p) => solveBoard(b, p, { budget: BUDGET });

const gridStr = (b) => { let s = ''; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) s += String(b[r][c]); return s; };
const discCount = (b) => { let n = 0; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (b[r][c] !== EMPTY) n++; return n; };
const discsOf = (grid) => [...grid].filter((c) => c !== '0').length;
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
// [lo, hi]. Fuller boards solve faster; a bit more open gives room for deep mates.
function randomPositionIn(lo, hi) {
  const b = createBoard();
  let cur = P1;
  const span = Math.floor((hi - lo) / 2) + 1;
  const target = lo + 2 * Math.floor(Math.random() * span);
  for (let i = 0; i < target; i++) {
    const moves = legalMoves(b);
    if (!moves.length) return null;
    const l = dropDisc(b, moves[Math.floor(Math.random() * moves.length)], cur);
    if (checkWin(b, l.row, l.col)) return null; // already decided — unusable
    cur = other(cur);
  }
  return legalMoves(b).length ? b : null;
}

// winIn → tier name (7+ all "Mastermind"). Finer at the top for the harder pack.
const TIER = { 1: 'Warm-up', 2: 'Sharp', 3: 'Tactician', 4: 'Sniper', 5: 'Grandmaster', 6: 'Legend', 7: 'Mastermind' };
const tierName = (winIn) => TIER[Math.min(7, winIn)];

// --- Preserve the committed set verbatim (stable ids ⇒ stable saved progress). ---
let base = [];
try {
  const mod = await import('../js/puzzles.js');
  base = mod.PUZZLES.map((p) => ({ grid: p.grid, line: p.line.slice(), winIn: p.winIn, discs: discsOf(p.grid) }));
} catch { base = []; }

const seen = new Set(base.map((p) => p.grid));

// Fresh run (no committed set): build the shallow ladder (win-in 1..5) first.
if (base.length === 0) {
  const SHALLOW = { 1: 8, 2: 8, 3: 7, 4: 7, 5: 3 };
  const sb = { 1: [], 2: [], 3: [], 4: [], 5: [] };
  const needShallow = () => Object.keys(SHALLOW).some((k) => sb[k].length < SHALLOW[k]);
  const ts = Date.now();
  while (needShallow() && Date.now() - ts < 1000 * 60 * 6) {
    const b = randomPositionIn(22, 36);
    if (!b) continue;
    const key = gridStr(b);
    if (seen.has(key)) continue;
    seen.add(key);
    const root = solve(b, P1);
    if (!root || root.score <= 0) continue;
    const pv = extractPV(b);
    if (!pv || pv.winIn > 5) continue;
    if (sb[pv.winIn].length >= SHALLOW[pv.winIn]) continue;
    sb[pv.winIn].push({ grid: key, line: pv.line, winIn: pv.winIn, discs: discCount(b) });
  }
  for (const k of [1, 2, 3, 4, 5]) { sb[k].sort((a, b) => b.discs - a.discs); for (const p of sb[k]) base.push(p); }
}

// --- Harder pack: append win-in-6+ puzzles until the set reaches TOTAL. ---
const TOTAL = 56;
const CAP = 12; // max new puzzles of any single winIn value, for variety
const deep = [];
const byWin = {};
const TIME_MS = 1000 * 60 * 22;
const t0 = Date.now();
let tried = 0;
while (base.length + deep.length < TOTAL && Date.now() - t0 < TIME_MS) {
  tried++;
  const b = randomPositionIn(20, 32);
  if (!b) continue;
  const key = gridStr(b);
  if (seen.has(key)) continue;
  seen.add(key);
  const root = solve(b, P1);
  if (!root || root.score <= 0) continue;
  const pv = extractPV(b);
  if (!pv || pv.winIn < 6) continue; // the harder pack is win-in-6 and deeper
  if ((byWin[pv.winIn] || 0) >= CAP) continue;
  byWin[pv.winIn] = (byWin[pv.winIn] || 0) + 1;
  deep.push({ grid: key, line: pv.line, winIn: pv.winIn, discs: discCount(b) });
  console.error(`+win-in-${pv.winIn}: pack ${deep.length}/${TOTAL - base.length} (tried ${tried}, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

deep.sort((a, b) => (a.winIn - b.winIn) || (b.discs - a.discs));
const all = [...base, ...deep];

if (all.length < 50) {
  console.error(`\nONLY ${all.length} puzzles (base ${base.length} + deep ${deep.length}). Deep dist: ${JSON.stringify(byWin)}`);
  process.exit(1);
}

const rows = all.map((p, i) =>
  `  { id: ${i + 1}, tier: '${tierName(p.winIn)}', winIn: ${p.winIn}, grid: '${p.grid}', line: [${p.line.join(', ')}] },`
).join('\n');

const out = `// AUTO-GENERATED by tools/gen_puzzles.mjs — do not edit by hand.
//
// A progressive set of "you play and win" Connect Four puzzles, easiest first,
// ending in a harder win-in-6+ pack (tiers Legend / Mastermind).
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

writeFileSync(new URL('../js/puzzles.js', import.meta.url), out);
console.error(`\nWrote ${all.length} puzzles (base ${base.length} + harder pack ${deep.length}). Pack depth dist: ${JSON.stringify(byWin)}`);
