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
  dropDisc,
  checkWin,
  isFull,
  other,
} from './engine.js';
import { chooseMove } from './bot.js';

const $ = (sel, root = document) => root.querySelector(sel);

const PALETTE = [
  { name: 'Pink', value: '#ff3d7f' },
  { name: 'Cyan', value: '#3dd7ff' },
  { name: 'Purple', value: '#b26bff' },
  { name: 'Lime', value: '#7cff6b' },
  { name: 'Yellow', value: '#ffd23f' },
  { name: 'Orange', value: '#ff8f3d' },
];

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
const diffSegs = Array.from(document.querySelectorAll('.seg'));
const soundChip = $('#btn-sound');

// ---------------------------------------------------------------- state

const game = {
  mode: 'bot',
  difficulty: 'medium',
  board: createBoard(),
  current: P1,
  active: false,
  over: false,
  locked: false,
  history: [],
  names: { 1: 'Player 1', 2: 'Player 2' },
  colors: { 1: '#ff3d7f', 2: '#3dd7ff' },
};

let pendingMode = 'bot';
const selectedColor = { 1: prefs.c1, 2: prefs.c2 };
let selectedDifficulty = prefs.difficulty;

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

function openSetup(mode) {
  pendingMode = mode;
  difficultyBlock.style.display = mode === 'bot' ? '' : 'none';

  name1.value = prefs.p1name;
  name1.placeholder = mode === 'bot' ? 'You' : 'Player 1';
  name2.value = mode === 'bot' ? prefs.botname : prefs.p2name;
  name2.placeholder = mode === 'bot' ? 'Bot' : 'Player 2';

  selectedColor[1] = prefs.c1;
  selectedColor[2] = prefs.c2 === prefs.c1 ? firstFreeColor(prefs.c1) : prefs.c2;
  selectedDifficulty = prefs.difficulty;

  refreshSwatches();
  refreshDifficulty();
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

const cellAt = (r, c) => boardEl.children[r * COLS + c];

function placeDisc(r, c, player) {
  const cell = cellAt(r, c);
  const disc = document.createElement('div');
  disc.className = 'disc dropping';
  disc.style.setProperty('--disc', colorFor(player));
  const boardRect = boardEl.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  disc.style.setProperty('--from', `${-(cellRect.top - boardRect.top)}px`);
  cell.appendChild(disc);
  return disc;
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
  game.board = createBoard();
  game.current = P1;
  game.active = true;
  game.over = false;
  game.locked = false;
  game.history = [];
  buildBoard();
  updateTurnIndicator();
  updateUndoBtn();
  closeOverlay();
}

function restartRound() {
  resetRoundState();
}

function humanPlay(col) {
  if (!game.active || game.locked || game.over) return;
  if (game.mode === 'bot' && game.current === P2) return; // bot's turn
  attemptDrop(col);
}

function attemptDrop(col) {
  if (col == null) return;
  const landing = dropDisc(game.board, col, game.current);
  if (!landing) {
    sound.invalid();
    return;
  }
  game.locked = true;
  updateUndoBtn();
  game.history.push({ row: landing.row, col: landing.col, player: game.current });

  const disc = placeDisc(landing.row, landing.col, game.current);
  sound.drop();
  haptic(12);

  const win = checkWin(game.board, landing.row, landing.col);
  const draw = !win && isFull(game.board);

  onceAnimation(disc, () => {
    if (win) return endGame(game.current, win);
    if (draw) return endGame('draw', null);
    game.current = other(game.current);
    updateTurnIndicator();
    game.locked = false;
    updateUndoBtn();
    maybeBotMove();
  });
}

function maybeBotMove() {
  if (game.mode !== 'bot' || game.over || !game.active) return;
  if (game.current !== P2) return;
  game.locked = true;
  updateUndoBtn();
  setThinking(true);
  const delay = 420 + Math.random() * 340;
  setTimeout(() => {
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

function endGame(winner, cells) {
  game.over = true;
  game.active = false;
  game.locked = true;
  updateUndoBtn();

  if (winner === 'draw') {
    stats.draws++;
    saveStats();
    renderScores();
    sound.draw();
    haptic([20, 40, 20]);
    setTimeout(() => showResult('draw'), 300);
  } else {
    stats[winner]++;
    saveStats();
    renderScores();
    highlightWin(cells);
    sound.win();
    haptic([30, 30, 30, 30, 140]);
    setTimeout(() => showResult(winner), 850); // let the winning line shine first
  }
}

function highlightWin(cells) {
  cells.forEach(([r, c]) => {
    const disc = cellAt(r, c).querySelector('.disc');
    if (disc) disc.classList.add('win');
  });
}

function undo() {
  if (game.locked || game.over || !game.active || game.history.length === 0) return;
  const plies = game.mode === 'bot' ? Math.min(2, game.history.length) : 1;
  for (let i = 0; i < plies; i++) {
    const m = game.history.pop();
    game.board[m.row][m.col] = EMPTY;
    const disc = cellAt(m.row, m.col).querySelector('.disc');
    if (disc) disc.remove();
    game.current = m.player; // that player is on the move again
  }
  updateTurnIndicator();
  updateUndoBtn();
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

function showResult(winner) {
  const disc = $('#result-disc');
  if (winner === 'draw') {
    disc.className = 'result-disc draw';
    $('#result-title').textContent = "It's a draw!";
    $('#result-sub').textContent = 'The board filled up — nobody connected four.';
  } else {
    disc.className = 'result-disc';
    disc.style.setProperty('--disc', colorFor(winner));
    $('#result-title').textContent = `${game.names[winner]} wins!`;
    $('#result-sub').textContent = resultSub(winner);
  }
  overlay.classList.add('is-open');
  overlay.setAttribute('aria-hidden', 'false');
}

function closeOverlay() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ---------------------------------------------------------------- navigation

function goMenu() {
  game.active = false;
  game.over = false;
  game.locked = false;
  closeOverlay();
  showScreen('screen-menu');
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

  $('#btn-mode-bot').addEventListener('click', () => openSetup('bot'));
  $('#btn-mode-2p').addEventListener('click', () => openSetup('2p'));
  $('#btn-start').addEventListener('click', startFromSetup);
  $('#btn-restart').addEventListener('click', restartRound);
  $('#btn-newround').addEventListener('click', restartRound);
  $('#btn-playagain').addEventListener('click', restartRound);
  $('#btn-undo').addEventListener('click', undo);
  soundChip.addEventListener('click', toggleSound);
  $('#btn-reset-stats').addEventListener('click', resetStats);

  document.querySelectorAll('[data-nav="menu"]').forEach((el) => el.addEventListener('click', goMenu));

  diffSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedDifficulty = seg.dataset.diff;
      refreshDifficulty();
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
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
}

wire();
