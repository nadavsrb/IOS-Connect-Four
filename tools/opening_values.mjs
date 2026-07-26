// Dev-only: measure the exact game-theoretic value of each opening column with
// the app's own solver, so the "Own the centre" lesson states a measured fact
// instead of a cited one. Weak solve (win/draw/loss only) is far cheaper than
// asking for the exact mate distance, and win/draw/loss is all the lesson needs.
//
//   node tools/opening_values.mjs [budgetNodes]
//
// Measured so far, on this solver:
//   col 1 → LOSS for the player who opened there (685M nodes, ~25 min).
// The middle columns are much harder from an empty board: js/solver.js runs a
// 524k-entry transposition table (sized for in-game use, where it is plenty), and
// a full-game solve wants tens of millions of entries. So the centre's value is
// left as the published result for the solved game rather than one measured here
// — the lesson only claims what this can back up plus what is textbook.
//
// Each column is solved from Yellow's point of view after Red plays there, so a
// negative score means the mover (Yellow) is lost, i.e. Red's opening wins.
import { createBoard, dropDisc, P1, P2 } from '../js/engine.js';
import { solveBoard } from '../js/solver.js';

const budget = Number(process.argv[2] || 2e9);
const label = (s) => (s > 0 ? 'win for the mover' : s < 0 ? 'loss for the mover' : 'draw');

for (let col = 0; col < 7; col++) {
  const board = createBoard();
  dropDisc(board, col, P1);
  const t0 = Date.now();
  const res = solveBoard(board, P2, { budget, weak: true, freshTT: true });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (!res) {
    console.log(`col ${col + 1}: ABORTED after ${budget} nodes (${secs}s)`);
    continue;
  }
  const red = res.score > 0 ? 'RED LOSES' : res.score < 0 ? 'RED WINS' : 'DRAW';
  console.log(
    `col ${col + 1}: yellow ${label(res.score)} (score ${res.score}) → ${red}` +
      `  [${res.nodes} nodes, ${secs}s]`
  );
}
