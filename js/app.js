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
  legalMoves,
  other,
} from './engine.js';
import { solveBoard } from './solver.js';
import { chooseMove, choosePopoutMove, winChance } from './bot.js';
import { emptyHistory, recordGame, summarize, winRate, DIFFICULTIES, DIFFICULTY_LABEL } from './stats.js';
import { summarizeReview } from './review.js';
import { PUZZLES } from './puzzles.js';

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

// Inline SVG icons (inherit `currentColor`), filled into [data-icon] holders by
// installIcons(). Emoji render inconsistently across devices; these don't.
const S = (body, opts = '') => `<svg viewBox="0 0 24 24" ${opts || 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICONS = {
  robot: S('<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4.5v3.5"/><circle cx="12" cy="3.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.3" fill="currentColor" stroke="none"/><path d="M9.5 17h5"/>'),
  users: S('<circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5"/><path d="M17.5 20a5.5 5.5 0 0 0-2.8-4.8"/>'),
  volume: S('<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z"/><path d="M16.5 9a3.5 3.5 0 0 1 0 6"/><path d="M19 6.5a7 7 0 0 1 0 11"/>'),
  mute: S('<path d="M4 9.5v5h3.5L13 19V5L7.5 9.5H4z"/><path d="M17 9.5l4 5M21 9.5l-4 5"/>'),
  trash: S('<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6.5 7l1 12.5h9L17.5 7"/>'),
  palette: S('<path d="M12 3a9 9 0 1 0 0 18c1.6 0 2-1.2 1.2-2.1-.8-1 .1-2.4 1.3-2.4H17a4 4 0 0 0 4-4c0-4.6-4-6.5-9-6.5z"/><circle cx="7.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="16" cy="10.5" r="1.1" fill="currentColor" stroke="none"/>'),
  play: S('<path d="M8 5v14l11-7z"/>', 'fill="currentColor"'),
  pause: S('<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>', 'fill="currentColor"'),
  prev: S('<path d="M16 5v14L5 12z"/>', 'fill="currentColor"'),
  skipBack: S('<rect x="5" y="5" width="2.4" height="14" rx="1"/><path d="M20 5v14l-11-7z"/>', 'fill="currentColor"'),
  skipFwd: S('<rect x="16.6" y="5" width="2.4" height="14" rx="1"/><path d="M4 5v14l11-7z"/>', 'fill="currentColor"'),
  bulb: S('<path d="M9.5 18h5"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.6.5.8 1 .8 1.4h6c0-.4.2-.9.8-1.4A6 6 0 0 0 12 3z"/>'),
  bars: S('<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="12" width="2.6" height="5" fill="currentColor" stroke="none"/><rect x="11" y="8.5" width="2.6" height="8.5" fill="currentColor" stroke="none"/><rect x="15" y="14" width="2.6" height="3" fill="currentColor" stroke="none"/>'),
  trend: S('<path d="M4 20V4"/><path d="M4 20h16"/><path d="M7 15l3.5-3.5 3 2 4-5"/>'),
  undo: S('<path d="M8 8h7a5 5 0 0 1 0 10H9"/><path d="M8 4.5L4.5 8 8 11.5"/>'),
  popout: S('<path d="M12 20V7"/><path d="M7 12l5-5 5 5"/><path d="M6 4h12"/>'),
  back: S('<path d="M15 5l-7 7 7 7"/>', 'fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"'),
  restart: S('<path d="M20 11.5a8 8 0 1 0-.8 4"/><path d="M20 4v5.5h-5.5"/>'),
  puzzle: S('<path d="M10.2 4a1.8 1.8 0 0 1 3.6 0c0 .9 1 1.5 1.8 1.1.5-.2 1.1-.1 1.5.3l.5.5c.4.4.5 1 .3 1.5-.4.8.2 1.8 1.1 1.8a1.8 1.8 0 0 1 0 3.6c-.9 0-1.5 1-1.1 1.8.2.5.1 1.1-.3 1.5l-.5.5c-.4.4-1 .5-1.5.3-.8-.4-1.8.2-1.8 1.1a1.8 1.8 0 0 1-3.6 0c0-.9-1-1.5-1.8-1.1-.5.2-1.1.1-1.5-.3l-.5-.5c-.4-.4-.5-1-.3-1.5.4-.8-.2-1.8-1.1-1.8a1.8 1.8 0 0 1 0-3.6c.9 0 1.5-1 1.1-1.8-.2-.5-.1-1.1.3-1.5l.5-.5c.4-.4 1-.5 1.5-.3.8.4 1.8-.2 1.8-1.1z"/>'),
  check: S('<path d="M5 12.5l4.2 4.5L19 6.5"/>', 'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"'),
};

function installIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    const name = el.dataset.icon;
    if (ICONS[name]) el.innerHTML = ICONS[name];
  });
}

// ---------------------------------------------------------------- persistence

const PREFS_KEY = 'c4.prefs.v1';
const STATS_KEY = 'c4.stats.v1';
const HISTORY_KEY = 'c4.history.v1';
const PUZZLES_KEY = 'c4.puzzles.v1';

const DEFAULT_PREFS = {
  p1name: '',
  p2name: '',
  botname: 'Bot',
  c1: '#ff3b30', // Player 1 — red (classic Connect Four)
  c2: '#ffd23f', // Player 2 — yellow (classic Connect Four)
  difficulty: 'medium',
  timerSeconds: 0, // 0 = off; two-player mode only
  variant: 'classic', // 'classic' | 'popout'
  matchTarget: 1, // rounds needed to win the match: 1 = single, 2 = best of 3, 3 = best of 5
  theme: 'classic', // 'neon' | 'classic' | 'minimal' — Classic (blue board) is the default
  showEval: false, // win-% bar hidden by default; toggled on from the game controls
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
// One-time colour refresh: players still on the original neon default discs
// (pink/cyan) move to the new classic red/yellow default. Deliberately chosen
// colours are left untouched.
if (prefs.c1 === '#ff3d7f' && prefs.c2 === '#3dd7ff') {
  prefs.c1 = DEFAULT_PREFS.c1;
  prefs.c2 = DEFAULT_PREFS.c2;
  saveJSON(PREFS_KEY, prefs);
}
let stats = loadJSON(STATS_KEY, { 1: 0, 2: 0, draws: 0 });
let history = loadJSON(HISTORY_KEY, emptyHistory());
// Puzzle progress: just which ids you've solved. Every puzzle is playable from
// the start, so there is nothing to unlock. (Older saves also carry an
// `unlockedTo` from when they did lock; it's simply ignored now.) Arrays survive
// the {...fallback} merge as-is.
let puzzleProgress = loadJSON(PUZZLES_KEY, { solved: [] });
if (!Array.isArray(puzzleProgress.solved)) puzzleProgress.solved = [];
const savePrefs = () => saveJSON(PREFS_KEY, prefs);
const saveStats = () => saveJSON(STATS_KEY, stats);
const saveHistory = () => saveJSON(HISTORY_KEY, history);
const savePuzzleProgress = () => saveJSON(PUZZLES_KEY, puzzleProgress);

// ---------------------------------------------------------------- Web Audio

// Shared audio context, created lazily on the first user gesture (browsers block
// audio until then). Used by both the sound effects and the soundtrack.
let _audioCtx = null;
function audioCtx() {
  if (!_audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    _audioCtx = new AC();
  }
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

const sound = (() => {
  const ensure = audioCtx;
  // A short enveloped oscillator; pass `f2` to glide the pitch (gives a "thock").
  function tone(freq, dur, type = 'sine', gain = 0.12, when = 0, f2 = null) {
    if (prefs.muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + when;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (f2 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }
  // A brief band-passed noise burst — the "clack" of a disc seating into a slot.
  function noise(dur, gain, freq, when = 0) {
    if (prefs.muted) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + when;
    const frames = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, frames, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }
  return {
    unlock: ensure,
    drop() {
      tone(300, 0.14, 'triangle', 0.13, 0, 120); // downward glide = a hollow "thock"
      noise(0.05, 0.06, 900, 0.004); // the seating clack
    },
    win() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, 'triangle', 0.12, i * 0.09)); // bright arpeggio + sparkle
    },
    draw() {
      tone(360, 0.22, 'sine', 0.1, 0, 300);
      tone(280, 0.32, 'sine', 0.09, 0.14, 220);
    },
    invalid() {
      tone(150, 0.18, 'sawtooth', 0.07, 0, 90); // dull descending buzz
      noise(0.06, 0.03, 320);
    },
    click() {
      tone(520, 0.045, 'square', 0.03, 0, 380); // soft UI click
    },
    tick() {
      tone(760, 0.045, 'sine', 0.045);
    },
    // The opponent booting up. A rising sweep for everyone, plus low dread that
    // deepens with the difficulty (Insane gets a subsonic detuned pair + hiss).
    botIntro(difficulty) {
      tone(170, 0.44, 'sawtooth', 0.045, 0, 640);
      if (difficulty === 'insane') {
        tone(48, 0.95, 'sawtooth', 0.075, 0.08, 33);
        tone(71, 0.9, 'square', 0.03, 0.1, 47); // detuned against it — a beating growl
        noise(0.55, 0.028, 2600, 0.2);
      } else if (difficulty === 'hard') {
        tone(115, 0.55, 'sawtooth', 0.055, 0.08, 78);
      } else if (difficulty === 'easy') {
        tone(880, 0.14, 'sine', 0.03, 0.2, 1320); // friendly little chirp instead
      }
    },
    // Losing a puzzle: a slow descending minor figure that sags at the end, then a
    // soft low thud. The deliberate opposite of win()'s rising arpeggio.
    lose() {
      tone(392, 0.34, 'triangle', 0.09, 0, 370); // G4, sagging
      tone(311, 0.4, 'triangle', 0.085, 0.26, 294); // E♭4
      tone(233, 0.7, 'sine', 0.075, 0.58, 196); // B♭3 → G3, the sigh
      noise(0.22, 0.025, 190, 0.6); // dull thud underneath
    },
    // The toss landing on whoever goes first: a short rising two-note flourish.
    reveal() {
      tone(660, 0.12, 'triangle', 0.07, 0, 880);
      tone(990, 0.16, 'sine', 0.06, 0.1, 1180);
    },
    // The bot's claw opening to release its disc. Deliberately in a different
    // register from drop() so the two layer instead of muddying, and it gets
    // heavier/nastier as the difficulty climbs.
    robot(difficulty) {
      if (difficulty === 'easy') {
        tone(880, 0.05, 'square', 0.022, 0, 1180); // cheerful little chirp up
        tone(1320, 0.05, 'sine', 0.016, 0.05);
      } else if (difficulty === 'hard') {
        tone(210, 0.13, 'sawtooth', 0.045, 0, 120); // heavier servo
        noise(0.07, 0.03, 1500); // metal grind
      } else if (difficulty === 'insane') {
        tone(70, 0.34, 'sawtooth', 0.06, 0, 44); // low growl
        tone(104, 0.3, 'square', 0.025, 0.01, 61); // detuned against it — beating/dread
        noise(0.13, 0.04, 2600); // metallic screech
      } else {
        tone(430, 0.08, 'square', 0.028, 0, 300); // neutral servo click
        noise(0.04, 0.018, 1800);
      }
    },
  };
})();

// ---------------------------------------------------------------- soundtrack
// A chill, looping neon backing track built live with Web Audio (no files): a
// soft pad + bass + arpeggio over a wistful minor progression. Scheduled a beat
// ahead so it loops seamlessly.
const music = (() => {
  const BPM = 82;
  const beat = 60 / BPM;
  const stepDur = beat / 2; // eighth notes
  const STEPS = 32; // 4 bars × 8 eighths
  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const CHORDS = [
    { root: 45, notes: [57, 60, 64] }, // Am
    { root: 41, notes: [53, 57, 60] }, // F
    { root: 48, notes: [60, 64, 67] }, // C
    { root: 43, notes: [55, 59, 62] }, // G
  ];
  let master = null;
  let playing = false;
  let timer = null;
  let step = 0;
  let nextTime = 0;

  function voice(freq, t, dur, type, gain, attack) {
    const c = audioCtx();
    if (!c || !master) return;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function scheduleStep(s, t) {
    const chord = CHORDS[Math.floor(s / 8) % CHORDS.length];
    const inBar = s % 8;
    if (inBar === 0) voice(midiToFreq(chord.root), t, beat * 1.9, 'triangle', 0.17, 0.01); // bass, beat 1
    if (inBar === 4) voice(midiToFreq(chord.root), t, beat * 0.9, 'triangle', 0.11, 0.01); // bass, beat 3
    if (inBar === 0) chord.notes.forEach((n) => voice(midiToFreq(n), t, beat * 3.8, 'sine', 0.045, 0.5)); // pad
    voice(midiToFreq(chord.notes[inBar % chord.notes.length] + 12), t, stepDur * 0.9, 'triangle', 0.05, 0.005); // arp
  }

  function tick() {
    const c = audioCtx();
    if (!c) return;
    while (nextTime < c.currentTime + 0.13) {
      scheduleStep(step, nextTime);
      nextTime += stepDur;
      step = (step + 1) % STEPS;
    }
  }

  return {
    start() {
      if (playing || prefs.muted) return;
      const c = audioCtx();
      if (!c) return;
      master = c.createGain();
      master.gain.setValueAtTime(0.0001, c.currentTime);
      master.gain.exponentialRampToValueAtTime(0.7, c.currentTime + 1.6); // gentle fade-in
      master.connect(c.destination);
      playing = true;
      step = 0;
      nextTime = c.currentTime + 0.15;
      timer = setInterval(tick, 30);
    },
    stop() {
      if (!playing) return;
      playing = false;
      if (timer) { clearInterval(timer); timer = null; }
      const c = audioCtx();
      if (c && master) {
        const m = master;
        try {
          m.gain.cancelScheduledValues(c.currentTime);
          m.gain.setValueAtTime(Math.max(0.0001, m.gain.value), c.currentTime);
          m.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.6); // fade-out
        } catch { /* ignore */ }
        setTimeout(() => { try { m.disconnect(); } catch { /* ignore */ } }, 800);
      }
      master = null;
    },
  };
})();

// The soundtrack only plays on the menu / setup screens, once audio is unlocked
// (first user gesture) and sound isn't muted.
let audioUnlocked = false;
function updateMusic() {
  const onMusicScreen = currentScreen === 'screen-menu' || currentScreen === 'screen-setup';
  if (audioUnlocked && !prefs.muted && onMusicScreen) music.start();
  else music.stop();
}

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
const botRobot = $('#bot-robot');
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

const evalEl = $('#eval');
const evalP1 = $('#eval-p1');
const evalP2 = $('#eval-p2');
const evalLabel = $('#eval-label');
const evalToggleBtn = $('#btn-eval-toggle');

const replayLastChip = $('#btn-replay-last');
const replayBoardEl = $('#replay-board');
const replayCaption = $('#replay-caption');
const replayCounter = $('#replay-counter');
const rpPlayBtn = $('#rp-play');
const rpHintBtn = $('#rp-hint');
const replayEvalP1 = $('#replay-eval-p1');
const replayEvalP2 = $('#replay-eval-p2');
const replayEvalLabel = $('#replay-eval-label');

const botIntroEl = $('#bot-intro');
const biStage = $('#bi-stage');
const biKicker = $('#bi-kicker');
const biLevel = $('#bi-level');
const biTaunt = $('#bi-taunt');

const tossEl = $('#toss');
const tossTitle = $('#toss-title');
const tossResult = $('#toss-result');
const tossSides = { [P1]: $('#toss-side-1'), [P2]: $('#toss-side-2') };
const tossNames = { [P1]: $('#toss-name-1'), [P2]: $('#toss-name-2') };

const reviewEl = $('#review');
const reviewProgress = $('#review-progress');
const reviewProgressLabel = $('#review-progress-label');
const reviewProgressFill = $('#review-progress-fill');
const reviewGraph = $('#review-graph');
const reviewArea = $('#review-area-p1');
const reviewLine = $('#review-line');
const reviewDots = $('#review-dots');
const reviewMarker = $('#review-marker');
const reviewSummary = $('#review-summary');
const reviewMoments = $('#review-moments');

const puzzleGridEl = $('#puzzle-grid');
const puzzlesCountEl = $('#puzzles-count');
const pzNextUnsolvedBtn = $('#btn-pz-next-unsolved');
const puzzlesProgressFill = $('#puzzles-progress-fill');
const puzzleBoardEl = $('#puzzle-board');
const puzzleTitleEl = $('#puzzle-title');
const puzzleDotEl = $('#puzzle-prompt .puzzle-dot');
const puzzlePromptText = $('#puzzle-prompt-text');
const puzzleStatusEl = $('#puzzle-status');
const puzzleMovesEl = $('#puzzle-moves');
const puzzleAshLayer = $('#puzzle-ash');
const puzzleLostEl = $('#puzzle-lost');
const plTitle = $('#pl-title');
const plSub = $('#pl-sub');
const pzHintBtn = $('#pz-hint');
const pzRetryBtn = $('#pz-retry');
const pzNextBtn = $('#pz-next');
const puzzleConfettiLayer = $('#puzzle-confetti');

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

// May the exact bitboard solver be used for this variant? It plays standard
// Connect Four, so in Pop-Out it would call positions "proven" that an opponent
// pop can refute — wrong for the eval bar, the review and the bot's own move
// choice alike. Pop-Out therefore stays on the heuristic estimate throughout.
const exactOK = (variant) => variant !== 'popout';

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

let currentScreen = 'screen-menu';
function showScreen(id, dir = null) {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.querySelectorAll('.screen').forEach((s) => {
    const active = s.id === id;
    s.classList.toggle('is-active', active);
    s.classList.remove('nav-fwd', 'nav-back');
    if (active && dir && !reduce) {
      void s.offsetWidth; // restart the enter animation even if the class was just cleared
      s.classList.add(dir === 'back' ? 'nav-back' : 'nav-fwd');
    }
  });
  currentScreen = id;
  updateMusic(); // soundtrack plays on menu/setup only
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
  showScreen('screen-setup', 'fwd');
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
  game.startingPlayer = rollStartingPlayer(); // coin toss for the opening round
  game.names[1] = name1.value.trim() || name1.placeholder;
  game.names[2] = name2.value.trim() || name2.placeholder;
  game.colors[1] = selectedColor[1];
  game.colors[2] = selectedColor[2];
  document.documentElement.style.setProperty('--p1', game.colors[1]);
  document.documentElement.style.setProperty('--p2', game.colors[2]);

  // Vs the bot, boot the opponent up first, then toss for the first move.
  resetRoundState(mode === 'bot' ? 'bot' : 'toss');
  renderScores();
  showScreen('screen-game', 'fwd');
}

// Which player opens a brand-new match. Only ever called for the first round —
// after that the starter alternates so the advantage evens out over a series.
const rollStartingPlayer = () => (Math.random() < 0.5 ? P1 : P2);

// `intro` is 'toss' (a random roll — first round of a match), 'announce' (the
// starter is already decided by alternation, just show it), or null (no intro,
// e.g. the mid-animation reset guard). During an intro the board is locked and
// the turn timer hasn't started, so nobody loses time to the animation.
function resetRoundState(intro = null) {
  moveGen++; // invalidate any in-flight move callbacks from the previous round
  stopTurnTimer();
  hideBotRobot();
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

  if (intro) {
    const gen = moveGen;
    game.locked = true; // no input while the toss plays out
    updateUndoBtn();
    updateHintBtn();
    runStartIntro(intro, () => {
      if (gen !== moveGen || !game.active) return; // round was reset / left mid-intro
      game.locked = false;
      updateUndoBtn();
      updateHintBtn();
      startTurnTimer();
      maybeBotMove();
    });
    return;
  }

  startTurnTimer();
  maybeBotMove(); // handles the case where the bot is the starting player this round
}

// --- Opponent reveal (vs Bot) --------------------------------------------------
// Boots the machine up before the toss: a scanline sweep, the robot materialising,
// its level slamming in, then a line of trash talk. Everything about it escalates
// with the difficulty — colour, vignette, screen shake, sound and the line itself —
// so Insane arrives as a genuine threat and Easy as a friendly helper.

const BOT_INTRO = {
  easy: { level: 'EASY', kicker: 'Waking your opponent…', taunt: 'Go easy on me, okay?' },
  medium: { level: 'MEDIUM', kicker: 'Booting opponent…', taunt: "Let's play a fair game." },
  hard: { level: 'HARD', kicker: 'Opponent online.', taunt: 'I do not make the same mistake twice.' },
  // The kicker is already letter-spaced in CSS, so don't pad it here — HTML would
  // collapse the runs of spaces anyway.
  insane: { level: 'INSANE', kicker: 'System awake', taunt: 'I have already seen every move you have.' },
};

let introGen = 0;

function hideBotIntro() {
  introGen++; // abandon a reveal still in flight
  if (botIntroEl) {
    botIntroEl.classList.remove('is-open');
    botIntroEl.onclick = null;
  }
}

function runBotIntro(done) {
  if (!botIntroEl || !botRobot || !biStage) { done(); return; }
  const gen = ++introGen;
  const diff = game.difficulty;
  const copy = BOT_INTRO[diff] || BOT_INTRO.medium;
  const reduced = prefersReducedMotion();

  // Clone the in-game robot so the four skins are defined in exactly one place.
  const robot = botRobot.cloneNode(true);
  robot.removeAttribute('id');
  robot.className = `bot-robot bi-robot diff-${diff} is-active`;
  biStage.replaceChildren(robot);

  botIntroEl.className = `bot-intro diff-${diff}`;
  biKicker.textContent = copy.kicker;
  biLevel.textContent = copy.level;
  biTaunt.textContent = '';
  void botIntroEl.offsetWidth; // restart the sweep/enter animations
  botIntroEl.classList.add('is-open');
  sound.botIntro(diff);

  const timers = [];
  const at = (ms, fn) => timers.push(setTimeout(() => { if (gen === introGen) fn(); }, ms));

  const finish = () => {
    if (gen !== introGen) return;
    timers.forEach(clearTimeout);
    introGen++; // nothing queued can fire past this point
    botIntroEl.classList.remove('is-open');
    botIntroEl.onclick = null;
    setTimeout(done, 240); // let the fade out finish before the toss opens
  };

  at(reduced ? 40 : 640, () => {
    botIntroEl.classList.add('show-level');
    sound.robot(diff); // the servo sting, already graded by difficulty
    haptic(diff === 'insane' ? [16, 40, 22, 40, 28] : diff === 'hard' ? [14, 40, 18] : 12);
  });
  at(reduced ? 120 : 1080, () => {
    biTaunt.textContent = copy.taunt;
    botIntroEl.classList.add('show-taunt');
  });
  at(reduced ? 520 : 2050, finish);

  botIntroEl.onclick = finish; // tap to skip
}

// --- Who goes first ------------------------------------------------------------
// The starter is rolled for the first round of a match and then alternates. The
// overlay makes that visible either way: 'toss' ping-pongs a highlight between
// the two players, decelerating until it lands on the winner; 'announce' just
// reveals whose turn it is this round.
const TOSS_FLIPS = 11;
let tossGen = 0;

function hideToss() {
  tossGen++; // abandon any roll still in flight
  if (tossEl) tossEl.classList.remove('is-open');
}

function runStartIntro(mode, done) {
  // 'bot' chains the opponent reveal in front of the toss.
  if (mode === 'bot') { runBotIntro(() => runStartIntro('toss', done)); return; }
  if (!tossEl) { done(); return; }
  const gen = ++tossGen; // a new roll supersedes any previous one mid-flight
  const winner = game.startingPlayer;
  const loser = other(winner);

  tossNames[1].textContent = game.names[1];
  tossNames[2].textContent = game.names[2];
  tossSides[1].style.setProperty('--disc', game.colors[1]);
  tossSides[2].style.setProperty('--disc', game.colors[2]);
  tossSides[1].classList.remove('is-lit', 'is-winner', 'is-loser');
  tossSides[2].classList.remove('is-lit', 'is-winner', 'is-loser');
  tossTitle.textContent = mode === 'toss' ? 'Who goes first?' : `Round ${game.series[1] + game.series[2] + 1}`;
  tossResult.textContent = '';
  tossEl.classList.add('is-open');

  const land = () => {
    if (gen !== tossGen) return; // superseded — don't touch the newer roll's UI
    tossSides[winner].classList.remove('is-lit');
    tossSides[loser].classList.remove('is-lit');
    tossSides[winner].classList.add('is-winner');
    tossSides[loser].classList.add('is-loser');
    tossResult.textContent = `${game.names[winner]} goes first`;
    sound.reveal();
    haptic([8, 30, 12]);
    setTimeout(() => {
      if (gen !== tossGen) return; // a newer roll owns the overlay now
      tossEl.classList.remove('is-open');
      done();
    }, 780);
  };

  // Reduced motion (or an announce with no suspense to build): straight to it.
  if (mode !== 'toss' || prefersReducedMotion()) {
    setTimeout(land, mode === 'toss' ? 120 : 260);
    return;
  }

  // Alternate the highlight, slowing as it goes. The starting side is chosen so
  // the last flip lands on the winner.
  const first = (TOSS_FLIPS - 1) % 2 === 0 ? winner : loser;
  let i = 0;
  const flip = () => {
    if (gen !== tossGen) return; // superseded
    const lit = i % 2 === 0 ? first : other(first);
    tossSides[lit].classList.add('is-lit');
    tossSides[other(lit)].classList.remove('is-lit');
    sound.tick();
    i++;
    if (i >= TOSS_FLIPS) { setTimeout(land, 180); return; }
    setTimeout(flip, 60 + i * i * 2.6); // ease out: 60ms → ~320ms
  };
  flip();
}

// Next round of a series: the starter alternates, so the opening advantage evens
// out over the match. Announced rather than re-rolled — it isn't random.
function nextRound() {
  game.startingPlayer = other(game.startingPlayer);
  resetRoundState('announce');
}

// Replay the round currently in progress (the ⟳ button). Same starter — it's the
// same round, so re-rolling or alternating would change the terms mid-round.
function restartRound() {
  resetRoundState('announce');
}

// A fresh standalone game after one finishes: a new contest, so roll again.
function playAgain() {
  game.startingPlayer = rollStartingPlayer();
  resetRoundState('toss');
}

function newMatch() {
  game.series = { 1: 0, 2: 0 };
  game.startingPlayer = rollStartingPlayer(); // fresh match → fresh toss
  resetRoundState('toss');
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
  if (!(game.mode === 'bot' && game.current === P2)) hideBotRobot(); // retract once it's the human's turn
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
    bumpBoard(); // a small jolt as the disc seats
    if (cells) return endGame(game.current, cells);
    if (draw) return endGame('draw', null);
    passTurn();
  });
}

// A brief board jolt when a disc lands, for tactile feedback.
function bumpBoard() {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  boardEl.classList.remove('impact');
  void boardEl.offsetWidth; // restart the animation
  boardEl.classList.add('impact');
  setTimeout(() => boardEl.classList.remove('impact'), 220);
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

// --- The bot's "hand": a little robot that hovers above the board, slides to the
// chosen column and drops the disc. It gets scarier as the difficulty rises.
let botRobotCol = 3;

function positionBotRobot(col) {
  if (!botRobot) return;
  const cell = cellAt(0, col);
  if (!cell) return;
  const wrapRect = botRobot.parentElement.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const cx = cellRect.left + cellRect.width / 2 - wrapRect.left;
  const w = botRobot.offsetWidth || 62;
  const h = botRobot.offsetHeight || 64;
  botRobot.style.setProperty('--tx', `${Math.round(cx - w / 2)}px`);
  botRobot.style.setProperty('--ty', `${Math.round(boardRect.top - wrapRect.top - h + 16)}px`);
}

function showBotRobot() {
  if (!botRobot || game.mode !== 'bot') return;
  botRobot.classList.remove('diff-easy', 'diff-medium', 'diff-hard', 'diff-insane', 'dropping', 'popping');
  botRobot.classList.add(`diff-${game.difficulty}`);
  positionBotRobot(botRobotCol); // hover above its last column (centre on the first turn)
  void botRobot.offsetWidth; // commit the position before fading in so it doesn't slide from 0,0
  botRobot.classList.add('is-active');
}

function hideBotRobot() {
  if (botRobot) botRobot.classList.remove('is-active', 'dropping', 'popping');
}

// Slide the robot over `col`, then work its claw and run `act`. `kind` is 'drop'
// or (Pop-Out only) 'pop' — a pop pulls a disc out from under the column instead
// of releasing one, so the claw reaches down rather than opening.
function botDropAt(col, act, kind = 'drop') {
  botRobotCol = col;
  positionBotRobot(col);
  const slide = prefersReducedMotion() ? 0 : 340;
  setTimeout(() => {
    if (botRobot) botRobot.classList.add(kind === 'pop' ? 'popping' : 'dropping');
    sound.robot(game.difficulty); // claw servo, synced to the release
    act();
    setTimeout(() => { if (botRobot) botRobot.classList.remove('dropping', 'popping'); }, 340);
  }, slide);
}

// Wrap a plain column from the classic chooser as a Pop-Out-shaped move.
const toDrop = (col) => (col == null ? null : { type: 'drop', col });

function maybeBotMove() {
  if (game.mode !== 'bot' || game.over || !game.active) return;
  if (game.current !== P2) return;
  game.locked = true;
  updateUndoBtn();
  setThinking(true);
  showBotRobot();
  const gen = moveGen;
  const delay = 420 + Math.random() * 340;
  setTimeout(() => {
    // Bail if the round was reset/left, or it's somehow no longer the bot's turn.
    if (gen !== moveGen || game.over || !game.active || game.current !== P2) return;
    setThinking(false);
    updateTurnIndicator(); // show "Bot's turn" (not "thinking") while the disc drops
    // Pop-Out is a different game, so it gets the variant-aware search — which can
    // also decide to pop one of the bot's own bottom discs.
    const move = game.variant === 'popout'
      ? choosePopoutMove(game.board, P2, game.difficulty)
      : toDrop(chooseMove(game.board, P2, game.difficulty, { exact: exactOK(game.variant) }));
    if (!move || move.col == null) {
      game.locked = false;
      hideBotRobot();
      return;
    }
    botDropAt(move.col, () => {
      if (gen !== moveGen || game.over || !game.active || game.current !== P2) return;
      if (move.type === 'pop') attemptPop(move.col);
      else attemptDrop(move.col);
    }, move.type);
  }, delay);
}

function endGame(winner, cells, reason) {
  game.over = true;
  game.active = false;
  game.locked = true;
  game.popArmed = false;
  hideBotRobot();
  stopTurnTimer();
  updateUndoBtn();
  updatePopControl();
  updateHintBtn();
  recordLastGame(winner, cells, reason);
  history = recordGame(history, { mode: game.mode, difficulty: game.difficulty, winner });
  saveHistory();
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
  if (cells) highlightWin(cells, winner); // timeout wins have no line to highlight
  burstConfetti();
  sound.win();
  haptic([30, 30, 30, 30, 140]);
  setTimeout(() => showResult(winner, reason, matchOver), cells ? 850 : 450);
}

function highlightWin(cells, winner) {
  cells.forEach(([r, c], i) => {
    const disc = cellAt(r, c).querySelector('.disc');
    if (disc) {
      disc.style.animationDelay = `${i * 0.09}s`; // ripple the pulse along the line
      disc.classList.add('win');
    }
  });
  drawWinLine(cells, winner);
}

// Draw a glowing streak through the four winning discs. Endpoints are the centres
// of the first and last winning cells (cells are stable, unlike the pulsing discs),
// measured relative to the board so the SVG overlays it exactly.
function drawWinLine(cells, winner) {
  if (!cells || cells.length < 2 || !boardEl) return;
  const bRect = boardEl.getBoundingClientRect();
  const centreOf = (r, c) => {
    const cr = cellAt(r, c).getBoundingClientRect();
    return { x: cr.left - bRect.left + cr.width / 2, y: cr.top - bRect.top + cr.height / 2 };
  };
  const a = centreOf(cells[0][0], cells[0][1]);
  const b = centreOf(cells[cells.length - 1][0], cells[cells.length - 1][1]);
  const color = colorFor(winner) || '#ffffff';

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'win-line');
  svg.style.setProperty('--win-color', color);
  const makeLine = (width, stroke, cls) => {
    const ln = document.createElementNS(NS, 'line');
    ln.setAttribute('x1', a.x);
    ln.setAttribute('y1', a.y);
    ln.setAttribute('x2', b.x);
    ln.setAttribute('y2', b.y);
    ln.setAttribute('stroke', stroke);
    ln.setAttribute('stroke-width', String(width));
    ln.setAttribute('class', cls);
    svg.appendChild(ln);
    return ln;
  };
  const lines = [makeLine(14, color, 'win-line-glow'), makeLine(6, '#ffffff', 'win-line-core')];
  boardEl.appendChild(svg);

  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  lines.forEach((ln) => {
    ln.style.strokeDasharray = String(len);
    ln.style.strokeDashoffset = reduce ? '0' : String(len);
  });
  if (!reduce) {
    requestAnimationFrame(() => {
      lines.forEach((ln) => {
        ln.style.transition = 'stroke-dashoffset 0.5s ease';
        ln.style.strokeDashoffset = '0';
      });
    });
  }
}

// How many plies to rewind so that it is a HUMAN's turn afterwards. Two-player is
// always one. Vs the bot it's normally two — its reply plus your move — but if the
// bot opened the round its lone move rewinds to *its* turn, which nothing would
// then play, so undo is unavailable there (see updateUndoBtn).
function undoPlies() {
  const n = game.history.length;
  if (n === 0) return 0;
  if (game.mode !== 'bot') return 1;
  for (let k = 1; k <= Math.min(2, n); k++) {
    if (game.history[n - k].current === P1) return k;
  }
  return 0;
}

function undo() {
  if (game.locked || game.over || !game.active) return;
  const plies = undoPlies();
  if (plies === 0) return;
  let snap = null;
  for (let i = 0; i < plies && game.history.length; i++) {
    snap = game.history.pop();
    game.moveLog.pop();
  }
  if (!snap) return;
  moveGen++; // invalidate any in-flight callbacks
  clearHint();
  hideBotRobot(); // undo returns to your turn
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
}

// ---------------------------------------------------------------- indicators / scores

function updateTurnIndicator() {
  turnIndicator.classList.remove('thinking');
  turnDot.style.setProperty('--turn-color', colorFor(game.current));
  turnText.textContent = turnLabel(game.names[game.current]);
}

// "Alice's turn", but "Your turn" — the default name in bot mode is literally
// "You", which the possessive turned into "You's turn".
const turnLabel = (name) => (name === 'You' ? 'Your turn' : `${name}'s turn`);

function setThinking(on) {
  turnIndicator.classList.toggle('thinking', on);
  if (on) {
    turnDot.style.setProperty('--turn-color', colorFor(P2));
    turnText.textContent = `${game.names[2]} is thinking…`;
  }
}

function updateUndoBtn() {
  undoBtn.disabled = game.locked || game.over || !game.active || undoPlies() === 0;
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
  if (resultPrimaryAction === 'newmatch') newMatch(); // fresh match → fresh toss
  else if (resultPrimaryAction === 'next') nextRound(); // same match → alternate
  else playAgain(); // standalone game → roll again
}

function closeOverlay() {
  overlay.classList.remove('is-open');
  overlay.setAttribute('aria-hidden', 'true');
}

// ---------------------------------------------------------------- navigation

function goMenu() {
  stopTurnTimer();
  stopReplayPlay();
  resetReview(); // cancel any in-flight analysis
  hideToss(); // and any toss still rolling
  hideBotIntro();
  clearHint();
  hideBotRobot();
  game.active = false;
  game.over = false;
  game.locked = false;
  closeOverlay();
  updateReplayLastChip();
  showScreen('screen-menu', 'back');
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
  spawnConfetti(130); // main burst
  setTimeout(() => spawnConfetti(70), 300); // a second wave for a fuller celebration
}

function spawnConfetti(COUNT, layer = confettiLayer, colors) {
  if (!layer) return;

  const palette = colors || [game.colors[1], game.colors[2], '#ffd23f', '#7cff6b', '#b26bff', '#3dd7ff'];
  const rect = layer.getBoundingClientRect();
  const width = rect.width || 360;
  const pieces = [];

  for (let i = 0; i < COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-piece';
    el.style.background = palette[i % palette.length];
    el.style.left = `${Math.random() * width}px`;
    layer.appendChild(el);
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

// Ash for a lost puzzle: the anti-confetti. Confetti is fast, bright and flung
// upward; this drifts straight down, slowly, in cold grey, and lingers.
function spawnAsh(count, layer) {
  if (!layer || prefersReducedMotion()) return;
  const rect = layer.getBoundingClientRect();
  const width = rect.width || 340;
  const height = rect.height || 340;
  const flecks = [];

  for (let i = 0; i < count; i++) {
    const el = document.createElement('i');
    el.className = 'ash-fleck';
    const size = 2 + Math.random() * 3;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.left = `${Math.random() * width}px`;
    layer.appendChild(el);
    flecks.push({
      el,
      y: -10 - Math.random() * height * 0.5,
      vy: 0.35 + Math.random() * 0.5, // slow — this is falling ash, not confetti
      sway: 6 + Math.random() * 12,
      phase: Math.random() * Math.PI * 2,
      drift: 0.6 + Math.random() * 1.4,
      peak: 0.4 + Math.random() * 0.45,
      delay: Math.random() * 700,
    });
  }

  const start = performance.now();
  const LIFE = 2600;
  function frame(now) {
    const t = now - start;
    for (const f of flecks) {
      const age = t - f.delay;
      if (age < 0) continue;
      f.y += f.vy;
      const x = Math.sin(f.phase + age / 420) * f.sway * f.drift;
      const fadeIn = Math.min(1, age / 300);
      const fadeOut = age > LIFE - 700 ? Math.max(0, 1 - (age - (LIFE - 700)) / 700) : 1;
      f.el.style.transform = `translate(${x}px, ${f.y}px)`;
      f.el.style.opacity = String(f.peak * fadeIn * fadeOut);
    }
    if (t < LIFE) requestAnimationFrame(frame);
    else flecks.forEach((f) => f.el.remove());
  }
  requestAnimationFrame(frame);
}

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
  popToggleBtn.querySelector('.btn-label').textContent = game.popArmed ? 'Popping' : 'Pop out';
  boardEl.classList.toggle('pop-mode', show && game.popArmed);
}

function togglePop() {
  if (game.variant !== 'popout' || !game.active || game.locked || game.over) return;
  if (game.mode === 'bot' && game.current === P2) return;
  game.popArmed = !game.popArmed;
  updatePopControl();
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
  if (!prefs.showEval) return; // bar hidden — skip the (non-trivial) winChance compute
  if (!game.active || game.over) return; // final state is set by setEvalFinal()
  renderEval(winChance(game.board, game.current, 6, { exact: exactOK(game.variant) }));
}

function setEvalFinal(winner) {
  if (!prefs.showEval) return;
  if (winner === 'draw') renderEval({ [P1]: 50, [P2]: 50 });
  else renderEval({ [P1]: winner === P1 ? 100 : 0, [P2]: winner === P2 ? 100 : 0 });
}

// Show/hide the in-game win-% bar per the saved preference.
function applyEvalVisibility() {
  if (evalEl) evalEl.classList.toggle('is-on', prefs.showEval);
  if (evalToggleBtn) evalToggleBtn.setAttribute('aria-pressed', String(prefs.showEval));
  if (prefs.showEval) updateEvalBar(); // populate immediately when turned on mid-game
}

function toggleEval() {
  prefs.showEval = !prefs.showEval;
  savePrefs();
  applyEvalVisibility();
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
  boardEl.querySelectorAll('.disc.pop-hint').forEach((d) => d.classList.remove('pop-hint'));
}

function showHint() {
  if (!game.active || game.over || game.locked) return;
  if (game.mode === 'bot' && game.current === P2) return;
  clearHint();

  // In Pop-Out the best move may be a pop, so ask the variant-aware search — the
  // hint would otherwise recommend drops while the bot itself is popping.
  const move = game.variant === 'popout'
    ? choosePopoutMove(cloneBoard(game.board), game.current, 'insane')
    : toDrop(chooseMove(cloneBoard(game.board), game.current, 'insane', { exact: exactOK(game.variant) }));
  if (!move || move.col == null) return;

  if (move.type === 'pop') {
    // Mark the disc that should be pulled out from the bottom of the column.
    for (let r = 0; r < ROWS; r++) cellAt(r, move.col).classList.add('hint');
    const bottom = cellAt(ROWS - 1, move.col).querySelector('.disc');
    if (bottom) bottom.classList.add('pop-hint');
    hintTimer = setTimeout(clearHint, 2500);
    return;
  }

  const col = move.col;
  const row = lowestEmptyRow(game.board, col);
  if (row < 0) return;
  for (let r = 0; r < ROWS; r++) cellAt(r, col).classList.add('hint');
  const ghost = spawnDisc(boardEl, row, col, colorFor(game.current));
  ghost.classList.add('ghost');
  hintTimer = setTimeout(clearHint, 2500);
}

// ---------------------------------------------------------------- replay

const replay = { data: null, index: 0, playing: false, timer: null, boards: [], evals: [], review: null };

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

// Build an empty ROWS×COLS grid of `.cell > .socket` into any board element
// (shared by the replay and puzzle boards).
function buildBoardInto(el) {
  el.innerHTML = '';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.row = String(r);
      cell.dataset.col = String(c);
      const socket = document.createElement('div');
      socket.className = 'socket';
      cell.appendChild(socket);
      el.appendChild(cell);
    }
  }
}

function buildReplayBoard() {
  buildBoardInto(replayBoardEl);
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
  replayBoardEl.querySelectorAll('.cell.hint').forEach((c) => c.classList.remove('hint')); // clear any best-move hint

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
  renderReplayEval(index);
  updateReplayControls();
  updateReviewMarker();
}

// Player to move at replay position `index` (moves alternate from the starter).
function replayMoverAt(index) {
  return index % 2 === 0 ? replay.data.startingPlayer : other(replay.data.startingPlayer);
}

// Player 1's win chance at replay position `index`. The final position reports
// the actual result rather than an estimate.
function evalAtReplayIndex(index) {
  const d = replay.data;
  if (index >= d.moves.length) {
    if (d.winner === 'draw') return 50;
    return d.winner === P1 ? 100 : 0;
  }
  return winChance(replay.boards[index], replayMoverAt(index), 6, { exact: exactOK(d.variant) })[P1];
}

// Win-% bar for the replayed position. Reuses the review's cached number when
// the analysis has already reached this position (scrubbing stays instant).
function renderReplayEval(index) {
  const d = replay.data;
  const cached = replay.evals[index];
  const p1 = typeof cached === 'number' ? cached : evalAtReplayIndex(index);
  const pct = { [P1]: p1, [P2]: 100 - p1 };
  replayEvalP1.style.width = `${pct[P1]}%`;
  replayEvalP2.style.width = `${pct[P2]}%`;
  replayEvalP1.style.background = d.colors[1];
  replayEvalP2.style.background = d.colors[2];
  replayEvalLabel.textContent = `${d.names[1]} ${pct[P1]}% · ${d.names[2]} ${pct[P2]}%`;
}

// ---------------------------------------------------------------- game review
// Walks every position of the replayed game, records Player 1's win chance at
// each, then draws the curve and flags the moves that gave ground. Each position
// can cost the solver real time (~90ms once the endgame is solvable), so the
// walk runs one position per timer tick instead of blocking, and a generation
// counter cancels an in-flight analysis if the user leaves the screen.

const GRAPH_W = 300; // must match the SVG viewBox in index.html
const GRAPH_H = 72;
const MAX_MOMENT_CHIPS = 6;
let reviewGen = 0;

function setReviewProgress(frac, running) {
  if (!reviewProgress) return;
  reviewProgress.hidden = !running;
  const pct = Math.round(frac * 100);
  if (reviewProgressFill) reviewProgressFill.style.width = `${pct}%`;
  if (reviewProgressLabel) reviewProgressLabel.textContent = `Analysing… ${pct}%`;
}

// Cancel any running analysis and clear the rendered review.
function resetReview() {
  reviewGen++;
  replay.evals = [];
  replay.review = null;
  if (reviewArea) reviewArea.setAttribute('d', '');
  if (reviewLine) reviewLine.setAttribute('d', '');
  if (reviewDots) reviewDots.innerHTML = '';
  if (reviewSummary) reviewSummary.textContent = '';
  if (reviewMoments) reviewMoments.innerHTML = '';
  setReviewProgress(0, false);
}

function analyseReplay() {
  resetReview();
  const gen = reviewGen;
  if (!replay.data) return;
  const n = replay.boards.length; // positions = moves + 1
  if (reviewArea) reviewArea.style.fill = replay.data.colors[1];
  if (reviewGraph) reviewGraph.style.background = replay.data.colors[2];
  setReviewProgress(0, true);

  const step = (i) => {
    if (gen !== reviewGen) return; // left the screen mid-analysis
    if (i >= n) {
      setReviewProgress(1, false);
      replay.review = summarizeReview(replay.evals, replay.data.startingPlayer);
      renderReviewGraph();
      renderReviewSummary();
      renderReviewMoments();
      return;
    }
    replay.evals[i] = evalAtReplayIndex(i);
    setReviewProgress((i + 1) / n, true);
    renderReviewGraph(); // fills in as it goes
    setTimeout(() => step(i + 1), 0);
  };
  step(0);
}

const graphX = (i, n) => (n <= 1 ? 0 : (i / (n - 1)) * GRAPH_W);
const graphY = (p1pct) => GRAPH_H - (p1pct / 100) * GRAPH_H;

function renderReviewGraph() {
  if (!reviewLine || !replay.data) return;
  const n = replay.boards.length;
  const pts = [];
  for (let i = 0; i < replay.evals.length; i++) {
    if (typeof replay.evals[i] !== 'number') break; // only the analysed prefix
    pts.push([graphX(i, n), graphY(replay.evals[i])]);
  }
  if (pts.length === 0) return;
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  reviewLine.setAttribute('d', line);
  // Fill under the curve in P1's colour; the SVG's own background is P2's, so
  // the split reads as "who owns how much of the position".
  const lastX = pts[pts.length - 1][0].toFixed(1);
  reviewArea.setAttribute('d', `${line} L${lastX} ${GRAPH_H} L${pts[0][0].toFixed(1)} ${GRAPH_H} Z`);

  if (reviewDots) {
    reviewDots.innerHTML = '';
    const moments = replay.review ? replay.review.moments : [];
    for (const m of moments) {
      const after = m.index + 1;
      if (typeof replay.evals[after] !== 'number') continue;
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', graphX(after, n).toFixed(1));
      dot.setAttribute('cy', graphY(replay.evals[after]).toFixed(1));
      dot.setAttribute('r', '3.5');
      dot.setAttribute('class', `review-dot is-${m.kind}`);
      reviewDots.appendChild(dot);
    }
  }
  updateReviewMarker();
}

function updateReviewMarker() {
  if (!reviewMarker || !replay.data) return;
  const x = graphX(replay.index, replay.boards.length).toFixed(1);
  reviewMarker.setAttribute('x1', x);
  reviewMarker.setAttribute('x2', x);
}

function renderReviewSummary() {
  if (!reviewSummary || !replay.review) return;
  const d = replay.data;
  const r = replay.review;
  reviewSummary.innerHTML = '';
  for (const p of [1, 2]) {
    const row = document.createElement('span');
    row.className = 'review-player';
    const dot = document.createElement('i');
    dot.className = 'review-swatch';
    dot.style.background = d.colors[p];
    const flaws = r.counts[p].blunders + r.counts[p].mistakes;
    const detail = flaws === 0
      ? 'no slips'
      : `${r.counts[p].blunders} blunder${r.counts[p].blunders === 1 ? '' : 's'}, ${r.counts[p].mistakes} mistake${r.counts[p].mistakes === 1 ? '' : 's'}`;
    row.appendChild(dot);
    row.appendChild(document.createTextNode(`${d.names[p]} ${r.accuracy[p]}% accuracy · ${detail}`));
    reviewSummary.appendChild(row);
  }
}

function renderReviewMoments() {
  if (!reviewMoments || !replay.review) return;
  const d = replay.data;
  reviewMoments.innerHTML = '';
  const moments = replay.review.moments.slice(0, MAX_MOMENT_CHIPS);
  if (moments.length === 0) {
    const clean = document.createElement('p');
    clean.className = 'review-clean';
    clean.textContent = 'No big mistakes — a clean game.';
    reviewMoments.appendChild(clean);
    return;
  }
  for (const m of moments) {
    const chip = document.createElement('button');
    chip.className = `review-chip is-${m.kind}`;
    chip.dataset.index = String(m.index);
    chip.textContent = `Move ${m.moveNo} · ${d.names[m.mover]} −${m.loss}%`;
    reviewMoments.appendChild(chip);
  }
}

// Tapping a flagged move jumps to the position *before* it and shows what should
// have been played instead.
function openReviewMoment(index) {
  stopReplayPlay();
  replayStepTo(index, false);
  showReplayHint();
}

// Scrubbing the graph seeks the replay.
function seekFromGraph(clientX) {
  if (!reviewGraph || !replay.data) return;
  const rect = reviewGraph.getBoundingClientRect();
  if (rect.width === 0) return;
  const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  stopReplayPlay();
  replayStepTo(Math.round(frac * replay.data.moves.length), false);
}

function clearReplayHint() {
  replayBoardEl.querySelectorAll('.cell.hint').forEach((c) => c.classList.remove('hint'));
  replayBoardEl.querySelectorAll('.disc.ghost').forEach((g) => g.remove());
}

// Highlight the engine's best move for whoever is to move at the current paused
// position. Persists until the user steps (navigation rebuilds the board).
function showReplayHint() {
  stopReplayPlay();
  clearReplayHint();
  const d = replay.data;
  if (!d || replay.index >= d.moves.length) return; // game over — no move to suggest
  const board = replay.boards[replay.index];
  const mover = replayMoverAt(replay.index);
  const col = chooseMove(cloneBoard(board), mover, 'insane', { exact: exactOK(d.variant) });
  if (col == null) return;
  const row = lowestEmptyRow(board, col);
  if (row < 0) return;
  for (let r = 0; r < ROWS; r++) cellIn(replayBoardEl, r, col).classList.add('hint');
  const ghost = spawnDisc(replayBoardEl, row, col, d.colors[mover]);
  ghost.classList.add('ghost');
}

function updateReplayControls() {
  const n = replay.data ? replay.data.moves.length : 0;
  replayCounter.textContent = `Move ${replay.index} / ${n}`;
  if (rpHintBtn) rpHintBtn.disabled = replay.index >= n; // nothing to suggest at the final position
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
  showScreen('screen-replay', 'fwd');
  analyseReplay();
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
  setReplayPlayBtn(true);
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
  setReplayPlayBtn(false);
  if (replay.timer) {
    clearInterval(replay.timer);
    replay.timer = null;
  }
}

function setReplayPlayBtn(playing) {
  if (!rpPlayBtn) return;
  const ico = rpPlayBtn.querySelector('.ico');
  const label = rpPlayBtn.querySelector('.rp-play-label');
  if (ico) ico.innerHTML = ICONS[playing ? 'pause' : 'play'];
  if (label) label.textContent = playing ? 'Pause' : 'Play';
}

// ---------------------------------------------------------------- sound toggle & stats reset

function updateSoundChip() {
  soundChip.setAttribute('aria-pressed', String(!prefs.muted));
  soundChip.querySelector('.chip-icon').innerHTML = ICONS[prefs.muted ? 'mute' : 'volume'];
  soundChip.querySelector('.chip-label').textContent = prefs.muted ? 'Muted' : 'Sound';
}

function toggleSound() {
  prefs.muted = !prefs.muted;
  savePrefs();
  updateSoundChip();
  updateMusic(); // mute stops the soundtrack; unmute resumes it on menu/setup
  if (!prefs.muted) {
    sound.unlock();
  }
}

function resetStats() {
  stats = { 1: 0, 2: 0, draws: 0 };
  saveStats();
  history = emptyHistory();
  saveHistory();
  renderScores();
  const label = $('#btn-reset-stats .chip-label');
  const prev = label.textContent;
  label.textContent = 'Cleared ✓';
  setTimeout(() => {
    label.textContent = prev;
  }, 1200);
  if (currentScreen === 'screen-stats') renderStats(); // refresh if we're looking at it
}

// ---------------------------------------------------------------- stats screen

function openStats() {
  renderStats();
  showScreen('screen-stats', 'fwd');
}

function renderStats() {
  const s = summarize(history);
  $('#stat-total').textContent = String(s.total);
  // "0%" with no games played reads as "you lose every time"; the rows below
  // already use an em dash for "nothing to report", so match them.
  $('#stat-bot-winrate').textContent = s.bot.played ? `${winRate(s.bot)}%` : '—';
  $('#stat-streak').textContent = String(s.streakCurrent);
  $('#stat-streak-best').textContent = String(s.streakBest);
  $('#stat-bot-line').textContent = s.bot.played
    ? `${s.bot.played} played · ${s.bot.won}W · ${s.bot.lost}L · ${s.bot.drawn}D`
    : 'No games yet';
  $('#stat-2p-line').textContent = s.twoPlayer.played
    ? `${s.twoPlayer.played} played · P1 ${s.twoPlayer.p1} · P2 ${s.twoPlayer.p2} · Draws ${s.twoPlayer.drawn}`
    : 'No games yet';

  const diffWrap = $('#stats-difficulty');
  diffWrap.innerHTML = '';
  for (const d of DIFFICULTIES) {
    const bucket = s.perDifficulty[d];
    const rate = winRate(bucket);
    const row = document.createElement('div');
    row.className = 'diff-row';
    row.innerHTML =
      `<span class="diff-name">${DIFFICULTY_LABEL[d]}</span>` +
      `<span class="diff-bar"><i style="width:${bucket.played ? rate : 0}%"></i></span>` +
      `<span class="diff-val">${bucket.played ? `${rate}% · ${bucket.played}` : '—'}</span>`;
    diffWrap.appendChild(row);
  }

  renderPuzzleStats();
  $('#stat-empty').hidden = s.total > 0 || puzzleProgress.solved.length > 0;
}

// Puzzle progress belongs on the Stats screen too — it was the one major section
// with no presence here, and it fills the space the game stats leave empty.
function renderPuzzleStats() {
  const wrap = $('#stats-puzzles');
  const line = $('#stat-pz-line');
  if (!wrap || !line) return;
  const solved = new Set(puzzleProgress.solved);
  const done = PUZZLES.filter((p) => solved.has(p.id)).length;
  line.textContent = done ? `${done} / ${PUZZLES.length} solved` : 'None solved yet';

  // One row per tier, in ladder order, so you can see how far up you've climbed.
  const tiers = [];
  for (const p of PUZZLES) {
    let t = tiers.find((x) => x.name === p.tier);
    if (!t) tiers.push((t = { name: p.tier, total: 0, done: 0 }));
    t.total++;
    if (solved.has(p.id)) t.done++;
  }
  wrap.innerHTML = '';
  for (const t of tiers) {
    const pct = Math.round((t.done / t.total) * 100);
    const row = document.createElement('div');
    row.className = 'diff-row';
    row.innerHTML =
      `<span class="diff-name">${t.name}</span>` +
      `<span class="diff-bar"><i style="width:${pct}%"></i></span>` +
      `<span class="diff-val">${t.done} / ${t.total}</span>`;
    wrap.appendChild(row);
  }
}

// ---------------------------------------------------------------- puzzles
// A self-contained "play and win" puzzle mode. Each puzzle is a preset position
// (you are P1/red, to move) with a single forcing line, all verified offline by
// the solver (js/puzzles.js + tools/test_puzzles.mjs). It reuses the board
// primitives (spawnDisc / cellIn / lowestEmptyRow) but keeps its own light input
// and state so the core game flow is untouched.

const PUZZLE_COLORS = { [P1]: '#ff3b30', [P2]: '#ffd23f' }; // fixed red vs yellow
// Puzzles are played, not recited: you may drop anywhere, and the opponent
// answers with its strongest (most-delaying) defence, computed live by the exact
// solver rather than replayed from the stored line. You have exactly `winIn`
// moves — the position's true mate distance — so any move that loses a tempo
// costs you the puzzle. `used` counts YOUR moves.
const puzzle = { i: 0, board: null, winIn: 0, used: 0, solved: false, failed: false, busy: false, gen: 0 };

// Generous: benchmarked over every legal reply in all 56 puzzles, the worst
// single defence decision was 31ms at a 200k budget with zero aborts, so there is
// room to spare and no reason to risk an abort mid-puzzle.
const PUZZLE_SOLVE_BUDGET = 5_000_000;

// The opponent's strongest reply: take an outright win if there is one, otherwise
// the move that minimises your score — i.e. drags the loss out as long as
// possible. Centre-most breaks ties so it plays the same way every time.
function puzzleBestDefence(board) {
  const moves = legalMoves(board);
  if (moves.length === 0) return null;
  let best = null;
  let bestScore = Infinity;
  let bestCentre = Infinity;
  for (const c of moves) {
    const child = cloneBoard(board);
    const landing = dropDisc(child, c, P2);
    if (checkWin(child, landing.row, landing.col)) return c; // wins outright
    const solved = solveBoard(child, P1, { budget: PUZZLE_SOLVE_BUDGET });
    const score = solved ? solved.score : 0; // abort ⇒ treat as unknown, prefer centre
    const centre = Math.abs(3 - c);
    if (score < bestScore || (score === bestScore && centre < bestCentre)) {
      bestScore = score;
      bestCentre = centre;
      best = c;
    }
  }
  return best;
}

function decodePuzzleGrid(grid) {
  const board = createBoard();
  for (let i = 0; i < grid.length; i++) {
    const v = Number(grid[i]);
    if (v) board[Math.floor(i / COLS)][i % COLS] = v;
  }
  return board;
}

const tierBucket = (winIn) => Math.min(10, winIn);

// The number shown to the player is the puzzle's POSITION in the ladder, not its
// id. Ids are permanent handles for saved progress; positions can shift when the
// set is re-sorted or extended, and a ladder that counts 1..N is what the player
// actually wants to see.
const puzzleNo = (i) => i + 1;

// Every puzzle is playable from the start — the list is a menu, not a gate. It
// shows what you've solved and, per cell, how deep the win is.
function renderPuzzleList() {
  const solved = new Set(puzzleProgress.solved);
  puzzleGridEl.innerHTML = '';
  PUZZLES.forEach((p, i) => {
    const isSolved = solved.has(p.id);
    const cell = document.createElement('button');
    cell.className = `puzzle-cell tier-${tierBucket(p.winIn)}`;
    if (isSolved) cell.classList.add('is-solved');
    cell.dataset.i = String(i);
    cell.setAttribute('role', 'listitem');
    cell.setAttribute('aria-label',
      `Puzzle ${puzzleNo(i)}, ${p.tier}, win in ${p.winIn}${isSolved ? ', solved' : ''}`);
    cell.innerHTML =
      `<span class="pz-mark" data-icon="${isSolved ? 'check' : ''}"></span>` +
      `<span class="pz-num">${puzzleNo(i)}</span>` +
      `<span class="pz-tier">${p.tier}</span>` +
      `<span class="pz-win">win in ${p.winIn}</span>`;
    puzzleGridEl.appendChild(cell);
  });
  installIcons(puzzleGridEl);
  const solvedCount = PUZZLES.filter((p) => solved.has(p.id)).length;
  puzzlesCountEl.textContent = `${solvedCount} / ${PUZZLES.length} solved`;
  if (puzzlesProgressFill) puzzlesProgressFill.style.width = `${Math.round((solvedCount / PUZZLES.length) * 100)}%`;
  // With 56 of them, "where was I?" needs an answer that isn't scrolling.
  if (pzNextUnsolvedBtn) pzNextUnsolvedBtn.hidden = firstUnsolvedIndex() < 0;
}

// Index of the first puzzle you haven't solved, or -1 when the set is complete.
function firstUnsolvedIndex() {
  const solved = new Set(puzzleProgress.solved);
  return PUZZLES.findIndex((p) => !solved.has(p.id));
}

function openPuzzles() {
  renderPuzzleList();
  showScreen('screen-puzzles', 'fwd');
}

function setPuzzleStatus(text, kind = '') {
  puzzleStatusEl.textContent = text;
  puzzleStatusEl.className = 'puzzle-status' + (kind ? ` is-${kind}` : '');
}

function clearPuzzleAim() {
  puzzleBoardEl.querySelectorAll('.disc.aim').forEach((d) => d.remove());
  puzzleBoardEl.querySelectorAll('.cell.col-hover').forEach((c) => c.classList.remove('col-hover'));
}

function clearPuzzleHint() {
  puzzleBoardEl.querySelectorAll('.cell.hint').forEach((c) => c.classList.remove('hint'));
  puzzleBoardEl.querySelectorAll('.disc.ghost').forEach((g) => g.remove());
}

function enterPuzzle(i) {
  if (i < 0 || i >= PUZZLES.length) return;
  const p = PUZZLES[i];
  puzzle.i = i;
  puzzle.board = decodePuzzleGrid(p.grid);
  puzzle.winIn = p.winIn;
  puzzle.used = 0;
  puzzle.solved = false;
  puzzle.failed = false;
  puzzle.busy = false;
  puzzle.gen++;
  clearPuzzleLoss();
  buildBoardInto(puzzleBoardEl);
  puzzleBoardEl.classList.add('col-hint');
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const v = puzzle.board[r][c];
    if (v !== EMPTY) spawnDisc(puzzleBoardEl, r, c, PUZZLE_COLORS[v]);
  }
  puzzleTitleEl.textContent = `Puzzle ${puzzleNo(i)} · ${p.tier}`;
  if (puzzleDotEl) puzzleDotEl.style.background = PUZZLE_COLORS[P1];
  puzzlePromptText.textContent = `Red to move — win in ${p.winIn}`;
  updatePuzzleMoves();
  setPuzzleStatus('Play any move — the opponent defends as well as it can.');
  pzNextBtn.hidden = true;
  pzHintBtn.disabled = false;
  showScreen('screen-puzzle', 'fwd');
}

// Moves left out of the puzzle's budget. Run out without a four and it's a loss,
// so this is the thing to watch.
function updatePuzzleMoves() {
  if (!puzzleMovesEl) return;
  const left = Math.max(0, puzzle.winIn - puzzle.used);
  puzzleMovesEl.textContent = `${left} move${left === 1 ? '' : 's'} left`;
  puzzleMovesEl.classList.toggle('is-low', !puzzle.solved && !puzzle.failed && left <= 1);
}

// Losing sequence, built as the mirror of the win: the win bursts colour outward,
// this drains it away. The board desaturates and the discs sag, ash drifts down,
// and a cracked disc fades up with the reason. `title` is the short headline.
function puzzleFail(reason, title = 'Out of moves') {
  puzzle.failed = true;
  puzzle.busy = false;
  clearPuzzleAim();
  clearPuzzleHint();
  updatePuzzleMoves();
  pzHintBtn.disabled = true;
  setPuzzleStatus(title, 'bad');

  const gen = puzzle.gen;
  puzzleBoardEl.classList.add('is-lost'); // colour drains out of the position
  sound.lose();
  haptic([26, 90, 22, 90, 30]); // slow and heavy, not the sharp buzz of a rejection

  setTimeout(() => {
    if (puzzle.gen !== gen) return;
    spawnAsh(34, puzzleAshLayer);
  }, 180);

  setTimeout(() => {
    if (puzzle.gen !== gen || !puzzleLostEl) return;
    if (plTitle) plTitle.textContent = title;
    if (plSub) plSub.textContent = reason;
    puzzleLostEl.classList.add('is-open');
    puzzleLostEl.setAttribute('aria-hidden', 'false');
  }, 520);
}

// Clear everything the losing sequence put on screen (used when re-entering).
function clearPuzzleLoss() {
  puzzleBoardEl.classList.remove('is-lost');
  if (puzzleAshLayer) puzzleAshLayer.innerHTML = '';
  if (puzzleLostEl) {
    puzzleLostEl.classList.remove('is-open');
    puzzleLostEl.setAttribute('aria-hidden', 'true');
  }
}

const retryPuzzle = () => enterPuzzle(puzzle.i);
const nextPuzzle = () => { if (puzzle.i < PUZZLES.length - 1) enterPuzzle(puzzle.i + 1); };

// Drop `player`'s disc into `col` on the puzzle board (animated), then cb(row).
function puzzlePlace(col, player, cb) {
  const row = lowestEmptyRow(puzzle.board, col);
  puzzle.board[row][col] = player;
  const disc = spawnDisc(puzzleBoardEl, row, col, PUZZLE_COLORS[player], { drop: true });
  sound.drop();
  haptic(10);
  onceAnimation(disc, () => cb(row));
}

function markPuzzleSolved(id) {
  if (!puzzleProgress.solved.includes(id)) puzzleProgress.solved.push(id);
  savePuzzleProgress();
}

function onPuzzleSolved(winCells) {
  puzzle.solved = true;
  puzzle.busy = false;
  clearPuzzleAim();
  if (winCells) winCells.forEach(([r, c]) => {
    const d = cellIn(puzzleBoardEl, r, c).querySelector('.disc');
    if (d) d.classList.add('win');
  });
  sound.win();
  haptic([12, 40, 18]);
  if (!prefersReducedMotion() && puzzleConfettiLayer) {
    const cols = [PUZZLE_COLORS[P1], PUZZLE_COLORS[P2], '#7cff6b', '#b26bff', '#3dd7ff'];
    spawnConfetti(120, puzzleConfettiLayer, cols);
    setTimeout(() => spawnConfetti(60, puzzleConfettiLayer, cols), 260);
  }
  setPuzzleStatus('Solved! 🎉', 'good');
  markPuzzleSolved(PUZZLES[puzzle.i].id);
  pzNextBtn.hidden = puzzle.i >= PUZZLES.length - 1;
  pzHintBtn.disabled = true;
}

function puzzleDrop(col) {
  if (col == null || puzzle.solved || puzzle.failed || puzzle.busy) return;
  clearPuzzleHint();
  const landing = lowestEmptyRow(puzzle.board, col);
  if (landing < 0) { sound.invalid(); return; } // full column — not a move at all

  puzzle.busy = true;
  puzzle.used++;
  clearPuzzleAim();
  const gen = puzzle.gen;
  puzzlePlace(col, P1, (r) => {
    if (puzzle.gen !== gen) return; // navigated away mid-animation
    updatePuzzleMoves();

    const cells = checkWin(puzzle.board, r, col);
    if (cells) { onPuzzleSolved(cells); return; } // within budget by construction

    // No four, and that was the last move you had.
    if (puzzle.used >= puzzle.winIn) {
      puzzleFail(`You had ${puzzle.winIn} move${puzzle.winIn === 1 ? '' : 's'} to force it, and they're gone.`, 'Out of moves');
      return;
    }
    if (legalMoves(puzzle.board).length === 0) { puzzleFail('The board filled up with no four in sight.', 'Board full'); return; }

    setPuzzleStatus('Opponent is defending…');
    setTimeout(() => {
      if (puzzle.gen !== gen) return;
      const reply = puzzleBestDefence(puzzle.board);
      if (reply == null) { puzzleFail('The board filled up with no four in sight.', 'Board full'); return; }
      puzzlePlace(reply, P2, () => {
        if (puzzle.gen !== gen) return;
        // A defensive drop can complete four for the opponent if you left one open.
        const theirs = findWinFor(puzzle.board, P2);
        if (theirs) {
          theirs.forEach(([wr, wc]) => {
            const d = cellIn(puzzleBoardEl, wr, wc).querySelector('.disc');
            if (d) d.classList.add('win');
          });
          puzzleFail('You left a line open and the defence took it.', 'Beaten to it');
          return;
        }
        puzzle.busy = false;
        if (legalMoves(puzzle.board).length === 0) { puzzleFail('The board filled up with no four in sight.', 'Board full'); return; }
        setPuzzleStatus(`Your move — ${puzzle.winIn - puzzle.used} to go.`);
      });
    }, 380);
  });
}

// The hint is solved from the position in front of you, not read off the stored
// line — you're free to wander off it, so the line may no longer apply. It also
// tells you when the win is already gone, which is more useful than pointing at
// the least-bad move in a position you can't win.
function puzzleHint() {
  if (puzzle.solved || puzzle.failed || puzzle.busy) return;
  clearPuzzleHint();

  const left = puzzle.winIn - puzzle.used;
  let bestCol = null;
  let bestMate = Infinity; // your moves needed to force the four
  for (const c of legalMoves(puzzle.board)) {
    const child = cloneBoard(puzzle.board);
    const landing = dropDisc(child, c, P1);
    if (checkWin(child, landing.row, landing.col)) { bestCol = c; bestMate = 1; break; }
    const solved = solveBoard(child, P2, { budget: PUZZLE_SOLVE_BUDGET });
    if (!solved || solved.score >= 0) continue; // P2 not lost ⇒ this move doesn't win
    const mate = 1 + movesStillNeeded(child, solved.score);
    if (mate < bestMate) { bestMate = mate; bestCol = c; }
  }

  if (bestCol == null || bestMate > left) {
    setPuzzleStatus('The win has slipped away — tap Retry.', 'bad');
    return;
  }
  const row = lowestEmptyRow(puzzle.board, bestCol);
  if (row < 0) return;
  for (let r = 0; r < ROWS; r++) cellIn(puzzleBoardEl, r, bestCol).classList.add('hint');
  const ghost = spawnDisc(puzzleBoardEl, row, bestCol, PUZZLE_COLORS[P1]);
  ghost.classList.add('ghost');
  setPuzzleStatus(`Hint: this column — then it's a win in ${bestMate}.`, 'hint');
}

// How many more of YOUR moves are needed, given a position where you have just
// moved (so the opponent is to play) and the solver scored it from the opponent's
// side. Checked against all 204 mid-line positions in the shipped set — exact
// every time. Sibling of the root-side formula in tools/test_puzzles.mjs.
function movesStillNeeded(afterYourMove, opponentScore) {
  const discs = afterYourMove.flat().filter((v) => v !== EMPTY).length;
  return Math.max(0, Math.round(21 - (discs - 1) / 2 - Math.abs(opponentScore)));
}

// Puzzle board input: press/hover to aim, release to drop (mirrors the game board).
const pzAim = { pointerId: null };
const puzzleCanPlay = () => currentScreen === 'screen-puzzle' && !puzzle.solved && !puzzle.failed && !puzzle.busy;

function puzzleColFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest('.cell') : null;
  if (!cell || !puzzleBoardEl.contains(cell)) return null;
  return Number(cell.dataset.col);
}

function puzzleRenderAim(col) {
  clearPuzzleAim();
  if (col == null || !puzzleCanPlay()) return;
  for (let r = 0; r < ROWS; r++) cellIn(puzzleBoardEl, r, col).classList.add('col-hover');
  const row = lowestEmptyRow(puzzle.board, col);
  if (row < 0) return;
  const ghost = document.createElement('div');
  ghost.className = 'disc aim';
  ghost.style.setProperty('--disc', PUZZLE_COLORS[P1]);
  cellIn(puzzleBoardEl, row, col).appendChild(ghost);
}

function wirePuzzleBoard() {
  const hoverCapable = window.matchMedia('(hover: hover)').matches;
  puzzleBoardEl.addEventListener('pointerdown', (e) => {
    if (!puzzleCanPlay()) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    pzAim.pointerId = e.pointerId;
    try { puzzleBoardEl.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    puzzleRenderAim(Number(cell.dataset.col));
    e.preventDefault();
  });
  puzzleBoardEl.addEventListener('pointermove', (e) => {
    if (pzAim.pointerId === e.pointerId) {
      puzzleRenderAim(puzzleColFromPoint(e.clientX, e.clientY));
      e.preventDefault();
    } else if (pzAim.pointerId == null && hoverCapable) {
      const cell = e.target.closest('.cell');
      puzzleRenderAim(cell ? Number(cell.dataset.col) : null);
    }
  });
  puzzleBoardEl.addEventListener('pointerup', (e) => {
    if (pzAim.pointerId !== e.pointerId) return;
    const col = puzzleColFromPoint(e.clientX, e.clientY);
    try { puzzleBoardEl.releasePointerCapture(e.pointerId); } catch { /* not fatal */ }
    pzAim.pointerId = null;
    puzzleBoardEl.querySelectorAll('.disc.aim').forEach((d) => d.remove());
    if (col != null) puzzleDrop(col);
  });
  puzzleBoardEl.addEventListener('pointercancel', () => { pzAim.pointerId = null; clearPuzzleAim(); });
  puzzleBoardEl.addEventListener('pointerleave', () => { if (pzAim.pointerId == null) clearPuzzleAim(); });
}

// ---------------------------------------------------------------- column hover (pointer devices)

function setHoverCol(col) {
  boardEl.querySelectorAll('.cell.col-hover').forEach((c) => c.classList.remove('col-hover'));
  if (col == null || game.locked || game.over || !game.active) return;
  if (game.mode === 'bot' && game.current === P2) return;
  for (let r = 0; r < ROWS; r++) cellAt(r, col).classList.add('col-hover');
}

// ---------------------------------------------------------------- aim preview
// While you point at / press a column, show a translucent "ghost" disc in the
// hole where your piece would land, plus a column highlight, so you can aim
// before committing. Works for both touch (press-drag-release) and mouse (hover
// then click). The actual drop happens on pointer release via humanPlay().

const aimState = { pointerId: null };

// Lowest empty row in `col` for a given board, or -1 if the column is full.
function lowestEmptyRow(board, col) {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r][col] === EMPTY) return r;
  return -1;
}

// Can the human commit a move right now (drop or, in armed Pop-Out, a pop)?
function canPlay() {
  if (!game.active || game.locked || game.over) return false;
  if (game.mode === 'bot' && game.current === P2) return false; // not the human's turn
  return true;
}

// Should the landing-hole ghost show? Only for a real drop — not while armed to
// pop (a pop removes a bottom disc, so a "landing" preview would be misleading).
function canAim() {
  return canPlay() && !(game.variant === 'popout' && game.popArmed);
}

// Map viewport coordinates to a board column (works under pointer capture).
function colFromPoint(x, y) {
  const el = document.elementFromPoint(x, y);
  const cell = el && el.closest ? el.closest('.cell') : null;
  if (!cell || !boardEl.contains(cell)) return null;
  return Number(cell.dataset.col);
}

function renderAim(col) {
  boardEl.querySelectorAll('.disc.aim').forEach((d) => d.remove());
  setHoverCol(col);
  if (col == null || !canAim()) return;
  const r = lowestEmptyRow(game.board, col);
  if (r < 0) return; // full column — the highlight still shows, but there's no landing hole
  const ghost = document.createElement('div');
  ghost.className = 'disc aim';
  ghost.style.setProperty('--disc', colorFor(game.current));
  cellAt(r, col).appendChild(ghost);
}

function clearAim() {
  boardEl.querySelectorAll('.disc.aim').forEach((d) => d.remove());
  setHoverCol(null);
  aimState.pointerId = null;
}

// ---------------------------------------------------------------- wiring

function wire() {
  installIcons();
  buildSwatches(1, swatches1);
  buildSwatches(2, swatches2);
  updateSoundChip();
  applyTheme(prefs.theme);
  applyEvalVisibility();

  // Welcome entrance on first load (the menu is the initial screen).
  if (!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    document.getElementById('screen-menu')?.classList.add('intro');
  }

  $('#btn-mode-bot').addEventListener('click', () => openSetup('bot'));
  $('#btn-mode-2p').addEventListener('click', () => openSetup('2p'));
  $('#btn-mode-puzzles').addEventListener('click', openPuzzles);
  $('#btn-start').addEventListener('click', startFromSetup);
  $('#btn-restart').addEventListener('click', restartRound);
  $('#btn-newround').addEventListener('click', nextRound);
  $('#btn-playagain').addEventListener('click', onResultPrimary);
  $('#btn-undo').addEventListener('click', undo);
  hintBtn.addEventListener('click', showHint);
  if (evalToggleBtn) evalToggleBtn.addEventListener('click', toggleEval);
  popToggleBtn.addEventListener('click', togglePop);
  soundChip.addEventListener('click', toggleSound);
  themeChip.addEventListener('click', cycleTheme);
  $('#btn-reset-stats').addEventListener('click', resetStats);
  $('#btn-stats').addEventListener('click', openStats);

  // Replay entry points + controls
  $('#btn-watch-replay').addEventListener('click', () => enterReplay(lastGame));
  replayLastChip.addEventListener('click', () => enterReplay(lastGame));
  $('#rp-start').addEventListener('click', () => { stopReplayPlay(); replayStepTo(0, false); });
  $('#rp-prev').addEventListener('click', () => { stopReplayPlay(); replayStep(-1); });
  rpPlayBtn.addEventListener('click', toggleReplayPlay);
  $('#rp-next').addEventListener('click', () => { stopReplayPlay(); replayStep(1); });
  $('#rp-end').addEventListener('click', () => { stopReplayPlay(); replayStepTo(replay.data.moves.length, false); });
  if (rpHintBtn) rpHintBtn.addEventListener('click', showReplayHint);
  updateReplayLastChip();

  // Game review: tap a flagged move to jump there, or scrub the curve to seek.
  if (reviewMoments) {
    reviewMoments.addEventListener('click', (e) => {
      const chip = e.target.closest('.review-chip');
      if (chip) openReviewMoment(Number(chip.dataset.index));
    });
  }
  if (reviewGraph) {
    let scrubbing = false;
    reviewGraph.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      reviewGraph.setPointerCapture(e.pointerId);
      seekFromGraph(e.clientX);
    });
    reviewGraph.addEventListener('pointermove', (e) => {
      if (scrubbing) seekFromGraph(e.clientX);
    });
    const endScrub = () => { scrubbing = false; };
    reviewGraph.addEventListener('pointerup', endScrub);
    reviewGraph.addEventListener('pointercancel', endScrub);
  }

  // Puzzles: list navigation + play controls + board input.
  puzzleGridEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.puzzle-cell');
    if (cell && !cell.disabled) enterPuzzle(Number(cell.dataset.i));
  });
  if (pzNextUnsolvedBtn) {
    pzNextUnsolvedBtn.addEventListener('click', () => {
      const i = firstUnsolvedIndex();
      if (i >= 0) enterPuzzle(i);
    });
  }
  pzHintBtn.addEventListener('click', puzzleHint);
  pzRetryBtn.addEventListener('click', retryPuzzle);
  $('#pl-retry')?.addEventListener('click', retryPuzzle); // the one on the loss card
  pzNextBtn.addEventListener('click', nextPuzzle);
  wirePuzzleBoard();

  document.querySelectorAll('[data-nav="menu"]').forEach((el) => el.addEventListener('click', goMenu));
  document.querySelectorAll('[data-nav="puzzles"]').forEach((el) => el.addEventListener('click', openPuzzles));

  diffSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedDifficulty = seg.dataset.diff;
      refreshDifficulty();
    });
  });

  timerSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedTimer = Number(seg.dataset.timer);
      refreshTimer();
    });
  });

  variantSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedVariant = seg.dataset.variant;
      refreshVariant();
    });
  });

  matchSegs.forEach((seg) => {
    seg.addEventListener('click', () => {
      selectedMatch = Number(seg.dataset.match);
      refreshMatch();
    });
  });

  // Unified board input: aim preview + drop-on-release. Covers touch (press →
  // drag across columns → lift to drop) and mouse (hover to preview → click).
  const hoverCapable = window.matchMedia('(hover: hover)').matches;
  boardEl.classList.add('col-hint'); // enables the column-highlight socket style

  boardEl.addEventListener('pointerdown', (e) => {
    if (!canPlay()) return;
    const cell = e.target.closest('.cell');
    if (!cell) return;
    // A fresh press always takes over the active pointer, so a lost pointerup
    // (rare) can never wedge the board.
    aimState.pointerId = e.pointerId;
    try { boardEl.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    renderAim(Number(cell.dataset.col));
    e.preventDefault();
  });

  boardEl.addEventListener('pointermove', (e) => {
    if (aimState.pointerId === e.pointerId) {
      renderAim(colFromPoint(e.clientX, e.clientY)); // aiming: follow the pointer
      e.preventDefault();
    } else if (aimState.pointerId == null && hoverCapable) {
      const cell = e.target.closest('.cell'); // plain mouse hover: preview the column
      renderAim(cell ? Number(cell.dataset.col) : null);
    }
  });

  boardEl.addEventListener('pointerup', (e) => {
    if (aimState.pointerId !== e.pointerId) return;
    const col = colFromPoint(e.clientX, e.clientY);
    try { boardEl.releasePointerCapture(e.pointerId); } catch { /* not fatal */ }
    aimState.pointerId = null;
    boardEl.querySelectorAll('.disc.aim').forEach((d) => d.remove()); // let the real disc drop cleanly
    if (col != null) humanPlay(col);
    if (!hoverCapable) setHoverCol(null);
  });

  boardEl.addEventListener('pointercancel', (e) => {
    if (aimState.pointerId === e.pointerId) clearAim();
  });
  boardEl.addEventListener('pointerleave', () => {
    if (aimState.pointerId == null) clearAim(); // drop the hover preview when the cursor leaves
  });

  // First user gesture unlocks Web Audio; start the soundtrack if we're on a
  // music screen and not muted.
  window.addEventListener('pointerdown', () => { sound.unlock(); audioUnlocked = true; updateMusic(); }, { once: true });

  // A click sound on every button/chip/segment/swatch press (respects mute).
  document.addEventListener('click', (e) => {
    const el = e.target.closest('button, .chip, .seg, .swatch');
    if (el && !el.disabled) sound.click();
  });

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

// The fixed background layers (styles.css: body::before, #danger-tint) used to be
// sized from a JS-measured pixel height (--app-vh) because CSS viewport units
// could resolve short on an iOS standalone PWA's first paint. They now size
// themselves with `inset: 0` + `min-height: 100lvh`, which is resolved by layout
// against the viewport and re-resolves on every viewport change — so there is
// nothing left for JS to measure or keep in sync.
