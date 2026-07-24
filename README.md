# Connect Four — Neon 🔴🔵

A polished, installable **Connect Four** game you can play right on your iPhone —
no App Store, no Xcode, no Mac required. It's a self-contained web app (PWA): open
it in Safari, tap **Add to Home Screen**, and it launches full-screen with its own
icon, works **offline**, and feels like a native app.

<p align="center"><em>Play against a bot (Easy / Medium / Hard) or two players on the same phone.</em></p>

## Features

- 🤖 **Vs Bot** — four difficulty levels (Easy / Medium / Hard / **Insane**). All purely
  algorithmic minimax with alpha-beta look-ahead (no ML) — Insane searches deepest and is
  near-unbeatable.
- 👥 **Two Players** — pass-and-play on one phone.
- 🧩 **Puzzles** — a ladder of **30+ "play and win" puzzles** that get progressively harder (Warm-up →
  Grandmaster, *win in 1* up to *win in 5+*). You're red; find the move that forces a win against the
  opponent's best defence. Each has a single correct key move at every step — solve one to unlock the
  next, with progress saved on-device. Every puzzle was **generated and proven correct by the bitboard
  solver** offline (see `tools/gen_puzzles.mjs` / `tools/test_puzzles.mjs`), so the solutions are exact.
- 📊 **Win-% eval bar + best move** — an optional bar (toggle **📊 Win odds** in-game) shows each
  player's chance to win, like a chess eval bar. In the opening/midgame it's a turn-aware engine
  estimate; from the game's second half on it becomes **exact**, solved by a bitboard solver
  (negamax + alpha-beta + transposition table) — Connect Four is a solved game, so once the tree is
  small enough it reports the true result under perfect play. A **💡 Best move** button highlights a
  strong column for whoever's turn it is. All offline, no ML.
- 🔁 **Replay** — every finished game is saved so you can step, scrub, or auto-play through it, with
  the **win-% bar** and a **💡 Best move** hint available at every paused position.
- 🏅 **Match series** — play a single game, **Best of 3**, or **Best of 5**, with series
  pips and a match-winner celebration.
- 🔄 **Pop-Out variant** — the official twist: on your turn you can drop, *or* pop one of
  your own bottom discs to slide a whole column down (it can even hand your opponent the win!).
- ⏱️ **Turn timer** (two-player) — optional 15 / 30 / 60s limit; the whole background slowly
  washes red past the ⅔ mark, and running out loses the round.
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
index.html            App shell + all screens (menu / setup / game / result)
styles.css            Neon theme, animations, iPhone safe-area handling
js/engine.js          Pure Connect Four rules (drop, win/draw detection)
js/bot.js             Bot opponent (easy/medium heuristics + hard minimax) + win-% estimate
js/solver.js          Exact bitboard solver (negamax + alpha-beta + TT) — eval bar + puzzle generation
js/stats.js           Pure stats aggregation (totals, per-difficulty, streaks)
js/puzzles.js         Puzzle set (solver-generated static data; see tools/gen_puzzles.mjs)
js/app.js             UI controller: rendering, sound, haptics, scoreboard, persistence
manifest.webmanifest  PWA metadata (name, icons, standalone display)
service-worker.js     Offline caching
icons/                App icons (generated by tools/make_icons.py)
tools/                Icon generator + test scripts
```

## Development & tests

```bash
npm test                     # engine + bot + solver + puzzle unit tests (Node, no deps)
node tools/gen_puzzles.mjs   # regenerate js/puzzles.js from the solver (dev-only)
python3 tools/make_icons.py  # regenerate the app icons
```

The puzzles in `js/puzzles.js` are produced offline by `tools/gen_puzzles.mjs` (which uses the exact
solver) and re-verified from scratch by `tools/test_puzzles.mjs` — every puzzle is a legal position
with a single, solver-proven forcing line.

There's also a browser smoke test (`tools/smoke_test.mjs`) that drives the real UI in
Chromium at an iPhone viewport; it needs Playwright and a running local server.

Enjoy — and good luck against **Hard**. 🎮
