# Connect Four 🔴🟡

A polished, installable **Connect Four** game you can play right on your iPhone —
no App Store, no Xcode, no Mac required. It's a self-contained web app (PWA): open
it in Safari, tap **Add to Home Screen**, and it launches full-screen with its own
icon, works **offline**, and feels like a native app.

<p align="center"><em>Play a bot, play a friend on the same phone, solve puzzles — or let a wise old
teacher walk you through the tactics that win games.</em></p>

## Features

- 🤖 **Vs Bot** — four difficulty levels (Easy / Medium / Hard / **Insane**). All purely
  algorithmic minimax with alpha-beta look-ahead (no ML). **Insane** searches deepest *and* hands
  the endgame to the exact solver, so once the position is small enough to solve it plays
  perfectly and cannot be outplayed. **Hard** deliberately stays on plain search — deep, but
  fallible, so there's still a real gap between the two. A little **robot hand** hovers over the board on the bot's turn, slides to its
  column and drops the disc with a synthesised servo click — and it gets **scarier as the difficulty
  climbs**: a friendly green helper chirping on Easy, an angry orange one on Hard, and on Insane a
  red-eyed, horned, fanged nightmare that drips, throws sparks off its claw and growls as it releases.
- 👥 **Two Players** — pass-and-play on one phone.
- 🧩 **Puzzles** — a ladder of **56 "play and win" puzzles**, sorted strictly easiest → hardest across
  ten named tiers (Warm-up · Sharp · Tactician · Sniper · Grandmaster · Legend · Mastermind · Oracle ·
  Nightmare · **Impossible**) from *win in 1* to *win in 10*. Each list cell shows its tier and how
  deep the forced win is, and **Next unsolved** jumps you to where you left off.
  You're red, and you play it out properly: **drop wherever you like** and the opponent answers with
  its **strongest defence, solved live** — not a scripted reply. You get exactly as many moves as the
  position's true mate distance, so a move that merely *keeps* the win instead of taking the fastest
  one costs you the puzzle. Run the budget out, or let the opponent get four first, and you get the
  **losing screen**: the board drains to grey and the discs sag in a wave rolling up from the bottom
  row, the dark closes in from the edges, ash and grit drift down, and a cracked disc **splits in
  two** over a falling three-note figure and a long sub-bass tail — then the card tells you how it
  slipped away. Retry and go again.
  The 💡 hint is solved from the position in front of you and tells you how deep
  the win is from there. **Every puzzle is unlocked from the start** — play them in any order — and the
  list marks the ones you've solved, with progress saved on-device. Every puzzle was **generated and proven correct by the bitboard solver** offline
  (see `tools/gen_puzzles.mjs` / `tools/test_puzzles.mjs`): the solutions are exact, the advertised
  *win in N* matches the solver's mate distance, and the opponent always plays a true best defence.
- 🎓 **Tactics** — the part that makes you *better*. Eight ideas that actually decide Connect Four
  games, taught by a **wise old teacher** who hovers above the board in his mortarboard and
  spectacles, talks you through each one, lights up the squares he's talking about and swings his
  staff down to point when you're stuck: **Own the centre** (51 of the 69 possible fours run through
  the middle column — 15 through each outside one), **Two threats at once** (the fork), **The seven**
  (one disc finishing a row *and* a diagonal), **Block and build** (tempo), **Poisoned squares**
  (never fill the square under their win), **Stack your threats** (two winning squares in one column
  — block below, lose above), **Odd rows are yours** (parity and zugzwang) and **Kill the fork early**
  (defence). Each tactic has a short lesson and **three positions to train on**, and every drill was
  **generated and proven by the exact solver**: the move you're asked for is the *only* move that
  works, so a wrong answer is a real mistake and not an opinion. Where the payoff is a forced win you
  **play it out** — make the fork, watch the best defence stop one threat, then take the other.
- 📊 **Win-% eval bar + best move** — an optional bar (toggle **📊 Win odds** in-game) shows each
  player's chance to win, like a chess eval bar. In the opening/midgame it's a turn-aware engine
  estimate; from the game's second half on it becomes **exact**, solved by a bitboard solver
  (negamax + alpha-beta + transposition table) — Connect Four is a solved game, so once the tree is
  small enough it reports the true result under perfect play. A **💡 Best move** button highlights a
  strong column for whoever's turn it is. All offline, no ML.
- 🔁 **Replay + 🔍 Game review** — every finished game is saved so you can step, scrub, or auto-play
  through it, with the **win-% bar** and a **💡 Best move** hint at every paused position. On top of
  that, each game is **analysed move by move**: a win-% **curve** across the whole game, an
  **accuracy score** per player, and tappable chips for the moves that gave ground ("Move 12 ·
  Player 2 −48%") — tap one to jump to just before it and see what should have been played instead.
  Drag the curve to scrub. All computed on-device by the same solver, no ML, no network.
- 👾 **Opponent reveal** — starting a game vs the bot boots the machine up first: a scanline sweep,
  the robot materialising, its level slamming in and a line of trash talk. It **escalates with the
  difficulty** — a mint-green helper chirping "Go easy on me, okay?" on Easy, an angry orange one on
  Hard, and on **Insane** a red-eyed fanged nightmare behind a throbbing crimson vignette, screen
  glitch and subsonic growl telling you it has already seen every move you have. Tap to skip.
- 🦷 **Getting eaten** — lose to the bot and it stops being a polite little claw. The board drains
  and is pulled inward, two jaws slide in from the top and bottom of the screen and hold open — eyes
  glowing in the dark, your position sitting inside the mouth — then **snap shut**, interlocking
  their teeth over it with a crunch, a screen kick and two more bites for good measure. The **losing
  screen** that follows names the defeat rather than the winner (*Nibbled · Swallowed · Crunched ·
  **DEVOURED***) and shows the winner's disc with a bite taken out of it. The maw is skinned from the
  same palette as the robot you played, so Easy nibbles and Insane fills the screen with red.
- 🎲 **Coin toss for the first move** — who opens is decided by a **random toss** with an animated
  roll: the highlight ping-pongs between the two players, slowing down until it lands on one of
  them. Within a match the starter then **alternates each round**, so the opening advantage evens
  out over a series (later rounds announce the starter instead of re-rolling). The board stays
  locked and the turn clock doesn't start until the toss lands.
- 🏅 **Match series** — play a single game, **Best of 3**, or **Best of 5**, with series
  pips and a match-winner celebration.
- 🔄 **Pop-Out variant** — the official twist: on your turn you can drop, *or* pop one of
  your own bottom discs to slide a whole column down (it can even hand your opponent the win!).
  The bot plays this as its own game with a **dedicated pop-aware search**: it will pop when that's
  the strongest move, it sees *your* pops coming, and it won't pop into a line that hands you the
  win. The 💡 **Best move** hint is pop-aware too — it rings the disc to pull out. (The exact solver
  plays standard rules, so Pop-Out keeps the win-% bar and the review on the heuristic search: a pop
  can refute anything the solver would "prove".)
- ⏱️ **Turn timer** (two-player) — optional 15 / 30 / 60s limit. The countdown and its bar go red
  under 5 seconds; running out loses the round.
- 🎨 **Themes** — switch between **Classic** (glossy blue cabinet — the default), **Neon**, and
  **Minimal** (light, flat). The board is drawn as a real moulded cabinet with drilled holes.
- 🏆 **Scoreboard** — win/draw tallies that persist between sessions.
- 📈 **Stats** — a dedicated screen with your total games, win rate vs the bot (overall and per
  difficulty), two-player tally, and current/best win streak.
- 🔊 **Sound & music** — a chill neon **soundtrack** on the menu/setup screens, live-generated
  **sound effects**, and a **click on every button**, all synthesised with the Web Audio API
  (no audio files, works offline) and silenced by the mute toggle.
- ✏️ **Custom names & disc colours** — pick from the palette before each match.
- 📳 **Haptics** — vibration on drops and wins *(see the note below about iOS)*.
- 🎯 **Aim preview** — press (or hover) a column and a translucent disc shows exactly where your
  piece will land before you commit.
- ↶ **Undo**, a glowing **winning-line** animation through the four discs, and celebratory
  **confetti** on every win.
- 📴 **Offline** — a service worker caches everything, so it plays with no connection.

## Play it on your iPhone

The easiest way is to host it (free) with **GitHub Pages** and open the link in Safari.

### 1. Turn on GitHub Pages
1. Push this branch (already done if Claude committed it).
2. On GitHub, go to the repo → **Settings** → **Pages**.
3. Under **Build and deployment → Source**, choose **Deploy from a branch**.
4. Pick the branch **`claude/ios-connect-four-app-9rr8cs`** (or `main` if you merge it)
   and folder **`/ (root)`**, then **Save**.
5. Wait ~1 minute. GitHub shows a URL like
   `https://<your-username>.github.io/IOS-Connect-Four/`.

### 2. Add it to your Home Screen
1. Open that URL in **Safari** on your iPhone.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the new icon — it opens full-screen, like an app. ✅

> Once opened online at least once, it also works fully **offline**.

### Updates
The app uses a **network-first** service worker, so whenever you push a change and
GitHub Pages redeploys, your phone picks it up automatically — it fetches the latest
files when online and reloads once if a newer version took over. (It still works
offline by falling back to the cached copy.) If you ever want to force a clean reload,
go to **Settings → Safari → Advanced → Website Data**, delete the site's entry, and
reopen it.

### Run it locally (on a computer, for testing)
Because it uses ES modules and a service worker, open it through a small web server
(not `file://`):

```bash
python3 -m http.server 8080
# then visit http://localhost:8080
```

## A couple of honest notes

- **Haptics on iPhone:** iOS Safari currently ignores the web Vibration API, so the
  haptic buzz will likely be silent on your iPhone even though the code is there. It
  works on Android/Chrome. Everything else works great on iOS.
- **Sound on iPhone:** browsers only allow audio after you interact with the page, so
  the first tap unlocks sound — this is normal.

## Project layout

```
index.html            App shell, all screens, and #fx (the full-screen overlay layer)
styles.css            Neon theme, animations, iPhone safe-area handling (see --bg-floor)
js/engine.js          Pure Connect Four rules (drop, win/draw detection)
js/bot.js             Bot opponent (easy/medium heuristics + hard minimax) + win-% estimate
js/solver.js          Exact bitboard solver (negamax + alpha-beta + TT) — eval bar + puzzle generation
js/stats.js           Pure stats aggregation (totals, per-difficulty, streaks)
js/review.js          Pure game review (blunder/mistake flags + accuracy scores)
js/puzzles.js         Puzzle set (solver-generated static data; see tools/gen_puzzles.mjs)
js/tactics.js         Tactics curriculum — lessons + solver-proven drills (see tools/gen_tactics.mjs)
js/app.js             UI controller: rendering, sound, haptics, scoreboard, persistence
manifest.webmanifest  PWA metadata (name, icons, standalone display)
service-worker.js     Offline caching
icons/                App icons — the Classic cabinet, 4x4, with a lit diagonal four
                      (generated by tools/make_icons.py, stdlib only, no Pillow)
tools/                Icon generator, content generators (puzzles/tactics) + test scripts
```

## Development & tests

```bash
npm test                     # engine + bot + solver + puzzle + review + tactics tests (Node, no deps)
node tools/gen_puzzles.mjs   # regenerate js/puzzles.js from the solver (dev-only)
node tools/gen_tactics.mjs   # regenerate js/tactics.js — searches for fresh drill positions
TACTIC_REUSE=1 node tools/gen_tactics.mjs   # …keeping the committed positions (for prose edits)
python3 tools/make_icons.py  # regenerate the app icons
```

The puzzles in `js/puzzles.js` are produced offline by `tools/gen_puzzles.mjs` (which uses the exact
solver) and re-verified from scratch by `tools/test_puzzles.mjs` — every puzzle is a legal position
with a single, solver-proven forcing line.

`tools/opening_values.mjs` is the small dev script behind the "Own the centre" lesson: it weak-solves
each opening column with the same solver. Opening on the outside column is a **proven loss** for the
player who plays it (685M nodes, ~25 minutes on this solver). The middle columns are out of reach
from an empty board with the in-game transposition table, so the centre's value is quoted as the
published result for the solved game rather than measured here.

`js/tactics.js` works the same way, and the ordering matters: **the lessons are written by hand** in
`tools/gen_tactics.mjs`; the positions are not. Each tactic has a cheap structural test (does this move make two open threats?
does it stack two winning squares in one column?), and every candidate that matches is handed to the
solver, which has to agree the tactical move is the *only* move that works — the only winning move
for an attacking idea, the only non-losing one for a defensive idea. `tools/test_tactics.mjs`
re-proves all of it from scratch (422 checks) and independently re-derives each tactic's shape, so a
drill can't teach a move that doesn't work.

There's also a browser smoke test (`tools/smoke_test.mjs`) that drives the real UI in
Chromium at an iPhone viewport; it needs Playwright and a running local server.

Enjoy — and good luck against **Hard**. 🎮
