// Unit tests for the pure post-game review logic (js/review.js).
// Run: `node tools/test_review.mjs`.
import {
  BLUNDER_LOSS, MISTAKE_LOSS,
  evalForPlayer, classifyLoss, moverAt, summarizeReview,
} from '../js/review.js';

let passed = 0;
let failed = 0;
function ok(name, cond) {
  if (cond) { passed++; } else { failed++; console.error(`  ✗ ${name}`); }
}

console.log('Review: blunder detection + accuracy');
console.log('');

// --- evalForPlayer ------------------------------------------------------
ok('P1 reads the series as-is', evalForPlayer(70, 1) === 70);
ok('P2 reads the complement', evalForPlayer(70, 2) === 30);
ok('an even position is 50 for both', evalForPlayer(50, 1) === 50 && evalForPlayer(50, 2) === 50);

// --- classifyLoss boundaries -------------------------------------------
ok('a gain is not flagged', classifyLoss(-10) === null);
ok('no loss is not flagged', classifyLoss(0) === null);
ok('just under the mistake bar is clean', classifyLoss(MISTAKE_LOSS - 1) === null);
ok('exactly the mistake bar is a mistake', classifyLoss(MISTAKE_LOSS) === 'mistake');
ok('just under the blunder bar is a mistake', classifyLoss(BLUNDER_LOSS - 1) === 'mistake');
ok('exactly the blunder bar is a blunder', classifyLoss(BLUNDER_LOSS) === 'blunder');
ok('a catastrophe is a blunder', classifyLoss(90) === 'blunder');

// --- moverAt ------------------------------------------------------------
ok('P1 starting: even indices are P1', moverAt(0, 1) === 1 && moverAt(2, 1) === 1);
ok('P1 starting: odd indices are P2', moverAt(1, 1) === 2 && moverAt(3, 1) === 2);
ok('P2 starting: the alternation flips', moverAt(0, 2) === 2 && moverAt(1, 2) === 1);
ok('starting player defaults to P1', moverAt(0) === 1);

// --- summarizeReview ----------------------------------------------------

// A perfectly level game: nobody gives anything away.
const flat = summarizeReview([50, 50, 50, 50, 50], 1);
ok('a level game flags nothing', flat.moments.length === 0);
ok('a level game is 100% accurate for both', flat.accuracy[1] === 100 && flat.accuracy[2] === 100);
ok('one judgement per move played', flat.perMove.length === 4);
ok('move numbers are 1-based', flat.perMove[0].moveNo === 1 && flat.perMove[3].moveNo === 4);

// P1 (index 0) throws away 40 points; P2's reply is fine.
const oneBlunder = summarizeReview([60, 20, 20], 1);
ok('P1 blunder is attributed to P1', oneBlunder.counts[1].blunders === 1);
ok('P1 blunder is NOT charged to P2', oneBlunder.counts[2].blunders === 0 && oneBlunder.counts[2].mistakes === 0);
ok('the loss is measured in the mover\'s own terms', oneBlunder.perMove[0].loss === 40);
ok('P2 keeping the position is a 0-loss move', oneBlunder.perMove[1].loss === 0);
ok('P1 accuracy drops to 60', oneBlunder.accuracy[1] === 60);
ok('P2 accuracy stays 100', oneBlunder.accuracy[2] === 100);

// The same series, but P2 moved first. P1's chance *falling* is now the opening
// mover gaining ground, so the identical numbers must flag nobody.
const flipped = summarizeReview([60, 20, 20], 2);
ok('with P2 starting, the first move is P2\'s', flipped.perMove[0].mover === 2);
ok('P2 starting: the same series flags nobody', flipped.moments.length === 0);
ok('P2 starting: that first move is a 40-point gain', flipped.perMove[0].loss === -40);

// Mirror it: for the opening mover to blunder as P2, P1's chance must rise.
const flippedBad = summarizeReview([20, 60, 60], 2);
ok('P2 starting: giving P1 40 points is P2\'s blunder', flippedBad.counts[2].blunders === 1);
ok('P2 starting: P1 is unblemished', flippedBad.counts[1].blunders === 0);

// P2's perspective: P1's number going *up* is P2 losing ground.
const p2Slip = summarizeReview([50, 50, 85], 1);
ok('P2 giving away 35 points is a blunder', p2Slip.counts[2].blunders === 1);
ok('P2 loss is computed from their own side', p2Slip.perMove[1].loss === 35);

// A mistake and a blunder by the same player, plus a gain.
const mixed = summarizeReview([50, 50, 65, 65, 35, 35, 90], 1);
// P1 moves at 0 (50→50, no loss), 2 (65→65, no loss), 4 (35→90, a 55-point gain)
// P2 moves at 1 (50→35 for them, a 15-point mistake), 3 (35→65 for them, a gain),
//            5 (65→10 for them, a 55-point blunder)
ok('mixed: P2 has one mistake', mixed.counts[2].mistakes === 1);
ok('mixed: P2 has one blunder', mixed.counts[2].blunders === 1);
ok('mixed: P1 is clean', mixed.counts[1].blunders === 0 && mixed.counts[1].mistakes === 0);
ok('mixed: a gain never lowers accuracy', mixed.accuracy[1] === 100);
ok('moments are worst-first', mixed.moments.length === 2 && mixed.moments[0].loss > mixed.moments[1].loss);
ok('every moment carries its position index', mixed.moments.every((m) => Number.isInteger(m.index)));
ok('moment indices point at the position BEFORE the move', mixed.moments[0].index === 5);

// --- degenerate input ---------------------------------------------------
const empty = summarizeReview([], 1);
ok('an empty series yields no moves', empty.perMove.length === 0);
ok('an empty series is 100% for both', empty.accuracy[1] === 100 && empty.accuracy[2] === 100);
ok('a single position yields no moves', summarizeReview([50], 1).perMove.length === 0);
ok('non-array input is tolerated', summarizeReview(null, 1).perMove.length === 0);

// Accuracy can't go below zero even if a player gives away everything, twice.
const awful = summarizeReview([100, 0, 0, 100, 100, 0], 1);
ok('accuracy floors at 0', awful.accuracy[1] >= 0);
ok('a total collapse is a blunder', awful.counts[1].blunders >= 1);

console.log('');
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
