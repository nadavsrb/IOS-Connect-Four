// Verifies the shipped Tactics curriculum (js/tactics.js) from scratch — the
// generator is not trusted. Run: `node tools/test_tactics.mjs`.
//
// The important claim each drill makes is "the move I am teaching is the only
// move that works", because that is what lets the app tell you a different move
// is wrong. So every drill is re-solved here with the exact bitboard solver, and
// on top of that each tactic's own shape is re-derived independently: a fork
// really does leave two reachable winning squares, a stack really does put two of
// them in one column, a poisoned column really does hand the opponent four.
import {
  P1, P2, ROWS, COLS, EMPTY,
  createBoard, cloneBoard, dropDisc, checkWin, legalMoves, landingRow, winningSquares,
} from '../js/engine.js';
import {
  playableNow, openThreats, afterDrop, colsWinningNow, threatDirs, poisonedCols, forkCols,
} from '../js/patterns.js';
import { solveBoard } from '../js/solver.js';
import { TACTICS } from '../js/tactics.js';

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${name}`); }
}

const solve = (b, p) => solveBoard(b, p, { budget: 60_000_000 });

function decode(grid) {
  const board = createBoard();
  const counts = { 1: 0, 2: 0 };
  for (let i = 0; i < grid.length; i++) {
    const v = Number(grid[i]);
    board[Math.floor(i / COLS)][i % COLS] = v;
    if (v === P1) counts[1]++;
    else if (v === P2) counts[2]++;
  }
  return { board, counts };
}

// Gravity: a disc can only sit on the floor or on another disc.
function floats(board) {
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== EMPTY && board[r + 1][c] === EMPTY) return true;
    }
  }
  return false;
}

// The solver's verdict on every legal move, from P1's point of view.
function scores(board) {
  const per = new Map();
  for (const c of legalMoves(board)) {
    const d = afterDrop(board, c, P1);
    if (checkWin(d.child, d.row, d.col)) { per.set(c, 99); continue; }
    const r = solve(d.child, P2);
    per.set(c, r ? -r.score : null);
  }
  return per;
}

const sorted = (a) => [...a].sort((x, y) => x - y);
const same = (a, b) => a.length === b.length && sorted(a).every((v, i) => v === sorted(b)[i]);

function checkWinAnywhere(board) {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board[r][c] !== EMPTY && checkWin(board, r, c)) return true;
    }
  }
  return false;
}

function newSquares(before, after) {
  const had = new Set(winningSquares(before, P1).map(([r, c]) => `${r},${c}`));
  return winningSquares(after, P1).filter(([r, c]) => !had.has(`${r},${c}`));
}

console.log('Tactics: curriculum shape + solver-proven drills\n');

// --- the curriculum itself ---------------------------------------------------
ok('ten tactics ship', TACTICS.length === 10);
ok('ids are unique', new Set(TACTICS.map((t) => t.id)).size === TACTICS.length);

for (const t of TACTICS) {
  const tag = `[${t.id}]`;
  ok(`${tag} has a name, an idea and drill prose`,
    !!t.name && !!t.idea && !!t.ask && !!t.why && !!t.nudge);
  ok(`${tag} has a closing line`, typeof t.close === 'string' && t.close.length > 30);
  // The name goes in the topbar, which is one line wide on a phone.
  ok(`${tag} name is short enough for the topbar`, t.name.length <= 24);
  ok(`${tag} has at least 3 lesson pages`, Array.isArray(t.lesson) && t.lesson.length >= 3);
  ok(`${tag} has at least 2 drills`, Array.isArray(t.drills) && t.drills.length >= 2);

  // Lesson pages: every one shows a legal board and only points at empty squares.
  t.lesson.forEach((p, i) => {
    const { board } = decode(p.grid);
    ok(`${tag} page ${i + 1} grid is 42 cells`, p.grid.length === ROWS * COLS);
    ok(`${tag} page ${i + 1} obeys gravity`, !floats(board));
    ok(`${tag} page ${i + 1} says something`, typeof p.say === 'string' && p.say.length > 20);
    (p.marks || []).forEach(([r, c]) => {
      ok(`${tag} page ${i + 1} marks the empty square ${r},${c}`,
        r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r][c] === EMPTY);
    });
    (p.cols || []).forEach((c) => ok(`${tag} page ${i + 1} column ${c} exists`, c >= 0 && c < COLS));
    (p.rows || []).forEach((r) => ok(`${tag} page ${i + 1} row ${r} exists`, r >= 0 && r < ROWS));
  });

  // Drills: legal position, your move, and the taught move is the only one.
  t.drills.forEach((d, i) => {
    const label = `${tag} drill ${i + 1}`;
    const { board, counts } = decode(d.grid);
    ok(`${label} grid is 42 cells`, d.grid.length === ROWS * COLS);
    ok(`${label} obeys gravity`, !floats(board));
    // Red is always you and always to move. Equal discs means you opened; one
    // fewer means they did — which is exactly what the second-player lesson needs.
    const youOpened = counts[1] === counts[2];
    ok(`${label} is red's move`, youOpened || counts[1] === counts[2] - 1);
    ok(`${label} is on the right side of the move order`,
      t.id === 'claimeven' ? !youOpened : youOpened);
    ok(`${label} is not already won`, !checkWinAnywhere(board));
    ok(`${label} has a legal answer`, d.good.length > 0 && d.good.every((c) => landingRow(board, c) >= 0));
    ok(`${label} isn't a one-move giveaway`, colsWinningNow(board, P1).length === 0);

    const per = scores(board);
    ok(`${label} solved inside the budget`, [...per.values()].every((v) => v !== null));

    // The shipped per-column verdicts are what the app judges your move against,
    // so they have to match a solve done here from scratch — including which
    // columns are full.
    ok(`${label} 'values' matches a fresh solve`,
      Array.isArray(d.values) && d.values.length === COLS &&
      d.values.every((v, c) => (per.has(c) ? v === per.get(c) : v === null)));
    // And the move being taught has to be the best of them, or "as good as the
    // teacher's move" would let a worse move through.
    ok(`${label} the taught move scores highest`,
      d.values[d.good[0]] === Math.max(...d.values.filter((v) => v != null)));
    const wins = [...per.entries()].filter(([, v]) => v > 0).map(([c]) => c);
    const survives = [...per.entries()].filter(([, v]) => v >= 0).map(([c]) => c);
    // An attacking tactic must be the only winning move; a defensive one the only
    // move that doesn't lose. Either way, every other column is provably wrong.
    ok(`${label} the taught move is the only one that works`,
      same(wins, d.good) || (wins.length === 0 && same(survives, d.good)));

    // 'show' is what the teacher lights up after your move, so every one of those
    // squares has to still be empty there and really be a winning square for you.
    const d0 = afterDrop(board, d.good[0], P1);
    const winning = new Set(winningSquares(d0.child, P1).map(([r, c]) => `${r},${c}`));
    ok(`${label} 'show' points only at real threats`,
      Array.isArray(d.show) && d.show.every(([r, c]) =>
        d0.child[r][c] === EMPTY && winning.has(`${r},${c}`)));

    // 'follow' promises the app can play the win out — every reply must leave a four.
    const forced = legalMoves(d0.child).length > 0 && legalMoves(d0.child).every((x) => {
      const e = afterDrop(d0.child, x, P2);
      return !checkWin(e.child, e.row, e.col) && colsWinningNow(e.child, P1).length > 0;
    });
    ok(`${label} 'follow' matches the position`, !!d.follow === forced);

    // A convert drill is played out live, so it has to be a win worth carrying
    // and full enough that solving each of your moves stays instant.
    if (d.convert) {
      ok(`${label} convert drill wins`, d.values[d.good[0]] > 0);
      ok(`${label} convert drill takes 2-4 moves`, d.winIn >= 2 && d.winIn <= 4);
      ok(`${label} convert drill is a full enough board`, counts[1] + counts[2] >= 20);
    }

    // Per-tactic shape, re-derived rather than taken on trust.
    if (t.id === 'fork') {
      ok(`${label} really is a fork (2+ reachable threats)`, openThreats(d0.child, P1).length >= 2);
      // The teacher says "two open winning squares", so that is what must light up.
      ok(`${label} shows both open threats`,
        d.show.length >= 2 && d.show.every(([r, c]) => playableNow(d0.child, r, c)));
    }
    if (t.id === 'stack') {
      const sq = winningSquares(d0.child, P1);
      ok(`${label} really stacks two winning squares`, sq.some(([r, c]) =>
        playableNow(d0.child, r, c) && r > 0 && sq.some(([r2, c2]) => c2 === c && r2 === r - 1)));
      // And the pair it lights up must be that stack: same column, adjacent rows.
      ok(`${label} shows the stacked pair`, d.show.length === 2 &&
        d.show[0][1] === d.show[1][1] && Math.abs(d.show[0][0] - d.show[1][0]) === 1);
    }
    if (t.id === 'centre') {
      ok(`${label} answer is the centre column`, same(d.good, [3]));
    }
    if (t.id === 'tempo') {
      ok(`${label} answers a real threat`, openThreats(board, P2).length === 1);
      ok(`${label} the block also builds`,
        winningSquares(d0.child, P1).length > winningSquares(board, P1).length);
    }
    if (t.id === 'poison') {
      const poisoned = legalMoves(board).filter((c) => colsWinningNow(afterDrop(board, c, P1).child, P2).length);
      ok(`${label} has 2+ poisoned columns`, poisoned.length >= 2);
      ok(`${label} the answer isn't one of them`, !poisoned.includes(d.good[0]));
      ok(`${label} nothing is forced yet`, openThreats(board, P2).length === 0);
    }
    if (t.id === 'parity') {
      // Board rows run top-down, so an odd index is an odd row from the bottom.
      const built = newSquares(board, d0.child);
      ok(`${label} the threat it builds is on an odd row`,
        built.length > 0 && built.every(([r]) => r % 2 === 1));
      ok(`${label} the threat is not immediate`, openThreats(d0.child, P1).length === 0);
    }
    if (t.id === 'claimeven') {
      // The mirror of parity: even rows from the bottom are even board indices.
      const built = newSquares(board, d0.child);
      ok(`${label} the threat it builds is on an even row`,
        built.length > 0 && built.every(([r]) => r % 2 === 0));
      ok(`${label} the threat is not immediate`, openThreats(d0.child, P1).length === 0);
    }
    if (t.id === 'above') {
      // One of yours directly over one of theirs, so theirs can never be taken.
      const mine = winningSquares(d0.child, P1);
      const theirs = winningSquares(d0.child, P2);
      ok(`${label} caps one of their winning squares`,
        theirs.some(([r, c]) => r > 0 && mine.some(([r2, c2]) => c2 === c && r2 === r - 1)));
    }
    if (t.id === 'defuse') {
      const forkable = legalMoves(board).some((c) => openThreats(afterDrop(board, c, P2).child, P2).length >= 2);
      ok(`${label} they really were about to fork`, forkable);
      const stillForkable = legalMoves(d0.child).some((c) => openThreats(afterDrop(d0.child, c, P2).child, P2).length >= 2);
      ok(`${label} the answer takes the fork away`, !stillForkable);
    }
    if (t.id === 'seven') {
      const dirs = threatDirs(d0.child, P1, d0.row, d0.col);
      ok(`${label} builds a row and a diagonal from one disc`,
        dirs.has('row') && (dirs.has('diagUp') || dirs.has('diagDown')));
    }
  });
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
