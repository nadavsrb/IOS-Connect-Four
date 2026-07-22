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
  // click the currently-visible screen's back-to-menu button
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
  await dropAt(0); // P1
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
