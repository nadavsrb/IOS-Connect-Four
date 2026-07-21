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

async function discCount() {
  return page.locator('#board .disc').count();
}

try {
  // --- Menu ---
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await wait(400);
  ok('menu renders both mode buttons', (await page.locator('#btn-mode-bot').isVisible()) && (await page.locator('#btn-mode-2p').isVisible()));
  await page.screenshot({ path: `${SHOTS}/01-menu.png` });

  // --- Two-player: play a scripted P1 horizontal win ---
  await page.locator('#btn-mode-2p').click();
  await wait(300);
  ok('setup screen shows and hides bot difficulty for 2P', await page.locator('#difficulty-block').evaluate((el) => el.style.display === 'none'));
  await page.screenshot({ path: `${SHOTS}/02-setup.png` });
  await page.locator('#btn-start').click();
  await wait(300);
  ok('game screen board has 42 cells', (await page.locator('#board .cell').count()) === 42);
  await page.screenshot({ path: `${SHOTS}/03-game.png` });

  // Bottom-row plan: P1 -> cols 0,1,2,3 ; P2 -> cols 0,1,2 (stacked above)
  const seq = [0, 0, 1, 1, 2, 2, 3];
  for (const col of seq) {
    // tap somewhere in the column (top cell of that column)
    await page.locator(`#board .cell[data-col="${col}"]`).first().click();
    await wait(560); // let the drop animation + turn switch settle
  }
  await wait(1200); // winning highlight + overlay delay
  ok('four discs highlighted as the winning line', (await page.locator('#board .disc.win').count()) === 4);
  const overlayOpen = await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-open'));
  ok('result overlay opened', overlayOpen);
  const title = (await page.locator('#result-title').textContent()) || '';
  ok('result announces a winner', /wins!/.test(title));
  await page.screenshot({ path: `${SHOTS}/04-win.png` });

  // Scoreboard incremented for player 1
  const statsAfterWin = await page.evaluate(() => localStorage.getItem('c4.stats.v1'));
  ok('player 1 win recorded in stats', JSON.parse(statsAfterWin)['1'] === 1);

  // Persistence across reload
  await page.reload({ waitUntil: 'networkidle' });
  const statsAfterReload = await page.evaluate(() => localStorage.getItem('c4.stats.v1'));
  ok('stats persist across reload', statsAfterReload === statsAfterWin);

  // --- Bot mode: bot responds with a legal move ---
  await wait(300);
  await page.locator('#btn-mode-bot').click();
  await wait(200);
  await page.locator('.seg[data-diff="hard"]').click();
  await page.locator('#btn-start').click();
  await wait(300);
  const before = await discCount();
  await page.locator('#board .cell[data-col="3"]').first().click();
  // wait for bot to move: disc count should reach 2 (human + bot)
  let botMoved = false;
  for (let i = 0; i < 30; i++) {
    await wait(150);
    if ((await discCount()) >= before + 2) {
      botMoved = true;
      break;
    }
  }
  ok('hard bot responds with a move', botMoved);
  await page.screenshot({ path: `${SHOTS}/05-bot.png` });

  // --- Service worker / manifest reachable ---
  const swStatus = await page.evaluate(async () => {
    const res = await fetch('service-worker.js');
    return res.status;
  });
  ok('service-worker.js served', swStatus === 200);
  const manStatus = await page.evaluate(async () => (await fetch('manifest.webmanifest')).status);
  ok('manifest.webmanifest served', manStatus === 200);

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
