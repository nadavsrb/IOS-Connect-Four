// Connect Four — UI controller.
// Wires the pure engine + bot to the DOM: screens, drop animation, scoreboard,
// sound, haptics, custom names/colours, persistence and the service worker.

import {
  P1,
  P2,
  EMPTY,
  ROWS,
  COLS,
  createBoard,
  cloneBoard,
  dropDisc,
  popDisc,
  canPop,
  checkWin,
  findWinFor,
  hasAnyMove,
  other,
} from './engine.js';
import { chooseMove, winChance } from './bot.js';

const $ = (sel, root = document) => root.querySelector(sel);

const PALETTE = [
  { name: 'Pink', value: '#ff3d7f' },
  { name: 'Red', value: '#ff3b30' },
  { name: 'Cyan', value: '#3dd7ff' },
  { name: 'Purple', value: '#b26bff' },
  { name: 'Lime', value: '#7cff6b' },
  { name: 'Yellow', value: '#ffd23f' },
  { name: 'Orange', value: '#ff8f3d' },
];

const THEMES = ['neon', 'classic', 'minimal'];
const THEME_LABEL = { neon: 'Neon', classic: 'Classic', minimal: 'Minimal' };

// ---------------------------------------------------------------- persistence

const PREFS_KEY = 'c4.prefs.v1';
const STATS_KEY = 'c4.stats.v1';

const DEFAULT_PREFS = {
  p1name: '',
  p2name: '',
  botname: 'Bot',
  c1: '#ff3d7f',
  c2: '#3dd7ff',
  difficulty: 'medium',
  timerSeconds: 0, // 0 = off; two-player mode only
  variant: 'classic', // 'classic' | 'popout'
  matchTarget: 1, // rounds needed to win the match: 1 = single, 2 = best of 3, 3 = best of 5
  theme: 'neon', // 'neon' | 'classic' | 'minimal'
  muted: false,
};

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return { ...fallback };
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode) — ignore */
  }
}

let prefs = loadJSON(PREFS_KEY, DEFAULT_PREFS);
let stats = loadJSON(STATS_KEY, { 1: 0, 2: 0, draws: 0 });
const savePrefs = () => saveJSON(PREFS_KEY, prefs);
const saveStats = () => saveJSON(STATS_KEY, stats);

// ---------------------------------------------------------------- sound (Web Audio)

const sound = (() => {
  let ctx = null;
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = 'sine', gain = 0.12, when = 0) {
    if (prefs.muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  return {
    unlock: ensure,
    drop() {
      tone(230, 0.12, 'triangle', 0.14);
      tone(150, 0.16, 'sine', 0.09, 0.01);
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.24, 'triangle', 0.13, i * 0.1));
    },
    draw() {
      tone(300, 0.2, 'sine', 0.1);
      tone(240, 0.3, 'sine', 0.09, 0.13);
    },
    invalid() {
      tone(120, 0.16, 'sawtooth', 0.08);
    },
    click() {
      tone(460, 0.05, 'square', 0.04);
    },
    tick() {
      tone(700, 0.05, 'sine', 0.05);
    },
  };
})();

// ---------------------------------------------------------------- haptics

function haptic(pattern) {
  // navigator.vibrate works on Android/Chrome; iOS Safari currently ignores it.
  if (navigator.vibrate) {
    try {
      navigator.vibrate(pattern);
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------- DOM refs

const boardEl = $('#board');
const turnIndicator = $('#turn-indicator');
const turnDot = $('#turn-dot');
const turnText = $('#turn-text');
const overlay = $('#overlay-result');
const undoBtn = $('#btn-undo');

const name1 = $('#name-1');
const name2 = $('#name-2');
const swatches1 = $('#swatches-1');
const swatches2 = $('#swatches-2');
const difficultyBlock = $('#difficulty-block');
const diffSegs = Array.from(document.querySelectorAll('#difficulty .seg'));
const timerBlock = $('#timer-block');
const timerSegs = Array.from(document.querySelectorAll('#timer-select .seg'));
const variantSegs = Array.from(document.querySelectorAll('#variant-select .seg'));
const variantHint = $('#variant-hint');
const matchSegs = Array.from(document.querySelectorAll('#match-select .seg'));
const turnTimerEl = $('#turn-timer');
const turnTimerBar = $('#turn-timerbar');
const confettiLayer = $('#confetti');
const soundChip = $('#btn-sound');
const themeChip = $('#btn-theme');
const popToggleBtn = $('#btn-poptoggle');
const hintBtn = $('#btn-hint');
const seriesLine = $('#series-line');
const seriesP1 = $('#series-p1');
const seriesP2 = $('#series-p2');
const seriesLabel = $('#series-label');

const evalP1 = $('#eval-p1');
const evalP2 = $('#eval-p2');
const evalLabel = $('#eval-label');

const replayLastChip = $('#btn-replay-last');
const replayBoardEl = $('#replay-board');
const replayCaption = $('#replay-caption');
const replayCounter = $('#replay-counter');
const rpPlayBtn = $('#rp-play');

// ---------------------------------------------------------------- state

const game = {
  mode: 'bot',
  difficulty: 'medium',
  variant: 'classic',
  board: createBoard(),
  current: P1,
  startingPlayer: P1,
  active: false,
  over: false,
  locked: false,
  history: [],
  moveLog: [], // {type:'drop'|'pop', col} in play order — recorded for replay
  lastMove: null, // {row, col} of the most recent drop (null after a pop / reset)
  popArmed: false, // pop-out: next tap pops instead of drops
  timerSeconds: 0,
  matchTarget: 1, // rounds to win the match
  series: { 1: 0, 2: 0 }, // round wins in the current match
  names: { 1: 'Player 1', 2: 'Player 2' },
  colors: { 1: '#ff3d7f', 2: '#3dd7ff' },
};

let pendingMode = 'bot';
const selectedColor = { 1: prefs.c1, 2: prefs.c2 };
let selectedDifficulty = prefs.difficulty;
let selectedTimer = prefs.timerSeconds;
let selectedVariant = prefs.variant;
let selectedMatch = prefs.matchTarget;
let resultPrimaryAction = 'again'; // 'again' | 'next' | 'newmatch'

// Most-recent finished game, for replay (persisted across reloads).
const LASTGAME_KEY = 'c4.lastgame.v1';
let lastGame = loadLastGame();
function loadLastGame() {
  try {
    return JSON.parse(localStorage.getItem(LASTGAME_KEY)) || null;
  } catch {
    return null;
  }
}

// Bumped whenever the round is reset/undone; pending async move callbacks compare
// against it and bail out if the game moved on (prevents phantom moves).
let moveGen = 0;

function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Turn-timer bookkeeping
let timerInterval = null;
let timerDeadline = 0;
let lastTickSecond = -1;
const DANGER_MAX = 0.8; // peak opacity of the red "time running out" background wash

const colorFor = (player) => game.colors[player];

// ---------------------------------------------------------------- screens

function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s.id === id));
}

// ---------------------------------------------------------------- setup screen

function buildSwatches(seat, container) {
  container.innerHTML = '';
  PALETTE.forEach((col) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.style.setProperty('--sw', col.value);
    b.dataset.color = col.value;
    b.setAttribute('aria-label', col.name);
    b.addEventListener('click', () => selectColor(seat, col.value));
    container.appendChild(b);
  });
}

function selectColor(seat, value) {
  const otherSeat = seat === 1 ? 2 : 1;
  if (selectedColor[otherSeat] === value) return; // colour already taken
  selectedColor[seat] = value;
  refreshSwatches();
  applySelectedColors();
  sound.unlock();
  sound.click();
}

function refreshSwatches() {
  [
    [1, swatches1],
    [2, swatches2],
  ].forEach(([seat, cont]) => {
    const otherSeat = seat === 1 ? 2 : 1;
    cont.querySelectorAll('.swatch').forEach((b) => {
      const v = b.dataset.color;
      b.setAttribute('aria-pressed', String(v === selectedColor[seat]));
      b.disabled = v === selectedColor[otherSeat];
    });
  });
}

function applySelectedColors() {
  document.documentElement.style.setProperty('--p1', selectedColor[1]);
  document.documentElement.style.setProperty('--p2', selectedColor[2]);
}

function refreshDifficulty() {
  diffSegs.forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.diff === selectedDifficulty)));
}

function refreshTimer() {
  timerSegs.forEach((s) => s.setAttribute('aria-pressed', String(Number(s.dataset.timer) === selectedTimer)));
}

function refreshVariant() {
  variantSegs.forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.variant === selectedVariant)));
  variantHint.textContent =
    selectedVariant === 'popout'
      ? 'Pop-Out: on your turn you may drop, or pop one of your own bottom discs to slide a column down.'
      : '';
}

function refreshMatch() {
  matchSegs.forEach((s) => s.setAttribute('aria-pressed', String(Number(s.dataset.match) === selectedMatch)));
}

function openSetup(mode) {
  pendingMode = mode;
  // Difficulty is bot-only; the turn timer is two-player-only.
  difficultyBlock.style.display = mode === 'bot' ? '' : 'none';
  timerBlock.style.display = mode === '2p' ? '' : 'none';

  name1.value = prefs.p1name;
  name1.placeholder = mode === 'bot' ? 'You' : 'Player 1';
  name2.value = mode === 'bot' ? prefs.botname : prefs.p2name;
  name2.placeholder = mode === 'bot' ? 'Bot' : 'Player 2';

  selectedColor[1] = prefs.c1;
  selectedColor[2] = prefs.c2 === prefs.c1 ? firstFreeColor(prefs.c1) : prefs.c2;
  selectedDifficulty = prefs.difficulty;
  selectedTimer = prefs.timerSeconds;
  selectedVariant = prefs.variant;
  selectedMatch = prefs.matchTarget;

  refreshSwatches();
  refreshDifficulty();
  refreshTimer();
  refreshVariant();
  refreshMatch();
  applySelectedColors();
  showScreen('screen-setup');
}

function firstFreeColor(taken) {
  const found = PALETTE.find((p) => p.value !== taken);
  return found ? found.value : PALETTE[0].value;
}

function startFromSetup() {
  if (selectedColor[1] === selectedColor[2]) {
    selectedColor[2] = firstFreeColor(selectedColor[1]);
  }
  prefs.p1name = name1.value.trim();
  if (pendingMode === 'bot') prefs.botname = name2.value.trim() || 'Bot';
  else prefs.p2name = name2.value.trim();
  prefs.c1 = selectedColor[1];
  prefs.c2 = selectedColor[2];
  prefs.difficulty = selectedDifficulty;
  if (pendingMode === '2p') prefs.timerSeconds = selectedTimer;
  prefs.variant = selectedVariant;
  prefs.matchTarget = selectedMatch;
  savePrefs();
  startGame(pendingMode);
}

// ---------------------------------------------------------------- board render

function buildBoard() {
  boardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      cell.setAttribute('role', 'gridcell');
      const socket = document.createElement('div');
      socket.className = 'socket';
      cell.appendChild(socket);
      boardEl.appendChild(cell);
    }
  }
}

const cellIn = (bEl, r, c) => bEl.children[r * COLS + c];
const cellAt = (r, c) => cellIn(boardEl, r, c);

// Create a disc in cell (r,c) of board element `bEl`. If `drop`, animate it
// falling from the top. Shared by the live game board and the replay board.
function spawnDisc(bEl, r, c, color, { drop = false } = {}) {
  const cell = cellIn(bEl, r, c);
  const disc = document.createElement('div');
  disc.className = 'disc';
  disc.style.setProperty('--disc', color);
  if (drop) {
    disc.classList.add('dropping');
    const bRect = bEl.getBoundingClientRect();
    const cRect = cell.getBoundingClientRect();
    disc.style.setProperty('--from', `${-(cRect.top - bRect.top)}px`);
  }
  cell.appendChild(disc);
  return disc;
}

function placeDisc(r, c, player) {
  return spawnDisc(boardEl, r, c, colorFor(player), { drop: true });
}

function onceAnimation(disc, cb) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    disc.classList.remove('dropping');
    cb();
  };
  disc.addEventListener('animationend', run, { once: true });
  setTimeout(run, 700); // safety net if animationend doesn't fire
}

// ---------------------------------------------------------------- gameplay

function startGame(mode) {
  game.mode = mode;
  game.difficulty = selectedDifficulty;
  game.variant = selectedVariant;
  game.timerSeconds = mode === '2p' ? selectedTimer : 0; // timer is two-player only
  game.matchTarget = selectedMatch;
  game.series = { 1: 0, 2: 0 };
  game.startingPlayer = P1; // a brand-new match always starts with Player 1
  game.names[1] = name1.value.trim() || name1.placeholder;
  game.names[2] = name2.value.trim() || name2.placeholder;
  game.colors[1] = selectedColor[1];
  game.colors[2] = selectedColor[2];
  document.documentElement.style.setProperty('--p1', game.colors[1]);
  document.documentElement.style.setProperty('--p2', game.colors[2]);

  resetRoundState();
  renderScores();
  showScreen('screen-game');
}

function resetRoundState() {
  moveGen++; // invalidate any in-flight move callbacks from the previous round
  stopTurnTimer();
  game.board = createBoard();
  game.current = game.startingPlayer;
  game.active = true;
  game.over = false;
  game.locked = false;
  game.history = [];
  game.moveLog = [];
  game.lastMove = null;
  game.popArmed = false;
  clearHint();
  buildBoard();
  updateTurnIndicator();
  updateUndoBtn();
  updateHintBtn();
  updatePopControl();
  updateEvalBar();
  renderSeries();
  closeOverlay();
  startTurnTimer();
  maybeBotMove(); // handles the case where the bot is the starting player this round
}

function restartRound() {
  game.startingPlayer = other(game.startingPlayer); // alternate who goes first each round
  resetRoundState();
}

function newMatch() {
  game.series = { 1: 0, 2: 0 };
  game.startingPlayer = P1;
  resetRoundState();
}

function humanPlay(col) {
  if (!game.active || game.locked || game.over) return;
  if (game.mode === 'bot' && game.current === P2) return; // bot's turn
  if (game.variant === 'popout' && game.popArmed) attemptPop(col);
  else attemptDrop(col);
}

// Snapshot the board+turn before a move so undo works for both drops and pops.
function pushSnapshot() {
  game.history.push({ board: cloneBoard(game.board), current: game.current, last: game.lastMove });
}

// Hand the turn to the other player once a move has settled without ending the round.
function passTurn() {
  game.current = other(game.current);
  game.popArmed = false;
  updateTurnIndicator();
  updatePopControl();
  updateEvalBar();
  game.locked = false;
  updateUndoBtn();
  updateHintBtn();
  startTurnTimer();
  maybeBotMove();
}

function rejectMove(col) {
  shakeColumn(col);
  sound.invalid();
  haptic([15, 30, 15]);
}

function attemptDrop(col) {
  if (col == null) return;
  if (game.board[0][col] !== EMPTY) return rejectMove(col); // column full
  clearHint();
  stopTurnTimer(); // the move was made in time
  game.locked = true;
  updateUndoBtn();
  pushSnapshot();
  game.moveLog.push({ type: 'drop', col });

  const gen = moveGen;
  const landing = dropDisc(game.board, col, game.current);
  game.lastMove = { row: landing.row, col: landing.col };
  const disc = placeDisc(landing.row, landing.col, game.current);
  markLastMoveEl(disc);
  sound.drop();
  haptic(12);

  const cells = checkWin(game.board, landing.row, landing.col);
  const draw = !cells && !hasAnyMove(game.board, other(game.current), game.variant);

  onceAnimation(disc, () => {
    if (gen !== moveGen || !game.active) return; // round was reset / left mid-animation
    if (cells) return endGame(game.current, cells);
    if (draw) return endGame('draw', null);
    passTurn();
  });
}

// Pop-Out: remove one of your own bottom discs; the column slides down.
function attemptPop(col) {
  if (!canPop(game.board, col, game.current)) return rejectMove(col);
  clearHint();
  stopTurnTimer();
  game.locked = true;
  updateUndoBtn();
  pushSnapshot();
  game.moveLog.push({ type: 'pop', col });

  const gen = moveGen;
  popDisc(game.board, col, game.current);
  game.lastMove = null;
  renderPopAnimated(col); // pop the bottom disc out; the rest fall down a row
  sound.drop();
  haptic([10, 20]);

  // A pop can complete four-in-a-row for either player, anywhere on the board.
  const mine = findWinFor(game.board, game.current);
  const theirs = findWinFor(game.board, other(game.current));
  const draw = !mine && !theirs && !hasAnyMove(game.board, other(game.current), game.variant);

  setTimeout(() => {
    if (gen !== moveGen || !game.active) return; // round was reset / left mid-move
    if (mine && theirs) return endGame('draw', null); // both lines at once → draw
    if (mine) return endGame(game.current, mine);
    if (theirs) return endGame(other(game.current), theirs);
    if (draw) return endGame('draw', null);
    passTurn();
  }, 400);
}

function maybeBotMove() {
  if (game.mode !== 'bot' || game.over || !game.active) return;
  if (game.current !== P2) return;
  game.locked = true;
  updateUndoBtn();
  setThinking(true);
  const gen = moveGen;
  const delay = 420 + Math.random() * 340;
  setTimeout(() => {
    // Bail if the round was reset/left, or it's somehow no longer the bot's turn.
    if (gen !== moveGen || game.over || !game.active || game.current !== P2) return;
    setThinking(false);
    updateTurnIndicator(); // show "Bot's turn" (not "thinking") while the disc drops
    const col = chooseMove(game.board, P2, game.difficulty);
    if (col == null) {
      game.locked = false;
      return;
    }
    attemptDrop(col);
  }, delay);
}

function endGame(winner, cells, reason) {
  game.over = true;
  game.active = false;
  game.locked = true;
  game.popArmed = false;
  stopTurnTimer();
  updateUndoBtn();
  updatePopControl();
  updateHintBtn();
  recordLastGame(winner, cells, reason);
  setEvalFinal(winner);

  if (winner === 'draw') {
    stats.draws++;
    saveStats();
    renderScores();
    sound.draw();
    haptic([20, 40, 20]);
    setTimeout(() => showResult('draw', reason, false), 300);
    return;
  }

  stats[winner]++;
  game.series[winner] += 1;
  const matchOver = game.series[winner] >= game.matchTarget;
  saveStats();
  renderScores();
  renderSeries();
  if (cells) highlightWin(cells); // timeout wins have no line to highlight
  burstConfetti();
  sound.win();
  haptic([30, 30, 30, 30, 140]);
  setTimeout(() => showResult(winner, reason, matchOver), cells ? 850 : 450);
}

function highlightWin(cells) {
  cells.forEach(([r, c]) => {
    const disc = cellAt(r, c).querySelector('.disc');
    if (disc) disc.classList.add('win');
  });
}

function undo() {
  if (game.locked || game.over || !game.active || game.history.length === 0) return;
  // vs Bot, undo both the bot's reply and your move so it's your turn again.
  const plies = game.mode === 'bot' ? Math.min(2, game.history.length) : 1;
  let snap = null;
  for (let i = 0; i < plies && game.history.length; i++) {
    snap = game.history.pop();
    game.moveLog.pop();
  }
  if (!snap) return;
  moveGen++; // invalidate any in-flight callbacks
  clearHint();
  game.board = cloneBoard(snap.board);
  game.current = snap.current;
  game.lastMove = snap.last;
  game.popArmed = false;
  renderBoardDiscs(); // repaint from the restored board (handles drops and pops)
  updateTurnIndicator();
  updatePopControl();
  updateUndoBtn();
  updateHintBtn();
  updateEvalBar();
  startTurnTimer(); // restart this player's countdown
  sound.click();
}

// ---------------------------------------------------------------- indicators / scores

function updateTurnIndicator() {
  turnIndicator.classList.remove('thinking');
  turnDot.style.setProperty('--turn-color', colorFor(game.current));
  turnText.textContent = `${game.names[game.current]}'s turn`;
}

function setThinking(on) {
  turnIndicator.classList.toggle('thinking', on);
  if (on) {
    turnDot.style.setProperty('--turn-color', colorFor(P2));
    turnText.textContent = `${game.names[2]} is thinking…`;
  }
}

function updateUndoBtn() {
  undoBtn.disabled = game.locked || game.over || !game.active || game.history.length === 0;
}

function renderScores() {
  $('#score-name-1').textContent = game.names[1];
  $('#score-name-2').textContent = game.names[2];
  $('#score-val-1').textContent = String(stats[1]);
  $('#score-val-2').textContent = String(stats[2]);
  $('#score-val-d').textContent = String(stats.draws);
}

// ---------------------------------------------------------------- result overlay

function resultSub(winner) {
  if (game.mode === 'bot') {
    return winner === P1 ? `You beat ${game.names[2]}! 🎉` : `${game.names[2]} got you this time.`;
  }
  return 'Four in a row! 🎉';
}

function showResult(winner, reason, matchOver) {
  const disc = $('#result-disc');
  const series = game.matchTarget > 1;

  if (winner === 'draw') {
    disc.className = 'result-disc draw';
    disc.style.removeProperty('--disc');
    $('#result-title').textContent = "It's a draw!";
    $('#result-sub').textContent = series
      ? `Round drawn — series stays ${game.series[1]}–${game.series[2]}.`
      : 'The board filled up — nobody connected four.';
    resultPrimaryAction = series ? 'next' : 'again';
  } else {
    disc.className = 'result-disc';
    disc.style.setProperty('--disc', colorFor(winner));
    const name = game.names[winner];
    if (series && matchOver) {
      $('#result-title').textContent = `🏆 ${name} wins the match!`;
      $('#result-sub').textContent = `Match won ${game.series[winner]}–${game.series[other(winner)]}.`;
      resultPrimaryAction = 'newmatch';
    } else if (series) {
      $('#result-title').textContent = `${name} takes the round`;
      $('#result-sub').textContent = `Series ${game.series[1]}–${game.series[2]} · first to ${game.matchTarget}.`;
      resultPrimaryAction = 'next';
    } else {
      $('#result-title').textContent = `${name} wins!`;
      $('#result-sub').textContent =
        reason === 'timeout' ? `${game.names[other(winner)]} ran out of time ⏱` : resultSub(winner);
      resultPrimaryAction = 'again';
    }
  }

  $('#btn-playagain').textContent =
    resultPrimaryAction === 'newmatch' ? 'New Match' : resultPrimaryAction === 'next' ? 'Next Round' : 'Play Again';

  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
}

function onResultPrimary() {
  if (resultPrimaryAction === 'newmatch') newMatch();
  else restartRound(); // 'next' keeps the series (alternating start); 'again' is a fresh single game
}

function closeOverlay() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ---------------------------------------------------------------- navigation

function goMenu() {
  stopTurnTimer();
  stopReplayPlay();
  clearHint();
  game.active = false;
  game.over = false;
  game.locked = false;
  closeOverlay();
  updateReplayLastChip();
  showScreen('screen-menu');
}

// ---------------------------------------------------------------- turn timer

function formatClock(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startTurnTimer() {
  stopTurnTimer();
  if (!(game.timerSeconds > 0) || !game.active || game.over) return;
  timerDeadline = Date.now() + game.timerSeconds * 1000;
  lastTickSecond = -1;
  turnTimerEl.hidden = false;
  turnTimerBar.hidden = false;
  turnTimerEl.setAttribute('aria-hidden', 'false');
  tickTimer();
  timerInterval = setInterval(tickTimer, 200);
}

function stopTurnTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  turnTimerEl.hidden = true;
  turnTimerBar.hidden = true;
  turnTimerEl.setAttribute('aria-hidden', 'true');
  turnIndicator.classList.remove('urgent');
  document.documentElement.style.setProperty('--danger', '0'); // clear the red wash
}

function tickTimer() {
  const remainingMs = Math.max(0, timerDeadline - Date.now());
  const remaining = Math.ceil(remainingMs / 1000);
  turnTimerEl.textContent = formatClock(remaining);
  turnTimerBar.style.width = `${Math.max(0, Math.min(1, remainingMs / (game.timerSeconds * 1000))) * 100}%`;

  // From 2/3 elapsed onward, slowly wash the whole background red — the closer
  // to zero, the deeper the red (0 → DANGER_MAX opacity).
  const elapsedFrac = 1 - remainingMs / (game.timerSeconds * 1000);
  const danger = Math.max(0, Math.min(1, (elapsedFrac - 2 / 3) / (1 / 3)));
  document.documentElement.style.setProperty('--danger', (danger * DANGER_MAX).toFixed(3));

  const urgent = remaining <= 5 && remainingMs > 0;
  turnIndicator.classList.toggle('urgent', urgent);
  if (urgent && remaining !== lastTickSecond) {
    lastTickSecond = remaining;
    sound.tick();
    haptic(8);
  }

  if (remainingMs <= 0) {
    stopTurnTimer();
    onTimeout();
  }
}

function onTimeout() {
  if (!game.active || game.over) return;
  const loser = game.current;
  endGame(other(loser), null, 'timeout'); // running out of time loses the game
}

// ---------------------------------------------------------------- last-move marker

function markLastMoveEl(disc) {
  boardEl.querySelectorAll('.disc.last').forEach((d) => d.classList.remove('last'));
  if (disc) disc.classList.add('last');
}

function applyLastMoveMarker() {
  boardEl.querySelectorAll('.disc.last').forEach((d) => d.classList.remove('last'));
  if (!game.lastMove) return;
  const d = cellAt(game.lastMove.row, game.lastMove.col).querySelector('.disc');
  if (d) d.classList.add('last');
}

// Repaint every disc from game.board (no drop animation). Used after undo.
function renderBoardDiscs() {
  boardEl.querySelectorAll('.disc').forEach((d) => d.remove());
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = game.board[r][c];
      if (p !== EMPTY) spawnDisc(boardEl, r, c, colorFor(p));
    }
  }
  applyLastMoveMarker();
}

// Animate a pop on `col`: the bottom disc drops out, and every disc above slides
// down one row into place (FLIP). Call *after* popDisc has mutated game.board.
function renderPopAnimated(col) {
  if (prefersReducedMotion()) {
    renderBoardDiscs();
    return;
  }
  boardEl.querySelectorAll('.disc.last').forEach((d) => d.classList.remove('last'));

  const discs = [];
  for (let r = 0; r < ROWS; r++) discs[r] = cellAt(r, col).querySelector('.disc');

  // The bottom disc is the one popped out — animate it away, then remove.
  const popped = discs[ROWS - 1];
  if (popped) {
    popped.classList.add('popping-out');
    const remove = () => popped.remove();
    popped.addEventListener('animationend', remove, { once: true });
    setTimeout(remove, 450);
  }

  // Shift each disc above down one row, animating the fall (bottom-up so target
  // cells are already vacated).
  for (let r = ROWS - 1; r >= 1; r--) {
    const disc = discs[r - 1];
    if (!disc) continue;
    const fromTop = disc.getBoundingClientRect().top;
    cellAt(r, col).appendChild(disc); // reparent → new (lower) position
    const dy = fromTop - disc.getBoundingClientRect().top; // negative: it started higher
    disc.style.transition = 'none';
    disc.style.transform = `translateY(${dy}px)`;
    void disc.offsetWidth; // reflow so the invert sticks
    disc.style.transition = 'transform 0.34s cubic-bezier(0.34, 0.08, 0.2, 1)';
    disc.style.transform = 'translateY(0)';
    const cleanup = () => {
      disc.style.transition = '';
      disc.style.transform = '';
    };
    disc.addEventListener('transitionend', cleanup, { once: true });
    setTimeout(cleanup, 500);
  }
}

// ---------------------------------------------------------------- confetti

function burstConfetti() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!confettiLayer) return;

  const colors = [game.colors[1], game.colors[2], '#ffd23f', '#7cff6b', '#b26bff', '#3dd7ff'];
  const rect = confettiLayer.getBoundingClientRect();
  const width = rect.width || 360;
  const pieces = [];
  const COUNT = 90;

  for (let i = 0; i < COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.background = colors[i % colors.length];
    el.style.left = `${Math.random() * width}px`;
    confettiLayer.appendChild(el);
    pieces.push({
      el,
      x: 0,
      y: -20 - Math.random() * 40,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * 360,
      vr: (Math.random() - 0.5) * 24,
      life: 0,
    });
  }

  const gravity = 0.18;
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    for (const p of pieces) {
      p.vy += gravity;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const opacity = t < 900 ? 1 : Math.max(0, 1 - (t - 900) / 400);
      p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}deg)`;
      p.el.style.opacity = String(opacity);
    }
    if (t < 1300) {
      requestAnimationFrame(frame);
    } else {
      pieces.forEach((p) => p.el.remove());
    }
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- full-column shake

function shakeColumn(col) {
  for (let r = 0; r < ROWS; r++) {
    const cell = cellAt(r, col);
    if (!cell) continue;
    cell.classList.remove('shake');
    // force reflow so re-adding the class restarts the animation
    void cell.offsetWidth;
    cell.classList.add('shake');
    cell.addEventListener('animationend', () => cell.classList.remove('shake'), { once: true });
  }
}

// ---------------------------------------------------------------- pop-out control

function updatePopControl() {
  if (!popToggleBtn) return;
  const show = game.variant === 'popout' && game.active && !game.over;
  popToggleBtn.hidden = !show;
  popToggleBtn.setAttribute('aria-pressed', String(game.popArmed));
  popToggleBtn.classList.toggle('armed', game.popArmed);
  popToggleBtn.textContent = game.popArmed ? '↥ Popping' : '↥ Pop out';
  boardEl.classList.toggle('pop-mode', show && game.popArmed);
}

function togglePop() {
  if (game.variant !== 'popout' || !game.active || game.locked || game.over) return;
  if (game.mode === 'bot' && game.current === P2) return;
  game.popArmed = !game.popArmed;
  updatePopControl();
  sound.click();
}

// ---------------------------------------------------------------- match series

function renderSeries() {
  if (!seriesLine) return;
  if (game.matchTarget <= 1) {
    seriesLine.hidden = true;
    return;
  }
  seriesLine.hidden = false;
  seriesLabel.textContent = `First to ${game.matchTarget}`;
  buildPips(seriesP1, game.series[1], colorFor(1));
  buildPips(seriesP2, game.series[2], colorFor(2));
}

function buildPips(container, filled, color) {
  container.innerHTML = '';
  for (let i = 0; i < game.matchTarget; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < filled ? ' filled' : '');
    if (i < filled) pip.style.background = color;
    container.appendChild(pip);
  }
}

// ---------------------------------------------------------------- theme

function applyTheme(theme) {
  const t = THEMES.includes(theme) ? theme : 'neon';
  document.documentElement.setAttribute('data-theme', t);
  if (themeChip) themeChip.querySelector('.chip-label').textContent = THEME_LABEL[t];
}

function cycleTheme() {
  const idx = THEMES.indexOf(prefs.theme);
  prefs.theme = THEMES[(idx + 1) % THEMES.length];
  savePrefs();
  applyTheme(prefs.theme);
  sound.click();
}

// ---------------------------------------------------------------- win-% eval bar

function renderEval(pct) {
  evalP1.style.width = `${pct[P1]}%`;
  evalP2.style.width = `${pct[P2]}%`;
  evalP1.style.background = colorFor(P1);
  evalP2.style.background = colorFor(P2);
  evalLabel.textContent = `${game.names[1]} ${pct[P1]}% · ${game.names[2]} ${pct[P2]}%`;
}

function updateEvalBar() {
  if (!game.active || game.over) return; // final state is set by setEvalFinal()
  renderEval(winChance(game.board, game.current, 6));
}

function setEvalFinal(winner) {
  if (winner === 'draw') renderEval({ [P1]: 50, [P2]: 50 });
  else renderEval({ [P1]: winner === P1 ? 100 : 0, [P2]: winner === P2 ? 100 : 0 });
}

// ---------------------------------------------------------------- best-move hint

let hintTimer = null;

function updateHintBtn() {
  if (!hintBtn) return;
  const humansTurn = !(game.mode === 'bot' && game.current === P2);
  hintBtn.disabled = !(game.active && !game.over && !game.locked && humansTurn);
}

function clearHint() {
  if (hintTimer) {
    clearTimeout(hintTimer);
    hintTimer = null;
  }
  boardEl.querySelectorAll('.cell.hint').forEach((c) => c.classList.remove('hint'));
  boardEl.querySelectorAll('.disc.ghost').forEach((d) => d.remove());
}

function showHint() {
  if (!game.active || game.over || game.locked) return;
  if (game.mode === 'bot' && game.current === P2) return;
  clearHint();
  const col = chooseMove(cloneBoard(game.board), game.current, 'insane');
  if (col == null) return;
  let row = -1;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (game.board[r][col] === EMPTY) { row = r; break; }
  }
  if (row < 0) return;
  for (let r = 0; r < ROWS; r++) cellAt(r, col).classList.add('hint');
  const ghost = spawnDisc(boardEl, row, col, colorFor(game.current));
  ghost.classList.add('ghost');
  sound.click();
  hintTimer = setTimeout(clearHint, 2500);
}

// ---------------------------------------------------------------- replay

const replay = { data: null, index: 0, playing: false, timer: null, boards: [] };

function recordLastGame(winner, cells, reason) {
  lastGame = {
    moves: game.moveLog.slice(),
    startingPlayer: game.startingPlayer,
    variant: game.variant,
    names: { 1: game.names[1], 2: game.names[2] },
    colors: { 1: game.colors[1], 2: game.colors[2] },
    winner, // 1 | 2 | 'draw'
    winningCells: cells || null,
    reason: reason || null,
  };
  try {
    localStorage.setItem(LASTGAME_KEY, JSON.stringify(lastGame));
  } catch {
    /* storage unavailable — replay just won't survive a reload */
  }
}

function updateReplayLastChip() {
  if (replayLastChip) replayLastChip.hidden = !lastGame;
}

function buildReplayBoard() {
  replayBoardEl.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      const socket = document.createElement('div');
      socket.className = 'socket';
      cell.appendChild(socket);
      replayBoardEl.appendChild(cell);
    }
  }
}

// Board after each prefix of moves: boards[0] = empty, boards[k] = after k moves.
function computeReplayBoards(data) {
  const boards = [createBoard()];
  const b = createBoard();
  let cur = data.startingPlayer;
  for (const mv of data.moves) {
    if (mv.type === 'pop') popDisc(b, mv.col, cur);
    else dropDisc(b, mv.col, cur);
    boards.push(cloneBoard(b));
    cur = other(cur);
  }
  return boards;
}

function replayCaptionText(d) {
  const vs = `${d.names[1]} vs ${d.names[2]}`;
  if (d.winner === 'draw') return `${vs} — Draw`;
  const w = d.names[d.winner];
  return d.reason === 'timeout' ? `${vs} — ${w} won on time` : `${vs} — ${w} won`;
}

function renderReplayBoard(index, animate) {
  const board = replay.boards[index];
  replayBoardEl.querySelectorAll('.disc').forEach((d) => d.remove());

  // Which cell (if any) to animate as a fresh drop when stepping forward one move.
  let animCell = null;
  if (animate && index > 0) {
    const mv = replay.data.moves[index - 1];
    if (mv.type === 'drop') {
      const prev = replay.boards[index - 1];
      for (let r = 0; r < ROWS; r++) {
        if (board[r][mv.col] !== EMPTY && prev[r][mv.col] === EMPTY) {
          animCell = { r, c: mv.col };
          break;
        }
      }
    }
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const p = board[r][c];
      if (p === EMPTY) continue;
      const drop = !!(animCell && animCell.r === r && animCell.c === c);
      spawnDisc(replayBoardEl, r, c, replay.data.colors[p], { drop });
    }
  }

  if (index === replay.data.moves.length && replay.data.winningCells) {
    replay.data.winningCells.forEach(([r, c]) => {
      const d = cellIn(replayBoardEl, r, c).querySelector('.disc');
      if (d) d.classList.add('win');
    });
  }
  updateReplayControls();
}

function updateReplayControls() {
  const n = replay.data ? replay.data.moves.length : 0;
  replayCounter.textContent = `Move ${replay.index} / ${n}`;
}

function enterReplay(data) {
  if (!data || !data.moves || data.moves.length === 0) return;
  stopReplayPlay();
  clearHint();
  stopTurnTimer();
  replay.data = data;
  replay.boards = computeReplayBoards(data);
  replay.index = 0;
  buildReplayBoard();
  replayCaption.textContent = replayCaptionText(data);
  renderReplayBoard(0, false);
  showScreen('screen-replay');
}

function replayStepTo(index, animateForwardOne) {
  const n = replay.data.moves.length;
  replay.index = Math.max(0, Math.min(n, index));
  renderReplayBoard(replay.index, animateForwardOne);
}

function replayStep(delta) {
  const target = replay.index + delta;
  replayStepTo(target, delta === 1 && target === replay.index + 1);
}

function toggleReplayPlay() {
  if (replay.playing) {
    stopReplayPlay();
    return;
  }
  if (replay.index >= replay.data.moves.length) replayStepTo(0, false); // restart from the top
  replay.playing = true;
  rpPlayBtn.textContent = '⏸ Pause';
  replay.timer = setInterval(() => {
    if (replay.index >= replay.data.moves.length) {
      stopReplayPlay();
      return;
    }
    replayStep(1);
  }, 750);
}

function stopReplayPlay() {
  replay.playing = false;
  if (rpPlayBtn) rpPlayBtn.textContent = '▶ Play';
  if (replay.timer) {
    clearInterval(replay.timer);
    replay.timer = null;
  }
}

// ---------------------------------------------------------------- sound toggle & stats reset

function updateSoundChip() {
  soundChip.setAttribute('aria-pressed', String(!prefs.muted));
  soundChip.querySelector('.chip-icon').textContent = prefs.muted ? '🔇' : '🔊';
  soundChip.querySelector('.chip-label').textContent = prefs.muted ? 'Muted' : 'Sound';
}

function toggleSound() {
  prefs.muted = !prefs.muted;
  savePrefs();
  updateSoundChip();
  if (!prefs.muted) {
    sound.unlock();
    sound.click();
  }
}

function resetStats() {
  stats = { 1: 0, 2: 0, draws: 0 };
  saveStats();
  renderScores();
  const label = $('#btn-reset-stats .chip-label');
  const prev = label.textContent;
  label.textContent = 'Cleared ✓';
  setTimeout(() => {
    label.textContent = prev;
  }, 1200);
}

// ---------------------------------------------------------------- column hover (pointer devices)

function setHoverCol(col) {
  boardEl.querySelectorAll('.cell.col-hover').forEach((c) => c.classList.remove('col-hover'));
  if (col == null || game.locked || game.over || !game.active) return;
  if (game.mode === 'bot' && game.current === P2) return;
  for (let r = 0; r < ROWS; r++) cellAt(r, col).classList.add('col-hover');
}

// ---------------------------------------------------------------- wiring

function wire() {
  buildSwatches(1, swatches1);
  buildSwatches(2, swatches2);
  updateSoundChip();
  applyTheme(prefs.theme);

  $('#btn-mode-bot').addEventListener('click', () => openSetup('bot'));
  $('#btn-mode-2p').addEventListener('click', () => openSetup('2p'));
  $('#btn-start').addEventListener('click', startFromSetup);
  $('#btn-restart').addEventListener('click', restartRound);
  $('#btn-newround').addEventListener('click', restartRound);
  $('#btn-playagain').addEventListener('click', onResultPrimary);
  $('#btn-undo').addEventListener('click', undo);
  hintBtn.addEventListener('click', showHint);
  popToggleBtn.addEventListener('click', togglePop);
  soundChip.addEventListener('click', toggleSound);
  themeChip.addEventListener('click', cycleTheme);
  $('#btn-reset-stats').addEventListener('click', resetStats);

  // Replay entry points + controls
  $('#btn-watch-replay').addEventListener('click', () => enterReplay(lastGame));
  replayLastChip.addEventListener('click', () => enterReplay(lastGame));
  $('#rp-start').addEventListener('click', () => { stopReplayPlay(); replayStepTo(0, false); });
  $('#rp-prev').addEventListener('click', () => { stopReplayPlay(); replayStep(-1); });
  rpPlayBtn.addEventListener('click', toggleReplayPlay);
  $('#rp-next').addEventListener('click', () => { stopReplayPlay(); replayStep(1); });
  $('#rp-end').addEventListener('click', () => { stopReplayPlay(); replayStepTo(replay.data.moves.length, false); });
  updateReplayLastChip();

  document.querySelectorAll('[data-nav="menu"]').forEach((el) => el.addEventListener('click', goMenu));

  diffSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedDifficulty = seg.dataset.diff;
      refreshDifficulty();
      sound.click();
    });
  });

  timerSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedTimer = Number(seg.dataset.timer);
      refreshTimer();
      sound.click();
    });
  });

  variantSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedVariant = seg.dataset.variant;
      refreshVariant();
      sound.click();
    });
  });

  matchSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedMatch = Number(seg.dataset.match);
      refreshMatch();
      sound.click();
    });
  });

  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell) return;
    humanPlay(Number(cell.dataset.col));
  });

  if (window.matchMedia('(hover: hover)').matches) {
    boardEl.classList.add('col-hint');
    boardEl.addEventListener('pointermove', (e) => {
      const cell = e.target.closest('.cell');
      setHoverCol(cell ? Number(cell.dataset.col) : null);
    });
    boardEl.addEventListener('pointerleave', () => setHoverCol(null));
  }

  window.addEventListener('pointerdown', () => sound.unlock(), { once: true });

  // Register service worker for offline play (only over http/https).
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // If the page is already controlled, a new worker taking over means an update
    // was deployed — reload once so the fresh app is shown. (Skip on first install,
    // which claims an uncontrolled page and needs no reload.)
    const hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing || !hadController) return;
      refreshing = true;
      window.location.reload();
    });
    window.addEventListener('load', () => {
      // updateViaCache:'none' → the browser always byte-checks the SW script itself
      // instead of serving it from the HTTP cache, so updates are detected promptly.
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).catch(() => {});
    });
  }
}

wire();
