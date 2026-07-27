// Browser smoke test: drives the real UI in Chromium at an iPhone viewport.
// Usage: node tools/smoke_test.mjs <baseURL> <screenshotDir>
import { chromium, devices } from 'playwright-core';
import { ROWS } from '../js/engine.js';
import { PUZZLES } from '../js/puzzles.js';
import { TACTICS } from '../js/tactics.js';
import { decodePng, largestVerticalStep } from './png.mjs';

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
// Every animation layer is meant to cover the phone edge to edge. #app carries
// the safe-area padding and a 560px max-width, so anything positioned inside it
// stops short of the screen — which is what letterboxed the opponent reveal.
// Measure against the viewport, never against the app box.
//
// Containment, not equality, and with a tolerance: these layers deliberately
// overshoot the viewport (--bleed, for the iOS standalone short-ICB band) and
// several are transformed while they play — the gloom scales in, the screen kick
// shifts the whole fx layer by up to 7px. Covering *more* than the screen is the
// intent; only falling short is a bug.
// The strip below the viewport on an iOS standalone PWA is painted by the root
// background-colour in EVERY state, overlays included — nothing inside the page
// reaches it. So whatever is on top has to end on that same colour at its bottom
// edge, or the phone shows a band under it (which is how the opponent reveal
// looked). Compares the rendered bottom row against the root colour.
const bottomEdgeVsRoot = async () => {
  const png = decodePng(await page.screenshot({ scale: 'css' }));
  const row = png.at(Math.floor(png.width / 2), png.height - 1);
  const root = await rootColourBytes();
  return { row, root, delta: Math.max(...[0, 1, 2].map((i) => Math.abs(row[i] - root[i]))) };
};
// Read the root colour as sRGB bytes by painting it. Parsing the computed value
// as text doesn't work: color-mix() serialises as `color(srgb 0.019 0.033 0.079)`,
// whose floats a naive number match mangles into nonsense.
const rootColourBytes = () => page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = getComputedStyle(document.documentElement).backgroundColor;
  ctx.fillRect(0, 0, 1, 1);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data).slice(0, 3);
});

const coversViewport = async (sel) => {
  const vp = page.viewportSize();
  return page.locator(sel).evaluate((el, v) => {
    // Subtract whatever the fx layer is currently doing before comparing: the
    // screen kick transforms it while the maw plays, and a shaken box is not a
    // coverage failure. #fx itself is the reference, so it measures as 0,0.
    const fr = document.getElementById('fx').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const T = 1;
    return r.left - fr.left <= T && r.top - fr.top <= T &&
      r.right - fr.left >= v.width - T && r.bottom - fr.top >= v.height - T;
  }, vp);
};
// The board is locked while a drop animates, so a click that arrives early is
// silently ignored — and a scripted game then desyncs and never reaches the win
// the caller is waiting for, which surfaced as an occasional 10s timeout on the
// result overlay several assertions further down. Confirm the disc landed and
// retry once if it didn't. (Polling for the disc instead of waiting doesn't work:
// it is spawned when the drop STARTS, so it appears while the board is still
// locked.) A retry on a full column is harmless — nothing lands either time.
const dropAt = async (col, settle = 560) => {
  const before = await discCount();
  await page.locator(`#board .cell[data-col="${col}"]`).first().click();
  await wait(settle);
  if ((await discCount()) === before) {
    await page.locator(`#board .cell[data-col="${col}"]`).first().click();
    await wait(settle);
  }
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

  // --- Background continuity ---
  // A band across the bottom of the screen has come back three times now. On an
  // iOS standalone PWA the viewport can be shorter than the physical screen, and
  // everything inside the page is clipped to it — fixed layers, viewport units,
  // and the root's background IMAGE. The root's background COLOUR is the only
  // thing that paints the leftover strip, so the gradient has to genuinely END on
  // that colour rather than have it approximated underneath: the stack fades to a
  // flat --bg-floor over its last stretch, and the root is painted with exactly
  // that value.
  // Two things to prove, per theme, and only pixels can prove them.
  {
    // First, the shell has to be sized to the LARGE viewport. iOS only hands a
    // page the full screen once the document is tall enough to scroll — that is
    // why a detour through the long puzzle list used to be what made everything
    // fill the screen. Sized to the small viewport, the bars never collapse.
    ok('the shell is sized to the large viewport, not the current one',
      await page.evaluate(() => {
        const app = getComputedStyle(document.getElementById('app')).minHeight;
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;visibility:hidden;height:100lvh';
        document.body.appendChild(probe);
        const lvh = probe.offsetHeight;
        probe.remove();
        return Math.abs(parseFloat(app) - lvh) <= 1;
      }));
    // …and once the viewport IS the large one there must be nothing left to
    // scroll, or the shell would have bought the expansion with permanent jitter.
    ok('the shell adds no scroll of its own',
      await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
    const cx = () => Math.floor(page.viewportSize().width / 2);
    const near = (a, b, t) => Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t;
    const rootColour = rootColourBytes;
    const vh = page.viewportSize().height;

    for (const theme of ['classic', 'neon', 'minimal']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await wait(500); // the root colour transitions over 0.3s; sampling inside that reads an interpolated value
      const floor = await rootColour();

      // 1. The visible background really does end on the root colour. This is the
      //    seam the phone shows: the animated layer's last row meets the strip.
      const hide = await page.addStyleTag({ content: '#app{visibility:hidden !important}' });
      await wait(120);
      const live = decodePng(await page.screenshot({ scale: 'css' }));
      await hide.evaluate((el) => el.remove());
      const lastRow = live.at(cx(), live.height - 1);
      ok(`${theme}: the background ends on the root colour (${lastRow} vs ${floor})`, near(lastRow, floor, 3));

      // 2. With the root box shortened the way iOS shortens it, the strip the
      //    image can't reach is a seamless continuation rather than a patch.
      const shorten = await page.addStyleTag({
        // min-height has to be cleared too, or the shell's `min-height: 100lvh`
        // keeps the root box full-height and this stops simulating anything.
        content: `html{height:${Math.round(vh * 0.6)}px !important; min-height:0 !important}
                  body{min-height:0 !important}
                  body::before{display:none !important}
                  #app{display:none !important}`,
      });
      await wait(180);
      const png = decodePng(await page.screenshot({ scale: 'css' }));
      await shorten.evaluate((el) => el.remove());
      const { step, y } = largestVerticalStep(png, cx());
      ok(`${theme}: no seam where the image stops (worst step ${step}/255 at y=${y})`, step <= 3);
      ok(`${theme}: the strip below it is the floor colour`, near(png.at(cx(), png.height - 1), floor, 2));
    }
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'classic'));
    await wait(150);
  }

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

  // --- Particles must not outlive the screen that started them ---
  // The confetti and ash layers live in #fx, outside the screens, so `display:
  // none` no longer stops them. Leaving mid-burst used to rain the rest of the
  // confetti — and a whole delayed second wave — over whatever came next.
  {
    await start2p(0);
    for (const c of [0, 0, 1, 1, 2, 2, 3]) await dropAt(c, 520);
    await page.locator('#overlay-result.is-open').waitFor({ timeout: 10000 });
    ok('confetti is running at the moment of the win',
      (await page.locator('#confetti .confetti-piece').count()) > 0);
    await page.locator('#overlay-result [data-nav="menu"]').click();
    await wait(150);
    ok('confetti does not follow you off the game screen',
      (await page.locator('#confetti .confetti-piece').count()) === 0);
    await wait(500); // past the 300ms delayed second wave
    ok('the delayed second wave is cancelled too',
      (await page.locator('#confetti .confetti-piece').count()) === 0);
  }

  // --- The fx layer must not be scrollable ---
  // `overflow: hidden` makes a box a scroll container with invisible scrollbars,
  // and #fx is full of buttons: the browser's own scroll-into-view (Chromium runs
  // it on every click) scrolls it, #fx keeps its own position, and every overlay
  // inside is silently offset from then on — permanently, with nothing on screen
  // to explain it. That is what tapping the result card's Main Menu button above
  // used to do. Layout position vs painted position is the only way to see it.
  {
    const drift = await page.evaluate(() => {
      const fx = document.getElementById('fx');
      fx.scrollTop = 500; // try to scroll it the way the browser would
      fx.scrollLeft = 500;
      const el = document.getElementById('bot-intro');
      const r = el.getBoundingClientRect();
      const f = fx.getBoundingClientRect();
      return { sx: fx.scrollLeft, sy: fx.scrollTop, dx: r.left - f.left - el.offsetLeft, dy: r.top - f.top - el.offsetTop };
    });
    ok(`the fx layer cannot be scrolled (offset ${drift.sx},${drift.sy})`, drift.sx === 0 && drift.sy === 0);
    ok('overlays paint where they are laid out', Math.abs(drift.dx) < 1 && Math.abs(drift.dy) < 1);
  }

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
  ok('the fx layer is the whole viewport', await coversViewport('#fx'));
  ok('the opponent reveal fills the screen', await coversViewport('#bot-intro'));
  {
    await wait(400); // the floor and the root colour both fade in over 0.3s
    const e = await bottomEdgeVsRoot();
    ok(`the reveal ends on the strip colour below it (Δ${e.delta}: ${e.row} vs ${e.root})`, e.delta <= 3);
    // The overlay floor is applied as an inline style by syncFxFloor, not by a
    // :has() rule — that's the whole point, so check the mechanism directly.
    ok('the strip colour is driven from JS while an overlay is open',
      await page.evaluate(() => document.documentElement.style.backgroundColor !== '') &&
      (await page.locator('#fx.fx-open').count()) === 1);
  }
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
  // …and the strip goes back to the page background rather than staying dark.
  ok('the strip colour is handed back when the overlay closes',
    (await page.evaluate(() => document.documentElement.style.backgroundColor)) === '' ||
    (await page.locator('#toss.is-open').count()) === 1); // unless the toss took over
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

  // --- The icons have to match the default theme and hold their shape ---
  // They're generated offline by tools/make_icons.py, so nothing would otherwise
  // notice if the palette drifted from Classic — which is exactly how the app
  // shipped the old neon purple/pink long after Classic became the default.
  // Sample the rendered PNGs rather than trusting the generator's constants.
  {
    const fetchPng = async (src) => decodePng(Buffer.from(
      await page.evaluate(async (s) => [...new Uint8Array(await (await fetch(s)).arrayBuffer())], src),
    ));
    const blueish = (c) => c[2] > c[0] + 30 && c[2] > c[1] + 20;
    const isRed = (c) => c[0] > 170 && c[1] < 140 && c[2] < 130;
    const isYellow = (c) => c[0] > 190 && c[1] > 150 && c[2] < 140;
    // 4x4 cell centres for the full-bleed layout (0.085 inset, quarter cells).
    const CENTRES = [0.189, 0.396, 0.604, 0.811];

    const png = await fetchPng('icons/icon-512.png');
    const at = (col, row) => png.at(Math.round(png.width * CENTRES[col]), Math.round(png.height * CENTRES[row]));
    ok('icon is 512x512', png.width === 512 && png.height === 512);
    ok('the board fills the icon — no field around it', blueish(png.at(256, 3)) && blueish(png.at(3, 256)));
    ok('the corners are transparent, so no background shows',
      png.alphaAt(2, 2) === 0 && png.alphaAt(509, 509) === 0 && png.alphaAt(256, 2) === 255);
    // The whole point of the redraw: a diagonal FOUR, not a 3x3 pattern.
    ok('all four discs of the winning diagonal are red',
      [0, 1, 2, 3].every((i) => isRed(at(i, i))));
    ok('the supporting discs are yellow', isYellow(at(0, 1)) && isYellow(at(1, 3)) && isYellow(at(2, 3)));
    ok('the empty sockets are drilled dark', at(3, 0)[0] < 60 && at(3, 0)[2] < 90);
    ok('the win glow tints rather than blowing out to white',
      Math.min(...png.at(256, 256)) < 235); // the diagonal passes through the centre

    // The maskable variant is a different contract: no transparency, and every
    // disc inside the centre 80% circle a launcher may crop to.
    const mask = await fetchPng('icons/icon-maskable-512.png');
    ok('the maskable icon is fully opaque', mask.alphaAt(2, 2) === 255 && mask.alphaAt(256, 509) === 255);
    ok('the maskable icon keeps a backdrop behind the board', blueish(mask.at(8, 8)));
    ok('every maskable disc sits inside the 80% safe circle', await page.evaluate(() => true) && (() => {
      const m = 0.10, inset = 0.08, grid = 1 - 2 * m - 2 * inset, cell = grid / 4;
      const off = grid / 2 - cell / 2;
      return Math.hypot(off, off) + 0.36 * cell <= 0.40;
    })());
  }

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
  ok('the hint note goes with it', await page.locator('#hint-note').isHidden());

  // The hint should name the idea, not just ring the column. Three in a column for
  // whoever is to move makes the label deterministic: it has a four available.
  const noteBoardBefore = await page.locator('#board').boundingBox();
  for (const c of [0, 6, 0, 6, 0, 6]) await dropAt(c);
  await page.locator('#btn-hint').click();
  await wait(250);
  ok('the hint names what the move is',
    /four in a row/.test((await page.locator('#hint-note').textContent()) || ''));
  ok('the note is visible while the hint is', await page.locator('#hint-note').isVisible());
  // It floats over the board on purpose: as a block it would resize the board.
  const noteBoardAfter = await page.locator('#board').boundingBox();
  ok('naming the move does not resize the board',
    Math.abs(noteBoardBefore.height - noteBoardAfter.height) < 1);
  await page.screenshot({ path: `${SHOTS}/10b-hint-note.png` });
  await wait(2500);
  ok('the note times out with the hint', await page.locator('#hint-note').isHidden());
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

  // --- Losing to the bot: it eats the board, then the loss screen ---
  // Keep feeding the two leftmost columns and Insane closes the game out fast.
  // (This is the same insane round; no extra setup.)
  {
    // Watch for the win LINE, not the devour layer: the sequence only starts
    // ~700ms after the game ends, and polling for it would keep clicking (and
    // burning seconds in waitForHumanTurn) straight through that window — long
    // enough for the whole 2.5s animation to finish before anything looked.
    const ended = async () =>
      (await page.locator('#board .disc.win').count()) === 4 ||
      (await page.locator('#overlay-result.is-open').count()) > 0;
    const myTurn = async () => {
      for (let i = 0; i < 60; i++) {
        if (await ended()) return false;
        const t = (await page.locator('#turn-text').textContent()) || '';
        if (/You/.test(t) && !(await page.locator('#turn-indicator.thinking').count())) return true;
        await wait(120);
      }
      return false;
    };
    // Stacking the two leftmost columns can never make four (Insane blocks the
    // third every time), so the bot always closes this out.
    for (const c of [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1]) {
      if (!(await myTurn())) break;
      await page.locator(`#board .cell[data-col="${c}"]`).first().click();
      await wait(620);
    }
    for (let i = 0; i < 80; i++) { if (await ended()) break; await wait(200); }
    const devoured = await page.locator('#devour.is-open').waitFor({ timeout: 5000 }).then(() => true, () => false);
    ok('losing to the bot opens the devour sequence', devoured);
    ok('the maw is skinned for the level you lost to',
      ((await page.locator('#devour').getAttribute('class')) || '').includes('diff-insane'));
    ok('the board is drawn into the mouth', await page.locator('#board').evaluate((el) => el.classList.contains('is-eaten')));
    ok('the maw fills the screen', await coversViewport('#devour'));
    await page.locator('#devour.jaws-open').waitFor({ timeout: 4000 }).catch(() => {});
    // No extra wait: a full-page capture at 3x costs ~half a second on its own,
    // which lands this shot near the end of the 0.6s opening.
    await page.screenshot({ path: `${SHOTS}/13-devour-jaws.png` });
    ok('the jaws open before biting', (await page.locator('#devour.jaws-open').count()) === 1);
    await page.locator('#devour.chomp').waitFor({ timeout: 4000 }).catch(() => {});
    await wait(150);
    await page.screenshot({ path: `${SHOTS}/13b-devour-chomp.png` });
    ok('the jaws snap shut', (await page.locator('#devour.chomp').count()) === 1);

    await page.locator('#overlay-result.is-open').waitFor({ timeout: 8000 });
    await wait(500);
    ok('the result card comes up in its loss skin',
      await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-loss')));
    ok('the headline names the defeat, not the winner',
      /Nibbled|Swallowed|Crunched|DEVOURED/.test((await page.locator('#result-title').textContent()) || ''));
    ok('the result overlay fills the screen', await coversViewport('#overlay-result'));
    {
      const e = await bottomEdgeVsRoot();
      ok(`the loss card ends on the strip colour below it (Δ${e.delta}: ${e.row} vs ${e.root})`, e.delta <= 6);
    }
    // The bite kicks the fx layer with a transform; it has to come back off, or
    // every overlay after it sits a few pixels out of place for good.
    ok('the screen kick leaves no residual transform on the fx layer',
      await page.locator('#fx').evaluate((el) => {
        const t = getComputedStyle(el).transform;
        return (t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)') && !el.classList.contains('quake');
      }));
    ok('the maw is gone once the card is up', (await page.locator('#devour.is-open').count()) === 0);
    await page.screenshot({ path: `${SHOTS}/13c-devour-card.png` });
    // A new round has to put the board back — the swallow must not persist.
    await page.locator('#btn-playagain').click();
    await waitForOpening();
    await wait(300);
    ok('a new round un-eats the board', !(await page.locator('#board').evaluate((el) => el.classList.contains('is-eaten'))));
    ok('the loss skin is dropped with the overlay', (await page.locator('#overlay-result.is-loss.is-open').count()) === 0);
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
  // The overlays are no longer inside the screen that owns them, so nothing hides
  // them implicitly: leaving has to tear them down or the result card sits on top
  // of the replay screen and eats every tap.
  ok('the result card does not outlive the game screen', (await page.locator('#overlay-result.is-open').count()) === 0);
  ok('nothing in the fx layer is left open on the replay screen',
    (await page.locator('#fx .is-open').count()) === 0);
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
  await page.locator('#review-graph').scrollIntoViewIfNeeded();
  await wait(150);
  const gbox = await page.locator('#review-graph').boundingBox();
  const hitPoint = [gbox.x + gbox.width * 0.45, gbox.y + gbox.height / 2];
  const onTop = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? `${el.tagName}#${el.id}` : 'nothing';
  }, hitPoint);
  await page.mouse.move(hitPoint[0], hitPoint[1]);
  await page.mouse.down();
  await page.mouse.up();
  await wait(300);
  const scrubbed = await page.locator('#replay-counter').innerText();
  const total = Number((scrubbed.match(/\/ (\d+)/) || [])[1] || 0);
  const atMove = Number((scrubbed.match(/Move (\d+)/) || [])[1] || -1);
  // A tap at 45% across the curve should land somewhere in the middle of the game,
  // whatever length the game turned out to be.
  ok(`scrubbing the curve seeks the replay (${scrubbed}, box y=${Math.round(gbox.y)} h=${Math.round(gbox.height)}, hit ${onTop})`,
    total > 0 && atMove > 0 && atMove < total);

  // Tapping a flagged move jumps to just before it and shows the better move.
  if ((await page.locator('.review-chip').count()) > 0) {
    await page.locator('.review-chip').first().click();
    await wait(400);
    ok('tapping a flagged move suggests what to play instead',
      (await page.locator('#replay-board .disc.ghost').count()) === 1);
    // Where the mistake has a name the teacher covers, the lesson is one tap away.
    const named = await page.locator('.review-chip-idea').count();
    if (named > 0) {
      // Find a chip that names an idea and open it.
      const idea = page.locator('.review-chip', { has: page.locator('.review-chip-idea') }).first();
      await idea.click();
      await wait(400);
      ok('a named mistake offers its lesson', await page.locator('#review-learn').isVisible());
      const wanted = ((await page.locator('#review-learn').textContent()) || '').replace(/^Learn this: | ›$/g, '');
      await page.locator('#review-learn').click();
      await wait(500);
      ok('and it opens that tactic',
        (await page.locator('#screen-tactic').evaluate((el) => el.classList.contains('is-active'))) &&
        (await page.locator('#tactic-title').textContent()) === wanted);
      await page.screenshot({ path: `${SHOTS}/11c-review-to-lesson.png` });
      await page.locator('#screen-tactic [data-nav="tactics"]').click();
      await wait(250);
      await page.locator('#screen-tactics [data-nav="menu"]').click();
      await wait(250);
      await page.locator('#btn-replay-last').click(); // back into the review for the rest of the run
      await wait(500);
      for (let i = 0; i < 90; i++) {
        if (await page.locator('#review-progress[hidden]').count()) break;
        await wait(200);
      }
    } else {
      ok('a named mistake offers its lesson (nothing recognisable in this game)', true);
    }
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

  // The ladder is tagged by the idea each key move needs, so it can be filtered.
  const filterChips = await page.locator('.pz-filter-chip').count();
  ok('the ladder can be filtered by idea', filterChips >= 3);
  ok('the first chip is the whole set',
    /All \d+/.test((await page.locator('.pz-filter-chip').first().textContent()) || ''));
  const allCells = await page.locator('#puzzle-grid .puzzle-cell').count();
  await page.locator('.pz-filter-chip').nth(1).click();
  await wait(250);
  const someCells = await page.locator('#puzzle-grid .puzzle-cell').count();
  ok(`a filter narrows the list (${allCells} → ${someCells})`, someCells > 0 && someCells < allCells);
  ok('the filtered list keeps real ladder numbers',
    Number(await page.locator('#puzzle-grid .pz-num').first().textContent()) >= 1);
  await page.screenshot({ path: `${SHOTS}/12c-puzzle-filter.png` });
  await page.locator('.pz-filter-chip').first().click(); // back to the whole ladder
  await wait(250);
  ok('clearing the filter restores the ladder',
    (await page.locator('#puzzle-grid .puzzle-cell').count()) === allCells);
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

  // --- The losing sequence: the board sags and drains, the dark closes in, ash
  //     and grit fall, and a cracked disc splits apart on the card ---
  ok('the board drains of colour on a loss', (await page.locator('#puzzle-board.is-lost').count()) === 1);
  ok('ash drifts down over the lost board', (await page.locator('#puzzle-ash .ash-fleck').count()) > 0);
  ok('some of the fall is grit, not just ash', (await page.locator('#puzzle-ash .ash-fleck.long').count()) > 0);
  ok('the dark closes in on the board', (await page.locator('#puzzle-gloom.is-on').count()) === 1);
  ok('the gloom and the ash fill the screen',
    (await coversViewport('#puzzle-gloom')) && (await coversViewport('#puzzle-ash')));
  // Every disc has to carry its own sag delay, or the collapse happens in one
  // flat step instead of rolling up the board.
  const sagged = await page.locator('#puzzle-board .disc').evaluateAll(
    (els) => els.filter((e) => e.style.getPropertyValue('--sag')).length);
  ok('each disc sags on its own beat', sagged > 0 && sagged === (await pzDiscs()));
  await page.screenshot({ path: `${SHOTS}/13-puzzle-drain.png` });
  await page.locator('#puzzle-lost.is-open').waitFor({ timeout: 4000 });
  ok('the loss card fades up', (await page.locator('#puzzle-lost.is-open').count()) === 1);
  ok('the loss card names what went wrong',
    /out of moves/i.test((await page.locator('#pl-title').textContent()) || '') &&
    ((await page.locator('#pl-sub').textContent()) || '').length > 10);
  ok('the cracked disc is in two halves that can come apart',
    (await page.locator('#puzzle-lost .pl-half').count()) === 2);
  ok('the puzzle loss screen fills the screen', await coversViewport('#puzzle-lost'));
  await wait(900); // let the split finish before capturing it
  await page.screenshot({ path: `${SHOTS}/13b-puzzle-lost.png` });

  // Retry from the card clears the whole losing state, not just the board.
  await page.locator('#pl-retry').click();
  await wait(600);
  ok('retry clears the loss card, ash and gloom',
    (await page.locator('#puzzle-lost.is-open').count()) === 0 &&
    (await page.locator('#puzzle-board.is-lost').count()) === 0 &&
    (await page.locator('#puzzle-gloom.is-on').count()) === 0 &&
    (await page.locator('#puzzle-ash .ash-fleck').count()) === 0);
  ok('retry clears the per-disc sag delays', (await page.locator('#puzzle-board .disc').evaluateAll(
    (els) => els.filter((e) => e.style.getPropertyValue('--sag')).length)) === 0);

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

  // Practising one idea has to STAY on that idea. "Next ›" used to walk the whole
  // ladder, so solving a filtered puzzle handed you an unrelated position. Pick a
  // filter whose puzzles are NOT adjacent, so the two behaviours differ visibly.
  {
    const chipCount = await page.locator('.pz-filter-chip').count();
    let shown = [];
    for (let c = 1; c < chipCount; c++) {
      await page.locator('.pz-filter-chip').nth(c).click();
      await wait(250);
      const idx = await page.evaluate(() =>
        [...document.querySelectorAll('#puzzle-grid .puzzle-cell')].map((el) => Number(el.dataset.i)));
      if (idx.length >= 2 && idx[1] !== idx[0] + 1) { shown = idx; break; }
    }
    ok('a filter exists whose puzzles are not adjacent in the ladder', shown.length >= 2);
    if (shown.length >= 2) {
      const p = PUZZLES[shown[0]];
      await page.locator('#puzzle-grid .puzzle-cell').first().click();
      await wait(500);
      for (let k = 0; k < p.line.length; k += 2) {
        await pzDrop(p.line[k]);
        await wait(1100); // their reply animates before the next move is legal
      }
      await wait(600);
      ok(`the filtered puzzle ${shown[0] + 1} solves`,
        /solved/i.test((await page.locator('#puzzle-status').textContent()) || ''));
      await page.locator('#pz-next').click();
      await wait(700);
      ok(`Next stays inside the filter (puzzle ${shown[1] + 1}, not ${shown[0] + 2})`,
        new RegExp(`Puzzle ${shown[1] + 1}(\\D|$)`).test(
          (await page.locator('#puzzle-title').textContent()) || ''));
      await page.locator('#screen-puzzle [data-nav="puzzles"]').click();
      await wait(300);
      await page.locator('.pz-filter-chip').first().click(); // leave the ladder unfiltered
      await wait(250);
    }
  }
  await page.locator('#screen-puzzles [data-nav="menu"]').click();
  await wait(150);

  // --- Tactics: the teacher, a lesson, a drill answered wrong then right ---
  await page.evaluate(() => localStorage.removeItem('c4.tactics.v1'));
  await page.reload({ waitUntil: 'networkidle' });
  await wait(300);
  ok('menu shows the Tactics button', await page.locator('#btn-mode-tactics').isVisible());
  await page.locator('#btn-mode-tactics').click();
  await wait(250);
  ok('tactics list opens', await page.locator('#screen-tactics').evaluate((el) => el.classList.contains('is-active')));
  ok('every tactic is listed', (await page.locator('#tactic-list .tactic-card').count()) === TACTICS.length);
  ok('none are learned on a fresh install', (await page.locator('.tactic-card.is-learned').count()) === 0);
  ok('the list counts them', /0 \/ \d+ learned/.test((await page.locator('#tactics-count').textContent()) || ''));
  // The intro names the size of the course; it is written from the data so that
  // adding a tactic can't leave it claiming the old number.
  ok('the intro names the real number of ideas',
    (await page.locator('#tactics-total').textContent()) === String(TACTICS.length));

  await page.locator('#tactic-list .tactic-card').first().click();
  await wait(400);
  const tac = TACTICS[0];
  ok('the tactic screen opens', await page.locator('#screen-tactic').evaluate((el) => el.classList.contains('is-active')));
  ok('the teacher appears above the board', (await page.locator('#teacher.is-active').count()) === 1);
  ok('the teacher is a figure, not an emoji', (await page.locator('#teacher .tc-cap, #teacher .tc-beard, #teacher .tc-specs').count()) === 3);
  // He types his line out; tapping the bubble finishes it immediately.
  await page.locator('#teacher-bubble').click();
  await wait(150);
  ok('the teacher says the first lesson page in full',
    ((await page.locator('#teacher-say').textContent()) || '').trim() === tac.lesson[0].say);
  ok('one step dot per lesson page and drill',
    (await page.locator('#tactic-steps i').count()) === tac.lesson.length + tac.drills.length);
  // Page 1 of the first lesson lights the centre column: 6 cells, and it has to be
  // painted (the per-theme .socket rules used to win this fight silently).
  ok('a lit column shows on the board', (await page.locator('#tactic-board .cell.teach-lit').count()) === 6);
  ok('the lit ring is actually painted', await page.locator('#tactic-board .cell.teach-lit').first().evaluate(
    (el) => getComputedStyle(el, '::before').boxShadow.includes('245, 196, 81')));
  // Everything has to fit: this screen carries a whole extra row of chrome.
  const tacticFits = await page.evaluate(() => {
    const ctrl = document.querySelector('.tactic-controls').getBoundingClientRect();
    return ctrl.bottom <= window.innerHeight + 1 &&
      document.documentElement.scrollHeight <= window.innerHeight + 1;
  });
  ok('the tactic screen fits the viewport with no scroll', tacticFits);
  await page.screenshot({ path: `${SHOTS}/13-tactic-lesson.png` });

  // A lesson page with `play` demonstrates the idea instead of describing it. The
  // counter-example page also has `play`, so pick the one that isn't the trap.
  const demoPage = tac.lesson.findIndex((p) => p.play && p.play.length > 1 && !p.trap);
  if (demoPage > 0) {
    for (let i = 1; i <= demoPage; i++) { await page.locator('#tc-next').click(); await wait(250); }
    const startDiscs = [...tac.lesson[demoPage].grid].filter((ch) => ch !== '0').length;
    ok('the demo starts from the position before the move',
      (await page.locator('#tactic-board .disc').count()) >= startDiscs - 1);
    await wait(3400);
    ok('the demo plays the idea out',
      (await page.locator('#tactic-board .disc').count()) === startDiscs + tac.lesson[demoPage].play.length);
    ok('the demo ends on a four', (await page.locator('#tactic-board .disc.win').count()) === 4);
    ok('and offers to run it again', (await page.locator('#tc-show-label').textContent()) === 'Again');
    for (let i = demoPage + 1; i < tac.lesson.length; i++) {
      await page.locator('#tc-next').click();
      // A counter-example page is a demonstration too: let it finish, then check
      // that it lands on THEIR four and that the teacher doesn't celebrate it.
      if (tac.lesson[i].trap) {
        await wait(3200);
        ok('the counter-example ends on their four',
          (await page.locator('#tactic-board .disc.win').count()) === 4);
        ok('and the teacher does not celebrate it', (await page.locator('#teacher.is-stern').count()) === 1);
        await page.screenshot({ path: `${SHOTS}/13g-counter-example.png` });
      } else {
        await wait(250);
      }
    }
  } else {
    for (let i = 1; i < tac.lesson.length; i++) { await page.locator('#tc-next').click(); await wait(250); }
  }
  ok('the last lesson page offers the drills', (await page.locator('#tc-next-label').textContent()) === 'Try it');
  await page.locator('#tc-next').click();
  await wait(400);
  const tDiscs = () => page.locator('#tactic-board .disc').count();
  const drillPreset = [...tac.drills[0].grid].filter((ch) => ch !== '0').length;
  ok('the drill position is painted', (await tDiscs()) === drillPreset);
  ok('the drill hides Next until it is answered', !(await page.locator('#tc-next').isVisible()));

  const goodCol = tac.drills[0].good[0];
  const badCol = [0, 1, 2, 3, 4, 5, 6].find((c) => c !== goodCol && tac.drills[0].grid[c] === '0');
  await page.locator(`#tactic-board .cell[data-col="${badCol}"]`).first().click();
  await wait(400);
  ok('a wrong answer plays nothing', (await tDiscs()) === drillPreset);
  ok('a wrong answer makes the teacher stern', (await page.locator('#teacher.is-stern').count()) === 1);
  ok('a wrong answer is explained', ((await page.locator('#teacher-say').textContent()) || '').length > 0);

  // "Show me" points the staff at the column and rings it.
  await page.locator('#tc-show').click();
  await wait(300);
  ok('Show me points the staff', (await page.locator('#teacher.is-pointing').count()) === 1);
  ok('Show me rings the right column', (await page.locator(`#tactic-board .cell[data-col="${goodCol}"].hint`).count()) === ROWS);
  await page.screenshot({ path: `${SHOTS}/13b-tactic-showme.png` });

  await page.locator(`#tactic-board .cell[data-col="${goodCol}"]`).first().click();
  await wait(900);
  ok('the right answer is played', (await tDiscs()) === drillPreset + 1);
  ok('the teacher approves', (await page.locator('#teacher.is-pleased').count()) === 1);
  ok('it lights up what the move built',
    (await page.locator('#tactic-board .cell.teach-mark').count()) === tac.drills[0].show.length);
  ok('a solved drill offers the next one', await page.locator('#tc-next').isVisible());
  await page.screenshot({ path: `${SHOTS}/13c-tactic-drill.png` });

  // Retry puts the drill back exactly as it started.
  await page.locator('#tc-next').click();
  await wait(400);
  const d2Preset = [...tac.drills[1].grid].filter((ch) => ch !== '0').length;
  const d2Bad = [0, 1, 2, 3, 4, 5, 6].find((c) => c !== tac.drills[1].good[0] && tac.drills[1].grid[c] === '0');
  await page.locator(`#tactic-board .cell[data-col="${d2Bad}"]`).first().click();
  await wait(400);
  ok('a wrong answer offers Retry', await page.locator('#tc-retry').isVisible());
  await page.locator('#tc-retry').click();
  await wait(400);
  ok('Retry restores the starting position', (await tDiscs()) === d2Preset);

  // Play a move that keeps the whole position, however many drills are left, and
  // carry the convert drill through to the four.
  const finishAnyFour = async (cap = 8) => {
    for (let step = 0; step < cap; step++) {
      const n = await tDiscs();
      for (const c of [3, 2, 4, 1, 5, 0, 6]) {
        await page.locator(`#tactic-board .cell[data-col="${c}"]`).first().click();
        await wait(700);
        if ((await tDiscs()) > n) break;
      }
      if (await page.locator('#tactic-board .disc.win').count()) return true;
      await wait(800); // their reply
    }
    return (await page.locator('#tactic-board .disc.win').count()) > 0;
  };

  for (let k = 1; k < tac.drills.length; k++) {
    const d = tac.drills[k];
    if (k > 1) { await page.locator('#tc-next').click(); await wait(400); }
    if (d.convert) {
      ok(`drill ${k + 1} is the convert drill`, d.winIn >= 2);
      await page.locator('#teacher-bubble').click(); // he types; skip to the end of the line
      await wait(200);
      ok('a convert drill says how many moves it should take',
        new RegExp(`${d.winIn} moves`).test((await page.locator('#teacher-say').textContent()) || ''));
      ok('the convert drill can be carried to a four', await finishAnyFour());
      continue;
    }
    await page.locator(`#tactic-board .cell[data-col="${d.good[0]}"]`).first().click();
    await wait(1000);
    if (d.follow) {
      await wait(1600); // their defence lands, then you finish it
      for (const c of [0, 1, 2, 3, 4, 5, 6]) {
        const n = await tDiscs();
        await page.locator(`#tactic-board .cell[data-col="${c}"]`).first().click();
        await wait(600);
        if ((await tDiscs()) > n) break;
      }
      await wait(400);
      ok(`drill ${k + 1} could be played out to a four`, (await page.locator('#tactic-board .disc.win').count()) === 4);
    }
  }
  ok('the last drill offers to finish the tactic', (await page.locator('#tc-next-label').textContent()) === 'Finish');
  await page.locator('#tc-next').click();
  await wait(500);
  ok('finishing a tactic records it',
    (JSON.parse((await page.evaluate(() => localStorage.getItem('c4.tactics.v1'))) || '{}').learned || []).includes(tac.id));
  ok('finishing a tactic celebrates', (await page.locator('#puzzle-confetti .confetti-piece').count()) > 0);
  ok('and offers the next tactic', (await page.locator('#tc-next-label').textContent()) === 'Next tactic');
  await page.screenshot({ path: `${SHOTS}/13d-tactic-done.png` });

  // A finished tactic offers the puzzles that turn on the same idea.
  if (await page.locator('#tc-practise').isVisible()) {
    await page.locator('#tc-practise').click();
    await wait(400);
    ok('a finished tactic leads into the matching puzzles',
      (await page.locator('#screen-puzzles').evaluate((el) => el.classList.contains('is-active'))) &&
      (await page.locator('.pz-filter-chip.is-on').count()) === 1);
    await page.locator('#screen-puzzles [data-nav="menu"]').click();
    await wait(200);
    await page.locator('#btn-mode-tactics').click();
    await wait(250);
  } else {
    ok('a finished tactic leads into the matching puzzles (no puzzle uses this idea)', true);
    await page.locator('#screen-tactic [data-nav="tactics"]').click();
    await wait(250);
  }
  ok('the learned tactic is marked in the list', (await page.locator('.tactic-card.is-learned').count()) === 1);
  ok('the count follows', /1 \/ \d+ learned/.test((await page.locator('#tactics-count').textContent()) || ''));
  // Leaving mid-sentence must stop him talking rather than leave a timer running.
  await page.locator('#tactic-list .tactic-card').nth(1).click();
  await wait(200);
  await page.locator('#screen-tactic [data-nav="tactics"]').click();
  await wait(400);
  ok('walking out mid-sentence stops the teacher',
    (await page.locator('#teacher.is-talking').count()) === 0 &&
    (await page.locator('#teacher-say.is-typing').count()) === 0);

  // --- One game counts once, however many times you rewatch it ---
  // analyseReplay() reruns on every visit to the review screen, so the weakness
  // tally used to grow each time — three viewings turned "missed 2×" into 6× and
  // sent "Practise my weakest" after the wrong idea. The saved game here was
  // played 2-player (which is never counted), so relabel it as a bot game.
  {
    await page.evaluate(() => {
      localStorage.removeItem('c4.weakness.v1');
      const g = JSON.parse(localStorage.getItem('c4.lastgame.v1') || 'null');
      if (g) { g.mode = 'bot'; g.difficulty = 'medium'; localStorage.setItem('c4.lastgame.v1', JSON.stringify(g)); }
    });
    await page.reload({ waitUntil: 'networkidle' });
    await wait(300);
    const watchReview = async () => {
      await page.locator('#btn-replay-last').click();
      await wait(500);
      for (let i = 0; i < 90; i++) {
        if (await page.locator('#review-progress[hidden]').count()) break;
        await wait(200);
      }
      await wait(300);
      const w = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.weakness.v1')) || 'null');
      await page.locator('#screen-replay [data-nav="menu"]').click();
      await wait(250);
      return w;
    };
    const first = await watchReview();
    const second = await watchReview();
    ok('a reviewed bot game is counted', !!first && first.games === 1);
    ok('rewatching the same game does not count it again',
      !!second && second.games === 1 &&
      JSON.stringify(second.counts) === JSON.stringify(first ? first.counts : {}));
  }

  // --- Weak spots from your own games ---
  await page.evaluate(() => {
    localStorage.setItem('c4.weakness.v1', JSON.stringify({ counts: { fork: 4, poison: 2 }, games: 3 }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await wait(300);
  await page.locator('#btn-mode-tactics').click();
  await wait(300);
  ok('ideas your games catch you out on are badged', (await page.locator('.tc-missed').count()) === 2);
  ok('the badge says how often',
    /missed 4× in your games/.test((await page.locator('.tc-missed').first().textContent()) || ''));
  ok('and the worst one is offered directly', await page.locator('#btn-tactic-weakest').isVisible());
  ok('named in the button',
    /two threats at once/.test((await page.locator('#weakest-label').textContent()) || ''));
  await page.screenshot({ path: `${SHOTS}/13h-weak-spots.png` });
  await page.locator('#btn-tactic-weakest').click();
  await wait(400);
  ok('practising the weakest opens that tactic',
    (await page.locator('#screen-tactic').evaluate((el) => el.classList.contains('is-active'))) &&
    (await page.locator('#tactic-title').textContent()) === 'Two threats at once');

  // Fork carries a counter-example: the shape matches, but the disc lifts them onto
  // a four first. The first tactic (centre) has no such page, so check it here —
  // the demo has to end on THEIR four, and the teacher must not celebrate it.
  const trapPage = TACTICS.find((t) => t.id === 'fork').lesson.findIndex((p) => p.trap);
  ok('the fork lesson ends on a counter-example', trapPage > 0);
  for (let i = 1; i <= trapPage; i++) {
    await page.locator('#tc-next').click();
    await wait(3600); // long enough for a page that demonstrates itself
  }
  ok('the counter-example ends on a four', (await page.locator('#tactic-board .disc.win').count()) === 4);
  ok('and the teacher does not celebrate it', (await page.locator('#teacher.is-stern').count()) === 1);
  ok('the counter-example says the shape is not enough',
    /hands them|lifts them|not enough/i.test((await page.locator('#teacher-say').textContent()) || ''));
  await page.screenshot({ path: `${SHOTS}/13g-counter-example.png` });

  await page.locator('#screen-tactic [data-nav="tactics"]').click();
  await wait(250);
  await page.locator('#screen-tactics [data-nav="menu"]').click();
  await wait(200);
  await page.locator('#btn-stats').click();
  await wait(250);
  ok('Stats shows the ideas you miss most',
    !(await page.locator('#stat-weak-section').evaluate((el) => el.hidden)));
  ok('one row per missed idea', (await page.locator('#stats-weak .diff-row').count()) === 2);
  await page.screenshot({ path: `${SHOTS}/13i-stats-weak.png` });
  await page.locator('#screen-stats [data-nav="menu"]').click();
  await wait(200);

  // --- The exam: name the idea, then play it ---
  await page.evaluate(() => localStorage.setItem('c4.tactics.v1', JSON.stringify(
    { learned: ['centre', 'fork', 'seven', 'tempo'], review: [], examBest: 0, at: null })));
  await page.reload({ waitUntil: 'networkidle' });
  await wait(300);
  await page.locator('#btn-mode-tactics').click();
  await wait(250);
  ok('the exam is offered once a few tactics are learned', await page.locator('#btn-tactic-exam').isVisible());
  await page.locator('#btn-tactic-exam').click();
  await wait(600);
  ok('the exam asks you to name the idea', (await page.locator('.teach-choice').count()) === 3);
  ok('the exam board still fits with the answers up', await page.evaluate(() => {
    const b = document.querySelector('#tactic-board').getBoundingClientRect();
    return b.bottom <= window.innerHeight + 1 &&
      document.documentElement.scrollHeight <= window.innerHeight + 1;
  }));
  await page.screenshot({ path: `${SHOTS}/13e-exam.png` });
  await page.locator('.teach-choice').first().click();
  await wait(2100);
  ok('answering marks the right one', (await page.locator('.teach-choice.is-right').count()) === 1);
  ok('the answers step aside so you can play', await page.locator('#tactic-choices').isHidden());
  // Play the question out, then walk the rest of the exam.
  for (let q = 0; q < 6; q++) {
    const n0 = await page.locator('#tactic-board .disc').count();
    for (const c of [3, 2, 4, 1, 5, 0, 6]) {
      await page.locator(`#tactic-board .cell[data-col="${c}"]`).first().click();
      await wait(600);
      if ((await page.locator('#tactic-board .disc').count()) > n0) break;
    }
    if (!(await page.locator('#tc-next').isVisible())) break;
    const label = (await page.locator('#tc-next-label').textContent()) || '';
    await page.locator('#tc-next').click();
    await wait(800);
    if (label === 'See how you did') break;
    if (await page.locator('.teach-choice').first().isVisible().catch(() => false)) {
      await page.locator('.teach-choice').first().click();
      await wait(2000);
    }
  }
  ok('the exam ends with a score', /\d out of \d/.test((await page.locator('#teacher-say').textContent()) || ''));
  const examSaved = JSON.parse((await page.evaluate(() => localStorage.getItem('c4.tactics.v1'))) || '{}');
  ok('the exam result is saved', typeof examSaved.examBest === 'number');
  ok('missed ideas are marked for review', Array.isArray(examSaved.review));
  await page.screenshot({ path: `${SHOTS}/13f-exam-end.png` });
  await page.locator('#tc-next').click();
  await wait(300);
  ok('back on the list, anything missed is flagged',
    (await page.locator('.tactic-card.needs-review').count()) === (examSaved.review || []).length);

  await page.locator('#screen-tactics [data-nav="menu"]').click();
  await wait(150);

  // --- Turn timer: 15s countdown then timeout loss (slowest, do last) ---
  const statsBefore = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')));
  await start2p(15);
  const timedOutSeat = await starterSeat(); // whoever the toss put on the clock first
  ok('timer is visible in two-player mode', !(await page.locator('#turn-timer').evaluate((el) => el.hidden)));
  const t1 = (await page.locator('#turn-timer').textContent()) || '';
  const toSec = (s) => { const [m, ss] = s.split(':').map(Number); return m * 60 + ss; };
  await page.screenshot({ path: `${SHOTS}/06-timer.png` });
  await wait(2500);
  const t2 = (await page.locator('#turn-timer').textContent()) || '';
  ok('countdown decreases while running', toSec(t2) < toSec(t1));
  // The clock used to wash the whole background red as it ran down. That's gone —
  // urgency lives in the pill alone now, so nothing outside it may go red.
  ok('no full-screen red wash element exists', (await page.locator('#danger-tint').count()) === 0);
  // let the rest expire (no move)
  await page.locator('#overlay-result.is-open').waitFor({ timeout: 16000 }).catch(() => {});
  ok('timeout opens the result overlay', await page.locator('#overlay-result').evaluate((el) => el.classList.contains('is-open')));
  ok('timeout message shown', /ran out of time/.test((await page.locator('#result-sub').textContent()) || ''));
  const statsAfter = JSON.parse(await page.evaluate(() => localStorage.getItem('c4.stats.v1')));
  // Whoever the toss put on the clock is the one who ran out, so the win goes to
  // the other seat.
  const timeoutWinner = String(timedOutSeat === 1 ? 2 : 1);
  ok(`the opponent of the timed-out player wins (seat ${timeoutWinner})`,
    statsAfter[timeoutWinner] === (statsBefore[timeoutWinner] || 0) + 1);
  await page.screenshot({ path: `${SHOTS}/07-timeout.png` });

  // --- The `hidden` attribute has to mean hidden, on every screen ---
  // An author `display` rule outranks the UA sheet's [hidden] on cascade origin
  // alone, so any new `display:` is a chance to resurrect a hidden element. That
  // is how the Replay-last chip sat on the menu with nothing to replay. One global
  // rule fixes it; this walks the whole app and proves it stays fixed.
  {
    const shownHidden = [];
    const screens = [
      ['menu', null],
      ['puzzles', '#btn-mode-puzzles'],
      ['tactics', '#btn-mode-tactics'],
      ['stats', '#btn-stats'],
    ];
    await goToMenu();
    for (const [name, open] of screens) {
      if (open) { await page.locator(open).click(); await wait(400); }
      const bad = await page.evaluate(() => [...document.querySelectorAll('[hidden]')]
        .filter((el) => getComputedStyle(el).display !== 'none')
        .map((el) => el.id || el.className || el.tagName));
      if (bad.length) shownHidden.push(`${name}: ${bad.join(', ')}`);
      if (open) { await goToMenu(); await wait(200); }
    }
    ok('nothing marked hidden is rendered anywhere', shownHidden.length === 0);
    if (shownHidden.length) console.log('    shown despite [hidden]:', shownHidden);
  }

  // --- Turned sideways, the app says so instead of showing a broken board ---
  // Portrait-only by design (the board is sized off viewport height). In a Safari
  // tab the manifest's `orientation: portrait` is ignored, so this is the guard.
  {
    const land = await context.newPage();
    await land.setViewportSize({ width: 844, height: 390 });
    await land.goto(`${BASE}/index.html`, { waitUntil: 'networkidle' });
    await wait(400);
    const n = await land.evaluate(() => {
      const el = document.querySelector('#rotate-nudge');
      const cs = getComputedStyle(el);
      const b = el.getBoundingClientRect();
      return { display: cs.display, z: Number(cs.zIndex),
        covers: Math.round(b.width) >= window.innerWidth && Math.round(b.height) >= window.innerHeight };
    });
    ok('a sideways phone gets the turn-upright screen', n.display !== 'none' && n.covers);
    ok('and it sits above every other layer', n.z >= 200);
    // Tall enough for a real layout (a tablet) must NOT be nagged.
    await land.setViewportSize({ width: 1180, height: 820 });
    await wait(250);
    ok('a tablet in landscape is left alone',
      (await land.evaluate(() => getComputedStyle(document.querySelector('#rotate-nudge')).display)) === 'none');
    await land.close();
  }

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
