// Browser smoke test: drives the real UI in Chromium at an iPhone viewport.
// Usage: node tools/smoke_test.mjs <baseURL> <screenshotDir>
import { chromium, devices } from 'playwright-core';
import { PUZZLES } from '../js/puzzles.js';

const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const SHOTS = process.argv[3] || '.';
const EXECUTABLE = '/opt/pw-browsers/chromium';

let failures = 0;
function ok(name, cond) {
  console.log(`  ${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures++;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: EXECUTABLE });
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));

const discCount = () => page.locator('#board .disc').count();
const dropAt = async (col, settle = 560) => {
  await page.locator(`#board .cell[data-col="${col}"]`).first().click();
  await wait(settle);
};
async function goToMenu() {
  // if the result overlay is open, its Main Menu button is the clickable one
  const overlayOpen = await page
    .locator('#overlay-result')
    .evaluate((el) => el.classList.contains('is-open'))
    .catch(() => false);
  if (overlayOpen) {
    await page.locator('#overlay-result [data-nav="menu"]').click();
    await wait(200);
    return;
  }
  const back = page.locator('.screen.is-active .topbar [data-nav="menu"]');
  if (await back.count()) {
    await back.first().click();
    await wait(200);
  }
}
// The opening sequence locks the board while it plays out: vs the bot that's the
// opponent reveal AND then the toss, with a short gap between them, so "neither
// overlay is open" has to hold across that gap before the board is really live.
async function waitForOpening() {
  const busy = async () => (await page.locator('#bot-intro.is-open, #toss.is-open').count()) > 0;
  for (let i = 0; i < 140; i++) {
    if (!(await busy())) {
      await wait(340); // longer than the intro → toss hand-off
      if (!(await busy())) return;
    }
    await wait(80);
  }
}
// Which player the toss handed the first move to, read off the turn indicator.
async function starterSeat() {
  const t = (await page.locator('#turn-text').textContent()) || '';
  return /Player 2/.test(t) ? 2 : 1;
}
// In bot mode the toss can hand the opening move to the BOT, in which case the
// board stays locked until it has played. Wait until it's the human's turn.
async function waitForHumanTurn() {
  for (let i = 0; i < 60; i++) {
    const t = (await page.locator('#turn-text').textContent()) || '';
    if (/You/.test(t) && !(await page.locator('#turn-indicator.thinking').count())) return;
    await wait(120);
  }
}

async function start2p(timer) {
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(200);
  if (timer != null) await page.locator(`#timer-select .seg[data-timer="${timer}"]`).click();
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
}

try {
  // --- Menu ---
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await wait(400);
  ok('menu renders both mode buttons', (await page.locator('#btn-mode-bot').isVisible()) && (await page.locator('#btn-mode-2p').isVisible()));
  // start clean so scoreboard asserts are deterministic
  await page.evaluate(() => localStorage.removeItem('c4.stats.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await wait(300);
  await page.screenshot({ path: `${SHOTS}/01-menu.png` });

  // --- Theme switcher --- (Classic is the default; cycle is neon → classic → minimal)
  const themeOf = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  ok('default theme is classic', (await themeOf()) === 'classic');
  await page.screenshot({ path: `${SHOTS}/01b-classic.png` });
  await page.locator('#btn-theme').click();
  ok('theme cycles to minimal', (await themeOf()) === 'minimal');
  await page.screenshot({ path: `${SHOTS}/01c-minimal.png` });
  await page.locator('#btn-theme').click();
  ok('theme cycles to neon', (await themeOf()) === 'neon');
  await page.reload({ waitUntil: 'networkidle' });
  ok('theme persists across reload', (await themeOf()) === 'neon');
  await page.locator('#btn-theme').click(); // back to Classic (the default) for the remaining shots
  ok('theme cycles back to classic', (await themeOf()) === 'classic');

  // --- Two-player: play a scripted P1 horizontal win (timer off) ---
  await page.locator('#btn-mode-2p').click();
  await wait(300);
  // The primary action must be reachable without scrolling — the options list
  // used to grow the screen and push Start below the fold.
  {
    const b = await page.locator('#btn-start').boundingBox();
    ok('Start Game is in view without scrolling', b.y + b.height <= page.viewportSize().height + 1);
  }
  ok('2P setup shows timer control, hides bot difficulty',
    (await page.locator('#timer-block').isVisible()) &&
    (await page.locator('#difficulty-block').evaluate((el) => el.style.display === 'none')));
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.screenshot({ path: `${SHOTS}/02-setup.png` });
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  ok('game board has 42 cells', (await page.locator('#board .cell').count()) === 42);

  // Bottom-row plan: the FIRST mover takes 0,1,2,3 and wins; the second stacks on
  // 0,1,2. Who that is depends on the toss, so record it up front.
  const firstMover = await starterSeat();
  // First move via the aim preview: press-and-hold shows a ghost in the landing
  // hole, releasing drops the disc.
  {
    const cell0 = await page.locator('#board .cell[data-col="0"]').first().boundingBox();
    await page.mouse.move(cell0.x + cell0.width / 2, cell0.y + cell0.height / 2);
    await page.mouse.down();
    await wait(140);
    ok('aim preview ghost appears while pressing a column', (await page.locator('#board .disc.aim').count()) === 1);
    await page.mouse.up();
    await wait(560);
    ok('releasing drops the disc and clears the ghost',
      (await page.locator('#board .disc.aim').count()) === 0 && (await discCount()) === 1);
  }
  ok('exactly one last-move marker after a move', (await page.locator('#board .disc.last').count()) === 1);
  await dropAt(0); // second player
  await dropAt(1); // first player
  await page.screenshot({ path: `${SHOTS}/03-discs.png` }); // eyeball the flat disk look
  await dropAt(1); // second player
  await dropAt(2); // first player
  await dropAt(2); // second player
  await page.locator('#board .cell[data-col="3"]').first().click(); // first mover's winning move
  await wait(900);
  ok('confetti bursts on win', (await page.locator('#confetti .confetti-piece').count()) > 0);
  await wait(800);
  ok('four discs highlighted as the winning line', (await page.locator('#board .disc.win').count()) === 4);
  ok('glowing win line drawn through the four discs', (await page.locator('#board svg.win-line line').count()) === 2);
  ok('result overlay opened', await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-open')));
  ok('result announces a winner', /wins!/.test((await page.locator('#result-title').textContent()) || ''));
  await page.screenshot({ path: `${SHOTS}/04-win.png` });
  await page.locator('#overlay-result.is-open').waitFor({ timeout: 10000 });
  ok("the first mover's win is recorded against the right seat",
    JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')))[String(firstMover)] === 1);

  // Play Again on a standalone game is a fresh contest, so it re-rolls the toss.
  await page.locator('#btn-playagain').click();
  await wait(200);
  ok('Play Again rolls a fresh toss', (await page.locator('#toss.is-open').count()) === 1);
  await waitForOpening();
  ok('the toss announced who goes first', /goes first/.test((await page.locator('#toss-result').textContent()) || ''));
  ok('play resumes with a valid starter', [1, 2].includes(await starterSeat()));

  // --- Full-column shake: filling a column then tapping it drops nothing ---
  await start2p(0);
  for (let i = 0; i < 6; i++) await dropAt(0, 500); // alternating fill, no vertical win
  const filled = await discCount();
  ok('column filled with 6 discs', filled === 6);
  await dropAt(0, 500); // tap the full column
  ok('tapping a full column adds no disc (shake path)', (await discCount()) === filled);

  // --- Bot mode: bot responds with a legal move ---
  await goToMenu();
  await page.locator('#btn-mode-bot').click();
  await wait(200);
  await page.locator('#difficulty .seg[data-diff="hard"]').click();
  await page.locator('#btn-start').click();

  // --- Opponent reveal: the bot boots up before the toss, skinned by difficulty ---
  await page.locator('#bot-intro.is-open').waitFor({ timeout: 5000 });
  ok('vs bot opens with the opponent reveal', true);
  ok('the reveal is skinned for the chosen level',
    ((await page.locator('#bot-intro').getAttribute('class')) || '').includes('diff-hard'));
  ok('the reveal names the level', /HARD/.test((await page.locator('#bi-level').textContent()) || ''));
  ok('the reveal clones the robot in that skin',
    ((await page.locator('#bi-stage .bot-robot').getAttribute('class')) || '').includes('diff-hard'));
  // Tap to skip. No screenshot in here — the reveal only runs ~2s and a full-page
  // capture at 3x eats enough of that for the intro to close on its own first,
  // leaving nothing clickable. (The visuals are captured separately.)
  await page.locator('#bot-intro').click({ timeout: 4000 });
  await wait(500);
  ok('tapping the reveal skips it', (await page.locator('#bot-intro.is-open').count()) === 0);
  await waitForOpening();
  await wait(300);
  await waitForHumanTurn(); // the toss may have given the bot the opening move
  const before = await discCount();
  await page.locator('#board .cell[data-col="3"]').first().click();
  let botMoved = false;
  for (let i = 0; i < 30; i++) {
    await wait(150);
    if ((await discCount()) >= before + 2) { botMoved = true; break; }
  }
  ok('hard bot responds with a move', botMoved);

  // --- Undo vs the bot must always land back on YOUR turn ---
  // Undoing the bot's reply plus your move is the normal case. The dangerous one
  // is the bot having opened the round (possible since the toss went random): its
  // lone move rewinds to *its* turn, which nothing would then play, so undo has to
  // be unavailable rather than deadlocking the round.
  await page.locator('#btn-undo').click();
  await wait(400);
  ok('undo vs bot returns the turn to you', /You/.test((await page.locator('#turn-text').textContent()) || ''));
  ok('undo vs bot rewound both plies', (await discCount()) === before);
  {
    // Fresh bot round; if the toss hands the bot the opening move, undo must be off.
    await page.locator('#btn-restart').click();
    await waitForOpening();
    await waitForHumanTurn();
    const botOpened = (await discCount()) === 1;
    ok(botOpened ? 'undo is disabled when the bot opened the round' : 'undo is disabled on an empty board',
      await page.locator('#btn-undo').isDisabled());
  }
  await page.screenshot({ path: `${SHOTS}/05-bot.png` });
  ok('bot mode has no turn timer', await page.locator('#turn-timer').evaluate((el) => el.hidden));

  // --- PWA assets reachable ---
  ok('service-worker.js served', (await page.evaluate(async () => (await fetch('service-worker.js')).status)) === 200);
  ok('manifest.webmanifest served', (await page.evaluate(async () => (await fetch('manifest.webmanifest')).status)) === 200);

  // --- Best-of-3 match series (first mover wins each round with the same pattern) ---
  async function firstMoverWins() {
    for (const col of [0, 0, 1, 1, 2, 2, 3]) await dropAt(col, 520);
    // Wait for the result overlay itself rather than guessing how long the win
    // animation takes — a fixed delay raced the button label under load.
    await page.locator('#overlay-result.is-open').waitFor({ timeout: 10000 });
    await wait(250);
  }
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="2"]').click(); // best of 3 → first to 2
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  ok('series pips shown for a best-of match', !(await page.locator('#series-line').evaluate((el) => el.hidden)));
  const r1Starter = await starterSeat(); // rolled by the toss
  await firstMoverWins(); // round 1 → the starter
  ok('round win offers Next Round', ((await page.locator('#btn-playagain').textContent()) || '').includes('Next Round'));
  await page.locator('#btn-playagain').click();
  await wait(450);
  // Within a match the starter ALTERNATES rather than being re-rolled, so the
  // next round is announced (no spinning) and hands the first move to the other seat.
  ok('the next round announces its starter', /goes first/.test((await page.locator('#toss-result').textContent()) || ''));
  await waitForOpening();
  const r2Starter = await starterSeat();
  ok('the starter alternates between rounds of a match', r2Starter === (r1Starter === 1 ? 2 : 1));
  await firstMoverWins(); // round 2 → the other seat
  await page.locator('#btn-playagain').click();
  await wait(300);
  await waitForOpening();
  ok('round 3 alternates back', (await starterSeat()) === r1Starter);
  await firstMoverWins(); // round 3 → r1Starter reaches 2 → match
  ok('match completes with a match win', /wins the match/.test((await page.locator('#result-title').textContent()) || ''));
  ok('match win offers New Match', ((await page.locator('#btn-playagain').textContent()) || '').includes('New Match'));
  await page.screenshot({ path: `${SHOTS}/08-match.png` });

  // --- Pop-Out variant: pop your own bottom disc, removing it ---
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="popout"]').click();
  await page.locator('#match-select .seg[data-match="1"]').click();
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  ok('pop toggle visible in Pop-Out', !(await page.locator('#btn-poptoggle').evaluate((el) => el.hidden)));
  // Stack col 0: P1 (bottom), then P2 on top. Back to P1's turn.
  await dropAt(0); // P1 → row 5 of col 0
  await dropAt(0); // P2 → row 4 of col 0 (sits above P1)
  const beforePop = await discCount(); // 2
  await page.locator('#btn-poptoggle').click(); // P1 arms pop
  ok('board enters pop-mode when armed', await page.locator('#board').evaluate((el) => el.classList.contains('pop-mode')));
  await page.locator('#board .cell[data-col="0"]').first().click(); // P1 pops own bottom; P2 above falls down
  await page.screenshot({ path: `${SHOTS}/09b-popfall.png` }); // mid-fall
  await wait(700);
  ok('popping removes a disc (count -1)', (await discCount()) === beforePop - 1);
  ok('the disc above fell to the bottom row', await page.evaluate(() => {
    const cell = document.querySelector('#board .cell[data-row="5"][data-col="0"]');
    return !!(cell && cell.querySelector('.disc'));
  }));
  ok('pop-mode clears after the move', !(await page.locator('#board').evaluate((el) => el.classList.contains('pop-mode'))));
  await page.screenshot({ path: `${SHOTS}/09-popout.png` });

  // --- Pop-Out vs the bot: the variant-aware search must drive the bot's turn ---
  // (That it *chooses* pops is covered deterministically by the Node unit tests;
  // here we're checking the wiring — bot move → attemptDrop/attemptPop — holds.)
  await goToMenu();
  await page.locator('#btn-mode-bot').click();
  await wait(200);
  await page.locator('#difficulty .seg[data-diff="insane"]').click();
  await wait(80);
  await page.locator('#variant-select .seg[data-variant="popout"]').click();
  await wait(80);
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(400);
  ok('Pop-Out vs bot offers the pop toggle', await page.locator('#btn-poptoggle').isVisible());
  await waitForHumanTurn();
  const popBefore = await page.locator('#board .disc').count();
  await page.locator('#board .cell[data-col="3"]').first().click();
  await wait(2200); // think delay + robot slide + settle
  ok('the bot replies in Pop-Out', (await page.locator('#board .disc').count()) > popBefore);
  ok('the bot is not left mid-animation', (await page.locator('#bot-robot.popping, #bot-robot.dropping').count()) === 0);
  // The hint must use the pop-aware search here (it may suggest a drop or a pop).
  await page.locator('#btn-hint').click();
  await wait(250);
  ok('the Pop-Out hint marks a drop or a pop',
    (await page.locator('#board .disc.ghost').count()) + (await page.locator('#board .disc.pop-hint').count()) > 0);

  // --- Guard: resetting mid-animation must not corrupt the turn (stale callback) ---
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="1"]').click();
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  const preResetStarter = await starterSeat(); // rolled, so not necessarily P1
  await page.locator('#board .cell[data-col="0"]').first().click(); // drops (still animating)
  await wait(110);
  await page.locator('#btn-newround').click(); // reset before the drop settles
  await wait(800); // the stale drop callback fires here and must be ignored
  await waitForOpening();
  // New Round alternates the starter, and the stale drop callback must not have
  // advanced the turn on top of that.
  ok('reset mid-animation keeps the correct turn',
    (await starterSeat()) === (preResetStarter === 1 ? 2 : 1));
  ok('reset mid-animation leaves an empty board', (await discCount()) === 0);

  // --- Eval bar + best-move hint (2-player, classic) ---
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="1"]').click();
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  // The win-% bar is hidden by default — reveal it with the toggle.
  ok('eval bar hidden by default', !(await page.locator('#eval').evaluate((el) => el.classList.contains('is-on'))));
  await page.locator('#btn-eval-toggle').click();
  await wait(150);
  ok('eval bar shown after toggle', await page.locator('#eval').evaluate((el) => el.classList.contains('is-on')));
  const evalWidths = () =>
    page.evaluate(() => [
      parseFloat(document.getElementById('eval-p1').style.width) || 0,
      parseFloat(document.getElementById('eval-p2').style.width) || 0,
    ]);
  const [w1a, w2a] = await evalWidths();
  ok('eval bar renders and sums ~100', Math.abs(w1a + w2a - 100) <= 1);
  await page.locator('#btn-hint').click();
  await wait(150);
  ok('best-move shows a hint highlight + ghost',
    (await page.locator('#board .cell.hint').count()) > 0 && (await page.locator('#board .disc.ghost').count()) === 1);
  await page.screenshot({ path: `${SHOTS}/10-hint.png` });
  await dropAt(3);
  ok('hint clears after a move', (await page.locator('#board .disc.ghost').count()) === 0);
  // The bar tracks the position, but a single move can legitimately round to the
  // same integer percentage — so sample a few moves and require it to move at
  // least once, and to stay a valid split throughout.
  const seen = [w1a, (await evalWidths())[0]];
  let splitsValid = true;
  for (const col of [4, 2, 5]) {
    await dropAt(col);
    const [a, b] = await evalWidths();
    if (Math.abs(a + b - 100) > 1) splitsValid = false;
    seen.push(a);
  }
  ok('eval bar stays a valid split as the game goes on', splitsValid);
  ok('eval split changes as moves are played', new Set(seen).size > 1);

  // --- Insane bot ---
  await goToMenu();
  await page.locator('#btn-mode-bot').click();
  await wait(150);
  ok('4 difficulty options incl. Insane', (await page.locator('#difficulty .seg').count()) === 4);
  await page.locator('#difficulty .seg[data-diff="insane"]').click();
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  {
    await waitForHumanTurn();
    const before = await discCount();
    await page.locator('#board .cell[data-col="3"]').first().click();
    let moved = false;
    for (let i = 0; i < 45; i++) {
      await wait(150);
      if ((await discCount()) >= before + 2) { moved = true; break; }
    }
    ok('insane bot responds with a move', moved);
  }

  // --- Replay last game ---
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="1"]').click();
  await page.locator('#btn-start').click();
  await waitForOpening();
  await wait(300);
  for (const c of [0, 0, 1, 1, 2, 2, 3]) await dropAt(c, 520); // the first mover wins across the bottom
  await page.locator('#overlay-result.is-open').waitFor({ timeout: 10000 });
  await wait(250);
  await page.locator('#btn-watch-replay').click();
  await wait(300);
  ok('replay screen is active', await page.locator('#screen-replay').evaluate((el) => el.classList.contains('is-active')));
  const rpDiscs = () => page.locator('#replay-board .disc').count();
  ok('replay starts on an empty board', (await rpDiscs()) === 0);
  await page.locator('#rp-next').click();
  await wait(250);
  await page.locator('#rp-next').click();
  await wait(250);
  ok('stepping forward adds discs', (await rpDiscs()) === 2);
  // Replay eval bar renders for the stepped position, and best-move highlights.
  ok('replay eval bar renders and sums ~100', await page.evaluate(() => {
    const w1 = parseFloat(document.getElementById('replay-eval-p1').style.width) || 0;
    const w2 = parseFloat(document.getElementById('replay-eval-p2').style.width) || 0;
    return w1 + w2 > 0 && Math.abs(w1 + w2 - 100) <= 1;
  }));
  await page.locator('#rp-hint').click();
  await wait(150);
  ok('replay best-move highlights a column on the replay board',
    (await page.locator('#replay-board .cell.hint').count()) > 0 &&
    (await page.locator('#replay-board .disc.ghost').count()) === 1);
  await page.locator('#rp-next').click(); // navigating clears the hint
  await wait(250);
  ok('replay hint clears on navigation', (await page.locator('#replay-board .disc.ghost').count()) === 0);
  await page.locator('#rp-end').click();
  await wait(300);
  ok('jump to end shows the full game', (await rpDiscs()) === 7);
  ok('winning four highlighted at the end', (await page.locator('#replay-board .disc.win').count()) === 4);
  await page.screenshot({ path: `${SHOTS}/11-replay.png` });

  // --- Game review: the win-% curve, accuracy summary and flagged moves ---
  // The analysis walks the game one position per tick, so wait for it to finish.
  let analysed = false;
  for (let i = 0; i < 80; i++) {
    if (await page.locator('#review-progress[hidden]').count()) { analysed = true; break; }
    await wait(250);
  }
  ok('game analysis completes and hides its progress bar', analysed);
  ok('the win-% curve is drawn', ((await page.locator('#review-line').getAttribute('d')) || '').length > 10);
  ok('the curve is filled under P1s share', ((await page.locator('#review-area-p1').getAttribute('d')) || '').includes('Z'));
  const reviewText = await page.locator('#review-summary').innerText();
  ok('both players get an accuracy score', (reviewText.match(/accuracy/g) || []).length === 2);
  ok('a flagged move or a clean-game note is shown',
    (await page.locator('.review-chip').count()) + (await page.locator('.review-clean').count()) > 0);
  await page.screenshot({ path: `${SHOTS}/11b-review.png` });

  // Scrubbing the graph seeks the replay.
  const gbox = await page.locator('#review-graph').boundingBox();
  await page.mouse.move(gbox.x + gbox.width * 0.45, gbox.y + gbox.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  await wait(300);
  const scrubbed = await page.locator('#replay-counter').innerText();
  ok('scrubbing the curve seeks the replay', /Move [1-6] \/ 7/.test(scrubbed));

  // Tapping a flagged move jumps to just before it and shows the better move.
  if ((await page.locator('.review-chip').count()) > 0) {
    await page.locator('.review-chip').first().click();
    await wait(400);
    ok('tapping a flagged move suggests what to play instead',
      (await page.locator('#replay-board .disc.ghost').count()) === 1);
  } else {
    ok('tapping a flagged move suggests what to play instead (no blunder in this game)', true);
  }

  await page.locator('#screen-replay [data-nav="menu"]').click();
  await wait(200);
  ok('“Replay last” chip appears after a game', !(await page.locator('#btn-replay-last').evaluate((el) => el.hidden)));

  // --- Stats screen ---
  await page.locator('#btn-stats').click();
  await wait(200);
  ok('stats screen opens from the menu', await page.locator('#screen-stats').evaluate((el) => el.classList.contains('is-active')));
  ok('stats recorded games from this run', Number(await page.locator('#stat-total').textContent()) > 0);
  ok('per-difficulty rows render (4)', (await page.locator('#stats-difficulty .diff-row').count()) === 4);
  await page.locator('#screen-stats [data-nav="menu"]').click();
  await wait(150);
  ok('back from stats returns to the menu', await page.locator('#screen-menu').evaluate((el) => el.classList.contains('is-active')));

  // --- Puzzles ---
  // Fresh progress (nothing solved yet), then drive puzzle 1's known line.
  await page.evaluate(() => localStorage.removeItem('c4.puzzles.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await wait(300);
  ok('menu shows the Puzzles button', await page.locator('#btn-mode-puzzles').isVisible());
  await page.locator('#btn-mode-puzzles').click();
  await wait(250);
  ok('puzzles list opens', await page.locator('#screen-puzzles').evaluate((el) => el.classList.contains('is-active')));
  ok('list shows all puzzles (≥ 30)', (await page.locator('#puzzle-grid .puzzle-cell').count()) >= 30);
  // Nothing is ever locked — every puzzle is playable from a fresh install.
  ok('no puzzle is locked', (await page.locator('#puzzle-grid .puzzle-cell.is-locked').count()) === 0);
  ok('every puzzle cell is enabled', (await page.locator('#puzzle-grid .puzzle-cell:disabled').count()) === 0);
  ok('none are marked solved on a fresh install', (await page.locator('#puzzle-grid .puzzle-cell.is-solved').count()) === 0);
  // Cells are numbered by ladder position and show how deep the win is.
  ok('cells are numbered 1..N by position',
    (await page.locator('#puzzle-grid .pz-num').first().textContent()) === '1' &&
    (await page.locator('#puzzle-grid .pz-num').last().textContent()) === String(PUZZLES.length));
  ok('each cell shows its win depth', (await page.locator('#puzzle-grid .pz-win').count()) === PUZZLES.length);
  ok('the ladder ends in the hardest tier',
    /Impossible/i.test((await page.locator('#puzzle-grid .pz-tier').last().textContent()) || ''));
  ok('Next unsolved is offered on a fresh install', await page.locator('#btn-pz-next-unsolved').isVisible());
  // The hardest puzzle at the very end of the ladder opens straight away.
  await page.locator('#puzzle-grid .puzzle-cell').last().click();
  await wait(250);
  ok('the last puzzle opens without solving anything first',
    await page.locator('#screen-puzzle').evaluate((el) => el.classList.contains('is-active')));
  await page.locator('#screen-puzzle [data-nav="puzzles"]').click();
  await wait(200);
  await page.screenshot({ path: `${SHOTS}/12-puzzles.png` });

  const pz1 = PUZZLES[0];
  const preset = [...pz1.grid].filter((ch) => ch !== '0').length;
  const solCol = pz1.line[0];
  const wrongCol = [0, 1, 2, 3, 4, 5, 6].find((c) => c !== solCol && pz1.grid[c] === '0'); // non-full, non-winning
  const pzDiscs = () => page.locator('#puzzle-board .disc').count();
  const pzStatus = async () => (await page.locator('#puzzle-status').textContent()) || '';
  // Free play: after your move the opponent thinks, so wait for its reply (or for
  // the puzzle to end) rather than a fixed delay.
  const pzDrop = async (col) => {
    await page.locator(`#puzzle-board .cell[data-col="${col}"]`).first().click();
    await wait(600);
    for (let i = 0; i < 60; i++) {
      if (!/defending/i.test(await pzStatus())) break;
      await wait(200);
    }
    await wait(150);
  };

  await page.locator('#puzzle-grid .puzzle-cell').first().click();
  await wait(250);
  ok('puzzle play screen opens', await page.locator('#screen-puzzle').evaluate((el) => el.classList.contains('is-active')));
  ok('preset position is painted', (await pzDiscs()) === preset);

  ok('the move budget is shown', /1 move left/.test((await page.locator('#puzzle-moves').textContent()) || ''));

  // Any legal move is allowed now — a non-winning one is PLAYED, and since this
  // puzzle is a win-in-1 that spends the whole budget and loses the puzzle.
  await pzDrop(wrongCol);
  ok('a non-winning move is actually played', (await pzDiscs()) > preset);
  ok('spending the budget without a four fails the puzzle', /out of moves/i.test(await pzStatus()));
  ok('a failed puzzle locks the board', await page.locator('#puzzle-board').evaluate(
    (el) => { const n = el.querySelectorAll('.disc').length;
      el.querySelector('.cell[data-col="3"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return el.querySelectorAll('.disc').length === n; }));
  ok('a failed puzzle is not recorded as solved',
    !(JSON.parse((await page.evaluate(() => localStorage.getItem('c4.puzzles.v1'))) || '{}').solved || []).includes(pz1.id));

  // Retry restores the position and the full budget.
  await page.locator('#pz-retry').click();
  await wait(400);
  ok('retry restores the starting position', (await pzDiscs()) === preset);
  ok('retry restores the move budget', /1 move left/.test((await page.locator('#puzzle-moves').textContent()) || ''));

  // The hint is solved live from the position, and names the mate distance.
  await page.locator('#pz-hint').click();
  await wait(600);
  ok('hint highlights a winning column', await page.locator(`#puzzle-board .cell[data-col="${solCol}"].hint`).count() > 0);
  ok('hint states how deep the win is', /win in 1/i.test(await pzStatus()));

  // Solve it (puzzle 1 is win-in-1).
  await pzDrop(solCol);
  await wait(300);
  ok('solving adds the winning disc', (await pzDiscs()) === preset + 1);
  ok('the winning four are highlighted', (await page.locator('#puzzle-board .disc.win').count()) === 4);
  ok('solved state is announced', /solved/i.test((await page.locator('#puzzle-status').textContent()) || ''));
  ok('a Next button appears on solve', !(await page.locator('#pz-next').evaluate((el) => el.hidden)));
  await page.screenshot({ path: `${SHOTS}/13-puzzle-solved.png` });

  // Progress persists.
  const pzProg = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.puzzles.v1')) || '{}');
  ok('puzzle 1 recorded as solved', Array.isArray(pzProg.solved) && pzProg.solved.includes(pz1.id));
  await page.locator('#screen-puzzle [data-nav="puzzles"]').click();
  await wait(200);
  ok('back returns to the puzzle list', await page.locator('#screen-puzzles').evaluate((el) => el.classList.contains('is-active')));
  ok('the list shows one solved', (await page.locator('#puzzle-grid .puzzle-cell.is-solved').count()) === 1);
  ok('the solved cell carries a tick', (await page.locator('#puzzle-grid .puzzle-cell.is-solved .pz-mark svg').count()) === 1);
  ok('the count reflects progress', /^1 \/ \d+ solved/.test((await page.locator('#puzzles-count').textContent()) || ''));

  // The solved marker is the list's whole job now, so prove it survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await wait(300);
  await page.locator('#btn-mode-puzzles').click();
  await wait(250);
  ok('solved marks survive a reload', (await page.locator('#puzzle-grid .puzzle-cell.is-solved').count()) === 1);
  ok('the solved one is the puzzle actually solved',
    await page.locator('#puzzle-grid .puzzle-cell').first().evaluate((el) => el.classList.contains('is-solved')));
  ok('everything is still unlocked after solving', (await page.locator('#puzzle-grid .puzzle-cell:disabled').count()) === 0);
  await page.screenshot({ path: `${SHOTS}/12b-puzzles-solved.png` });
  await page.locator('#screen-puzzles [data-nav="menu"]').click();
  await wait(150);

  // --- Turn timer: 15s countdown then timeout loss (slowest, do last) ---
  const statsBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')));
  await start2p(15);
  const timedOutSeat = await starterSeat(); // whoever the toss put on the clock first
  ok('timer is visible in two-player mode', !(await page.locator('#turn-timer').evaluate((el) => el.hidden)));
  const t1 = (await page.locator('#turn-timer').textContent()) || '';
  const toSec = (s) => { const [m, ss] = s.split(':').map(Number); return m * 60 + ss; };
  const dangerNow = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--danger')) || 0);
  await page.screenshot({ path: `${SHOTS}/06-timer.png` });
  await wait(2500);
  const t2 = (await page.locator('#turn-timer').textContent()) || '';
  ok('countdown decreases while running', toSec(t2) < toSec(t1));
  ok('background not red before 2/3 elapsed', (await dangerNow()) === 0);
  // Poll for the wash rather than sampling once after a fixed delay. It only exists
  // between the 2/3 mark and the end of the round (~5s of a 15s clock) and is
  // cleared the instant the round ends, so a slow run could sample past the window
  // and see 0 — which looked like the wash was broken when it wasn't.
  let reddened = false;
  for (let i = 0; i < 45; i++) {
    if ((await dangerNow()) > 0) { reddened = true; break; }
    if (await page.locator('#overlay-result.is-open').count()) break; // expired already
    await wait(300);
  }
  ok('background reddens after 2/3 elapsed', reddened);
  await page.screenshot({ path: `${SHOTS}/06b-timer-red.png` });
  // let the rest expire (no move)
  await page.locator('#overlay-result.is-open').waitFor({ timeout: 12000 }).catch(() => {});
  ok('timeout opens the result overlay', await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-open')));
  ok('timeout message shown', /ran out of time/.test((await page.locator('#result-sub').textContent()) || ''));
  ok('red wash cleared once the game ended', (await dangerNow()) === 0);
  const statsAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')));
  // Whoever the toss put on the clock is the one who ran out, so the win goes to
  // the other seat.
  const timeoutWinner = String(timedOutSeat === 1 ? 2 : 1);
  ok(`the opponent of the timed-out player wins (seat ${timeoutWinner})`,
    statsAfter[timeoutWinner] === (statsBefore[timeoutWinner] || 0) + 1);
  await page.screenshot({ path: `${SHOTS}/07-timeout.png` });

  ok('no console/page errors during run', consoleErrors.length === 0);
  if (consoleErrors.length) console.log('    errors:', consoleErrors.slice(0, 5));
} catch (err) {
  console.error('EXCEPTION during smoke test:', err);
  failures++;
} finally {
  await browser.close();
}

console.log('');
console.log(failures === 0 ? 'SMOKE TEST PASSED' : `SMOKE TEST FAILED (${failures})`);
process.exit(failures === 0 ? 0 : 1);
