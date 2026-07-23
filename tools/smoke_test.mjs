// Browser smoke test: drives the real UI in Chromium at an iPhone viewport.
// Usage: node tools/smoke_test.mjs <baseURL> <screenshotDir>
import { chromium, devices } from 'playwright-core';

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
async function start2p(timer) {
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(200);
  if (timer != null) await page.locator(`#timer-select .seg[data-timer="${timer}"]`).click();
  await page.locator('#btn-start').click();
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
  ok('2P setup shows timer control, hides bot difficulty',
    (await page.locator('#timer-block').isVisible()) &&
    (await page.locator('#difficulty-block').evaluate((el) => el.style.display === 'none')));
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.screenshot({ path: `${SHOTS}/02-setup.png` });
  await page.locator('#btn-start').click();
  await wait(300);
  ok('game board has 42 cells', (await page.locator('#board .cell').count()) === 42);

  // Bottom-row plan: P1 -> 0,1,2,3 ; P2 -> 0,1,2 (stacked above)
  // First P1 move via the aim preview: press-and-hold shows a ghost in the landing
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
  await dropAt(0); // P2
  await dropAt(1); // P1
  await page.screenshot({ path: `${SHOTS}/03-discs.png` }); // eyeball the flat disk look
  await dropAt(1); // P2
  await dropAt(2); // P1
  await dropAt(2); // P2
  await page.locator('#board .cell[data-col="3"]').first().click(); // winning P1 move
  await wait(900);
  ok('confetti bursts on win', (await page.locator('#confetti .confetti-piece').count()) > 0);
  await wait(800);
  ok('four discs highlighted as the winning line', (await page.locator('#board .disc.win').count()) === 4);
  ok('glowing win line drawn through the four discs', (await page.locator('#board svg.win-line line').count()) === 2);
  ok('result overlay opened', await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-open')));
  ok('result announces a winner', /wins!/.test((await page.locator('#result-title').textContent()) || ''));
  await page.screenshot({ path: `${SHOTS}/04-win.png` });
  ok('player 1 win recorded', JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')))['1'] === 1);

  // Alternate start: Play Again should hand the first move to Player 2
  await page.locator('#btn-playagain').click();
  await wait(300);
  ok('alternate start — Player 2 goes first next round', /Player 2/.test((await page.locator('#turn-text').textContent()) || ''));

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
  await wait(300);
  const before = await discCount();
  await page.locator('#board .cell[data-col="3"]').first().click();
  let botMoved = false;
  for (let i = 0; i < 30; i++) {
    await wait(150);
    if ((await discCount()) >= before + 2) { botMoved = true; break; }
  }
  ok('hard bot responds with a move', botMoved);
  await page.screenshot({ path: `${SHOTS}/05-bot.png` });
  ok('bot mode has no turn timer', await page.locator('#turn-timer').evaluate((el) => el.hidden));

  // --- PWA assets reachable ---
  ok('service-worker.js served', (await page.evaluate(async () => (await fetch('service-worker.js')).status)) === 200);
  ok('manifest.webmanifest served', (await page.evaluate(async () => (await fetch('manifest.webmanifest')).status)) === 200);

  // --- Best-of-3 match series (first mover wins each round with the same pattern) ---
  async function firstMoverWins() {
    for (const col of [0, 0, 1, 1, 2, 2, 3]) await dropAt(col, 520);
    await wait(1200);
  }
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="2"]').click(); // best of 3 → first to 2
  await page.locator('#btn-start').click();
  await wait(300);
  ok('series pips shown for a best-of match', !(await page.locator('#series-line').evaluate((el) => el.hidden)));
  await firstMoverWins(); // round 1 → P1
  ok('round win offers Next Round', ((await page.locator('#btn-playagain').textContent()) || '').includes('Next Round'));
  await page.locator('#btn-playagain').click();
  await wait(400);
  await firstMoverWins(); // round 2 → P2 (alternate start)
  await page.locator('#btn-playagain').click();
  await wait(400);
  await firstMoverWins(); // round 3 → P1 reaches 2 → match
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

  // --- Guard: resetting mid-animation must not corrupt the turn (stale callback) ---
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="1"]').click();
  await page.locator('#btn-start').click();
  await wait(300);
  await page.locator('#board .cell[data-col="0"]').first().click(); // P1 drops (still animating)
  await wait(110);
  await page.locator('#btn-newround').click(); // reset before the drop settles
  await wait(800); // the stale drop callback fires here and must be ignored
  ok('reset mid-animation keeps the correct turn', /Player 2/.test((await page.locator('#turn-text').textContent()) || ''));
  ok('reset mid-animation leaves an empty board', (await discCount()) === 0);

  // --- Eval bar + best-move hint (2-player, classic) ---
  await goToMenu();
  await page.locator('#btn-mode-2p').click();
  await wait(150);
  await page.locator('#timer-select .seg[data-timer="0"]').click();
  await page.locator('#variant-select .seg[data-variant="classic"]').click();
  await page.locator('#match-select .seg[data-match="1"]').click();
  await page.locator('#btn-start').click();
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
  const [w1b] = await evalWidths();
  ok('eval split changes after a move', w1b !== w1a);

  // --- Insane bot ---
  await goToMenu();
  await page.locator('#btn-mode-bot').click();
  await wait(150);
  ok('4 difficulty options incl. Insane', (await page.locator('#difficulty .seg').count()) === 4);
  await page.locator('#difficulty .seg[data-diff="insane"]').click();
  await page.locator('#btn-start').click();
  await wait(300);
  {
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
  await wait(300);
  for (const c of [0, 0, 1, 1, 2, 2, 3]) await dropAt(c, 520); // P1 wins across the bottom
  await wait(1200);
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

  // --- Turn timer: 15s countdown then timeout loss (slowest, do last) ---
  const statsBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')));
  await start2p(15);
  ok('timer is visible in two-player mode', !(await page.locator('#turn-timer').evaluate((el) => el.hidden)));
  const t1 = (await page.locator('#turn-timer').textContent()) || '';
  const toSec = (s) => { const [m, ss] = s.split(':').map(Number); return m * 60 + ss; };
  const dangerNow = () => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--danger')) || 0);
  await page.screenshot({ path: `${SHOTS}/06-timer.png` });
  await wait(2500);
  const t2 = (await page.locator('#turn-timer').textContent()) || '';
  ok('countdown decreases while running', toSec(t2) < toSec(t1));
  ok('background not red before 2/3 elapsed', (await dangerNow()) === 0);
  // pass the 2/3 mark (~10s of 15s), staying before expiry (~2.5s left)
  await wait(10000);
  const dLate = await dangerNow();
  ok('background reddens after 2/3 elapsed', dLate > 0);
  await page.screenshot({ path: `${SHOTS}/06b-timer-red.png` });
  // let the rest expire (no move)
  await wait(4000);
  ok('timeout opens the result overlay', await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-open')));
  ok('timeout message shown', /ran out of time/.test((await page.locator('#result-sub').textContent()) || ''));
  ok('red wash cleared once the game ended', (await dangerNow()) === 0);
  const statsAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')));
  ok('opponent (Player 2) awarded the timeout win', statsAfter['2'] === (statsBefore['2'] || 0) + 1);
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
